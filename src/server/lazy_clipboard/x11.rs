//! X11: our own CLIPBOARD owner answers `SelectionRequest` with the viewer's data, fetched only
//! then.
use super::{fetch, Provider};
use base::message_proto::ClipboardFormat;
use hbb_common::{bail, log, ResultType};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use x11rb::{
    connection::{Connection, RequestConnection},
    protocol::{
        xproto::{
            AtomEnum, ChangeWindowAttributesAux, ConnectionExt as _, CreateWindowAux, EventMask,
            PropMode, Property, PropertyNotifyEvent, SelectionNotifyEvent, SelectionRequestEvent,
            Window, WindowClass, SELECTION_NOTIFY_EVENT,
        },
        Event,
    },
    rust_connection::RustConnection,
    wrapper::ConnectionExt as _,
    COPY_DEPTH_FROM_PARENT, COPY_FROM_PARENT, CURRENT_TIME, NONE,
};

x11rb::atom_manager! {
    Atoms: AtomsCookie {
        CLIPBOARD,
        TARGETS,
        INCR,
        UTF8_STRING,
        TEXT_PLAIN_UTF8: b"text/plain;charset=utf-8",
        TEXT_PLAIN: b"text/plain",
        RTF: b"text/rtf",
        HTML: b"text/html",
        // `RUSTDESK_CLIPBOARD_OWNER_FORMAT`; arboard names the atom after the format.
        OWNER: b"dyn.com.rustdesk.owner",
    }
}

/// The owner marker of an entry the device placed (`ClipboardSide::Host`).
const HOST_OWNER_DATA: [u8; 1] = [0b01];

pub struct X11Provider {
    conn: Arc<RustConnection>,
    window: Window,
    atoms: Atoms,
    formats: Arc<Mutex<Vec<ClipboardFormat>>>,
}

/// An INCR transfer in progress, keyed by requestor window and property.
struct Incr {
    target: u32,
    data: Vec<u8>,
    sent: usize,
}

impl X11Provider {
    pub fn start() -> ResultType<Self> {
        let (conn, screen) = x11rb::connect(None)?;
        let conn = Arc::new(conn);
        let root = conn.setup().roots[screen].root;
        let window = conn.generate_id()?;
        conn.create_window(
            COPY_DEPTH_FROM_PARENT,
            window,
            root,
            0,
            0,
            1,
            1,
            0,
            WindowClass::INPUT_ONLY,
            COPY_FROM_PARENT,
            &CreateWindowAux::new(),
        )?;
        let atoms = Atoms::new(conn.as_ref())?.reply()?;
        conn.flush()?;
        let formats = Arc::new(Mutex::new(Vec::new()));
        let (c, f) = (conn.clone(), formats.clone());
        std::thread::Builder::new()
            .name("lazy-clipboard-x11".into())
            .spawn(move || serve(c, atoms, f))?;
        Ok(Self { conn, window, atoms, formats })
    }
}

impl Provider for X11Provider {
    fn place(&mut self, formats: &[ClipboardFormat]) -> ResultType<()> {
        *self.formats.lock().unwrap() = formats.to_vec();
        self.conn.set_selection_owner(self.window, self.atoms.CLIPBOARD, CURRENT_TIME)?;
        if self.conn.get_selection_owner(self.atoms.CLIPBOARD)?.reply()?.owner != self.window {
            bail!("another client kept the CLIPBOARD selection");
        }
        Ok(())
    }

    fn clear(&mut self) {
        self.formats.lock().unwrap().clear();
        let owned = self
            .conn
            .get_selection_owner(self.atoms.CLIPBOARD)
            .ok()
            .and_then(|c| c.reply().ok())
            .map_or(false, |r| r.owner == self.window);
        if owned {
            self.conn.set_selection_owner(NONE, self.atoms.CLIPBOARD, CURRENT_TIME).ok();
            self.conn.flush().ok();
        }
    }
}

fn serve(conn: Arc<RustConnection>, atoms: Atoms, formats: Arc<Mutex<Vec<ClipboardFormat>>>) {
    let chunk = (conn.maximum_request_bytes() / 2).min(256 * 1024);
    let mut incr: HashMap<(Window, u32), Incr> = HashMap::new();
    loop {
        let event = match conn.wait_for_event() {
            Ok(e) => e,
            Err(e) => {
                log::error!("lazy clipboard: X11 connection failed: {}", e);
                return;
            }
        };
        let r = match event {
            Event::SelectionRequest(req) => answer(&conn, &atoms, &formats, &mut incr, chunk, req),
            Event::SelectionClear(_) => {
                formats.lock().unwrap().clear();
                Ok(())
            }
            Event::PropertyNotify(e) => next_chunk(&conn, &mut incr, chunk, e),
            _ => Ok(()),
        };
        if let Err(e) = r.and_then(|_| conn.flush().map_err(Into::into)) {
            log::error!("lazy clipboard: X11 request failed: {}", e);
        }
    }
}

fn targets_of(atoms: &Atoms, format: ClipboardFormat) -> Vec<u32> {
    match format {
        ClipboardFormat::Text => vec![atoms.UTF8_STRING, atoms.TEXT_PLAIN_UTF8, atoms.TEXT_PLAIN],
        ClipboardFormat::Rtf => vec![atoms.RTF],
        ClipboardFormat::Html => vec![atoms.HTML],
        _ => vec![],
    }
}

fn answer(
    conn: &RustConnection,
    atoms: &Atoms,
    formats: &Mutex<Vec<ClipboardFormat>>,
    incr: &mut HashMap<(Window, u32), Incr>,
    chunk: usize,
    req: SelectionRequestEvent,
) -> ResultType<()> {
    let property = if req.property == NONE { req.target } else { req.property };
    let offered = formats.lock().unwrap().clone();
    let ok = if req.selection != atoms.CLIPBOARD || offered.is_empty() {
        false
    } else if req.target == atoms.TARGETS {
        let mut targets = vec![atoms.TARGETS, atoms.OWNER];
        for f in &offered {
            targets.extend(targets_of(atoms, *f));
        }
        conn.change_property32(PropMode::REPLACE, req.requestor, property, AtomEnum::ATOM, &targets)?;
        true
    } else if req.target == atoms.OWNER {
        conn.change_property8(PropMode::REPLACE, req.requestor, property, atoms.OWNER, &HOST_OWNER_DATA)?;
        true
    } else if let Some(format) =
        offered.iter().copied().find(|f| targets_of(atoms, *f).contains(&req.target))
    {
        match fetch(format) {
            Some(data) if data.len() > chunk => {
                conn.change_window_attributes(
                    req.requestor,
                    &ChangeWindowAttributesAux::new().event_mask(EventMask::PROPERTY_CHANGE),
                )?;
                conn.change_property32(PropMode::REPLACE, req.requestor, property, atoms.INCR, &[data.len() as u32])?;
                incr.insert((req.requestor, property), Incr { target: req.target, data, sent: 0 });
                true
            }
            Some(data) => {
                conn.change_property8(PropMode::REPLACE, req.requestor, property, req.target, &data)?;
                true
            }
            None => false,
        }
    } else {
        false
    };
    conn.send_event(
        false,
        req.requestor,
        EventMask::NO_EVENT,
        SelectionNotifyEvent {
            response_type: SELECTION_NOTIFY_EVENT,
            sequence: 0,
            time: req.time,
            requestor: req.requestor,
            selection: req.selection,
            target: req.target,
            property: if ok { property } else { NONE },
        },
    )?;
    Ok(())
}

/// Writes the next INCR chunk after the requestor deleted the previous one; a zero-length chunk
/// ends the transfer.
fn next_chunk(
    conn: &RustConnection,
    incr: &mut HashMap<(Window, u32), Incr>,
    chunk: usize,
    e: PropertyNotifyEvent,
) -> ResultType<()> {
    if e.state != Property::DELETE {
        return Ok(());
    }
    let key = (e.window, e.atom);
    let Some(t) = incr.get_mut(&key) else { return Ok(()) };
    let done = t.sent == t.data.len();
    let end = (t.sent + chunk).min(t.data.len());
    conn.change_property8(PropMode::REPLACE, e.window, e.atom, t.target, &t.data[t.sent..end])?;
    t.sent = end;
    if done {
        incr.remove(&key);
    }
    Ok(())
}
