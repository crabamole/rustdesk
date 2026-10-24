//! Viewer → device clipboard text on request (docs/design-clipboard-on-request.md): the viewer
//! offers format names, a platform provider places a lazy entry, and the content is requested from
//! the viewer only when an app on the device reads it.
use super::connection::Sender;
use base::message_proto::{
    Clipboard, ClipboardFormat, ClipboardOffer, ClipboardReply, ClipboardRequest, Message,
};
use hbb_common::{compress::decompress, log, tokio::time::Instant, ResultType};
use std::{
    sync::{mpsc, Arc, Mutex, OnceLock},
    time::Duration,
};

#[cfg(target_os = "linux")]
mod x11;
#[cfg(target_os = "windows")]
mod win;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(any(target_os = "windows", test))]
mod win_text;
#[cfg(any(target_os = "windows", test))]
pub mod cm;

/// How long an app on the device waits for the viewer's reply.
#[cfg(not(target_os = "macos"))]
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
/// macOS asks for the data on the main thread, which also runs the tray and remote input.
#[cfg(target_os = "macos")]
const REQUEST_TIMEOUT: Duration = Duration::from_secs(2);
const TEXT_FORMATS: [ClipboardFormat; 3] =
    [ClipboardFormat::Text, ClipboardFormat::Rtf, ClipboardFormat::Html];

/// Places and removes the lazy entry on the OS clipboard.
pub trait Provider: Send {
    /// Replaces the clipboard with an entry that offers `formats`; its data comes from [`fetch`].
    fn place(&mut self, formats: &[ClipboardFormat]) -> ResultType<()>;
    /// Removes the entry if the clipboard still holds it.
    fn clear(&mut self);
}

/// Viewer text that arrived for an open request (docs/design-clipboard-monitoring.md).
#[derive(Debug, PartialEq)]
pub struct Arrival {
    pub format: ClipboardFormat,
    pub size: usize,
}

struct Offer {
    conn_id: i32,
    seq: u32,
    formats: Vec<ClipboardFormat>,
    tx: Sender,
}

struct Waiter {
    id: u64,
    conn_id: i32,
    seq: u32,
    format: ClipboardFormat,
    tx: mpsc::Sender<Clipboard>,
}

struct Pending {
    id: u64,
    rx: mpsc::Receiver<Clipboard>,
    tx: Sender,
    msg: Message,
}

struct Hub {
    provider: Box<dyn Provider>,
    offer: Option<Offer>,
    waiters: Vec<Waiter>,
    next_id: u64,
}

impl Hub {
    fn new(provider: Box<dyn Provider>) -> Self {
        Self { provider, offer: None, waiters: Vec::new(), next_id: 0 }
    }

    fn offer(&mut self, conn_id: i32, tx: Sender, offer: ClipboardOffer) {
        let formats: Vec<ClipboardFormat> = offer
            .formats
            .iter()
            .filter_map(|f| f.enum_value().ok())
            .filter(|f| TEXT_FORMATS.contains(f))
            .collect();
        if formats.is_empty() {
            self.clear_if_owner(conn_id);
            return;
        }
        match self.provider.place(&formats) {
            Ok(()) => self.offer = Some(Offer { conn_id, seq: offer.seq, formats, tx }),
            Err(e) => {
                hbb_common::throttled_log!(
                    Duration::from_secs(60),
                    error,
                    "lazy clipboard: failed to place the entry: {}",
                    e
                );
                self.offer = None;
            }
        }
    }

    fn clear_if_owner(&mut self, conn_id: i32) {
        if self.offer.as_ref().map(|o| o.conn_id) == Some(conn_id) {
            self.offer = None;
            self.provider.clear();
        }
    }

    fn request(&mut self, format: ClipboardFormat) -> Option<Pending> {
        let offer = self.offer.as_ref().filter(|o| o.formats.contains(&format))?;
        self.next_id += 1;
        let (tx, rx) = mpsc::channel();
        self.waiters.push(Waiter {
            id: self.next_id,
            conn_id: offer.conn_id,
            seq: offer.seq,
            format,
            tx,
        });
        let mut msg = Message::new();
        msg.set_clipboard_request(ClipboardRequest {
            seq: offer.seq,
            format: format.into(),
            ..Default::default()
        });
        Some(Pending { id: self.next_id, rx, tx: offer.tx.clone(), msg })
    }

    fn reply(&mut self, conn_id: i32, reply: ClipboardReply) -> Option<Arrival> {
        let format = reply.clipboard.format.enum_value().ok();
        if let Some(i) = self.waiters.iter().position(|w| {
            w.conn_id == conn_id && w.seq == reply.seq && Some(w.format) == format
        }) {
            let waiter = self.waiters.remove(i);
            let size = content(reply.clipboard.clone().unwrap_or_default()).map_or(0, |d| d.len());
            waiter.tx.send(reply.clipboard.unwrap_or_default()).ok();
            return (size > 0).then_some(Arrival { format: waiter.format, size });
        }
        None
    }

    fn forget(&mut self, id: u64) {
        self.waiters.retain(|w| w.id != id);
    }

    fn close(&mut self, conn_id: i32) {
        self.waiters.retain(|w| w.conn_id != conn_id);
        self.clear_if_owner(conn_id);
    }
}

fn hub() -> &'static Mutex<Option<Hub>> {
    static HUB: OnceLock<Mutex<Option<Hub>>> = OnceLock::new();
    HUB.get_or_init(|| Mutex::new(start_provider().map(Hub::new)))
}

#[allow(unreachable_code)]
fn start_provider() -> Option<Box<dyn Provider>> {
    #[cfg(target_os = "linux")]
    if crate::platform::linux::is_x11() {
        return match x11::X11Provider::start() {
            Ok(p) => Some(Box::new(p)),
            Err(e) => {
                log::error!("lazy clipboard: X11 provider did not start: {}", e);
                None
            }
        };
    }
    // The installed service runs as SYSTEM; the user's `--cm` owns the clipboard entry instead.
    #[cfg(target_os = "windows")]
    if crate::platform::is_root() {
        return match cm::CmProvider::start() {
            Ok(p) => Some(Box::new(p)),
            Err(e) => {
                log::error!("lazy clipboard: --cm provider did not start: {}", e);
                None
            }
        };
    }
    #[cfg(target_os = "windows")]
    return match win::WindowsProvider::start(Arc::new(fetch)) {
        Ok(p) => Some(Box::new(p)),
        Err(e) => {
            log::error!("lazy clipboard: Windows provider did not start: {}", e);
            None
        }
    };
    #[cfg(target_os = "macos")]
    return match mac::MacProvider::start() {
        Ok(p) => Some(Box::new(p)),
        Err(e) => {
            log::error!("lazy clipboard: macOS provider did not start: {}", e);
            None
        }
    };
    log::info!("lazy clipboard: no provider on this platform");
    None
}

/// Whether this device takes viewer clipboard text on request (`lazy_text_clipboard`).
pub fn is_available() -> bool {
    hub().lock().unwrap().is_some()
}

pub fn on_offer(conn_id: i32, tx: Option<Sender>, offer: ClipboardOffer) {
    let Some(tx) = tx else { return };
    if let Some(hub) = hub().lock().unwrap().as_mut() {
        hub.offer(conn_id, tx, offer);
    }
}

pub fn on_reply(conn_id: i32, reply: ClipboardReply) -> Option<Arrival> {
    hub().lock().unwrap().as_mut()?.reply(conn_id, reply)
}

pub fn on_close(conn_id: i32) {
    if let Some(hub) = hub().lock().unwrap().as_mut() {
        hub.close(conn_id);
    }
}

/// The viewer's clipboard in `format`, requested when an app on the device reads it. Blocks for up
/// to `REQUEST_TIMEOUT`; `None` without an offer for it, on a timeout or on an empty reply.
pub fn fetch(format: ClipboardFormat) -> Option<Vec<u8>> {
    let pending = hub().lock().unwrap().as_mut()?.request(format)?;
    hbb_common::throttled_log!(Duration::from_secs(1), info, "lazy clipboard: request {:?}", format);
    if pending.tx.send((Instant::now(), Arc::new(pending.msg))).is_err() {
        forget(pending.id);
        return None;
    }
    match pending.rx.recv_timeout(REQUEST_TIMEOUT) {
        Ok(clipboard) => content(clipboard),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            hbb_common::throttled_log!(
                Duration::from_secs(60),
                warn,
                "lazy clipboard: no reply within {:?}",
                REQUEST_TIMEOUT
            );
            forget(pending.id);
            None
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => None,
    }
}

fn forget(id: u64) {
    if let Some(hub) = hub().lock().unwrap().as_mut() {
        hub.forget(id);
    }
}

fn content(clipboard: Clipboard) -> Option<Vec<u8>> {
    let data = if clipboard.compress {
        decompress(&clipboard.content)
    } else {
        clipboard.content.to_vec()
    };
    (!data.is_empty()).then_some(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base::message_proto::message;
    use hbb_common::{protobuf::MessageField, tokio::sync::mpsc::unbounded_channel};

    #[derive(Default)]
    struct Calls {
        placed: Vec<Vec<ClipboardFormat>>,
        cleared: usize,
    }

    struct Fake(Arc<Mutex<Calls>>);

    impl Provider for Fake {
        fn place(&mut self, formats: &[ClipboardFormat]) -> ResultType<()> {
            self.0.lock().unwrap().placed.push(formats.to_vec());
            Ok(())
        }
        fn clear(&mut self) {
            self.0.lock().unwrap().cleared += 1;
        }
    }

    fn fake_hub() -> (Hub, Arc<Mutex<Calls>>) {
        let calls = Arc::new(Mutex::new(Calls::default()));
        (Hub::new(Box::new(Fake(calls.clone()))), calls)
    }

    fn offer(seq: u32, formats: &[ClipboardFormat]) -> ClipboardOffer {
        ClipboardOffer {
            seq,
            formats: formats.iter().map(|f| (*f).into()).collect(),
            ..Default::default()
        }
    }

    fn reply(seq: u32, format: ClipboardFormat, text: &str) -> ClipboardReply {
        ClipboardReply {
            seq,
            clipboard: MessageField::some(Clipboard {
                format: format.into(),
                content: text.as_bytes().to_vec().into(),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    #[test]
    fn an_offer_places_its_text_formats_only() {
        let (mut hub, calls) = fake_hub();
        let (tx, _rx) = unbounded_channel();
        hub.offer(7, tx, offer(1, &[ClipboardFormat::Text, ClipboardFormat::ImagePng, ClipboardFormat::Html]));
        assert_eq!(calls.lock().unwrap().placed, vec![vec![ClipboardFormat::Text, ClipboardFormat::Html]]);
    }

    #[test]
    fn a_request_goes_to_the_offering_connection() {
        let (mut hub, _) = fake_hub();
        let (tx, mut rx) = unbounded_channel();
        hub.offer(7, tx, offer(3, &[ClipboardFormat::Text]));
        assert!(hub.request(ClipboardFormat::Html).is_none());
        let pending = hub.request(ClipboardFormat::Text).unwrap();
        pending.tx.send((Instant::now(), Arc::new(pending.msg))).unwrap();
        let (_, msg) = rx.try_recv().unwrap();
        let Some(message::Union::ClipboardRequest(req)) = &msg.union else { panic!("not a request") };
        assert_eq!((req.seq, req.format.enum_value()), (3, Ok(ClipboardFormat::Text)));
    }

    #[test]
    fn the_reply_reaches_the_waiting_app() {
        let (mut hub, _) = fake_hub();
        let (tx, _rx) = unbounded_channel();
        hub.offer(7, tx, offer(3, &[ClipboardFormat::Text]));
        let pending = hub.request(ClipboardFormat::Text).unwrap();
        hub.reply(7, reply(3, ClipboardFormat::Text, "hi"));
        assert_eq!(content(pending.rx.try_recv().unwrap()), Some(b"hi".to_vec()));
    }

    #[test]
    fn a_reply_for_another_offer_or_connection_is_dropped() {
        let (mut hub, _) = fake_hub();
        let (tx, _rx) = unbounded_channel();
        hub.offer(7, tx, offer(3, &[ClipboardFormat::Text]));
        let pending = hub.request(ClipboardFormat::Text).unwrap();
        hub.reply(7, reply(2, ClipboardFormat::Text, "old"));
        hub.reply(8, reply(3, ClipboardFormat::Text, "other"));
        assert_eq!(pending.rx.try_recv(), Err(mpsc::TryRecvError::Empty));
    }

    #[test]
    fn closing_the_offering_connection_clears_the_entry() {
        let (mut hub, calls) = fake_hub();
        let (tx, _rx) = unbounded_channel();
        hub.offer(7, tx, offer(3, &[ClipboardFormat::Text]));
        let pending = hub.request(ClipboardFormat::Text).unwrap();
        hub.close(8);
        assert_eq!(calls.lock().unwrap().cleared, 0);
        hub.close(7);
        assert_eq!(calls.lock().unwrap().cleared, 1);
        assert!(hub.request(ClipboardFormat::Text).is_none());
        assert_eq!(pending.rx.try_recv(), Err(mpsc::TryRecvError::Disconnected));
    }

    #[test]
    fn an_empty_offer_clears_only_its_own_entry() {
        let (mut hub, calls) = fake_hub();
        let (tx, _rx) = unbounded_channel();
        hub.offer(7, tx.clone(), offer(3, &[ClipboardFormat::Text]));
        hub.offer(8, tx.clone(), offer(1, &[]));
        assert_eq!(calls.lock().unwrap().cleared, 0);
        hub.offer(7, tx, offer(4, &[]));
        assert_eq!(calls.lock().unwrap().cleared, 1);
        assert!(hub.request(ClipboardFormat::Text).is_none());
    }

    fn arrival_hub() -> Hub {
        let (mut hub, _) = fake_hub();
        let (tx, _rx) = unbounded_channel();
        hub.offer(1, tx, offer(1, &[ClipboardFormat::Text]));
        hub.request(ClipboardFormat::Text).unwrap();
        hub
    }

    #[test]
    fn a_reply_to_an_open_request_is_an_arrival() {
        let mut hub = arrival_hub();
        assert_eq!(
            hub.reply(1, reply(1, ClipboardFormat::Text, "hello")),
            Some(Arrival { format: ClipboardFormat::Text, size: 5 })
        );
        assert_eq!(hub.reply(1, reply(1, ClipboardFormat::Text, "hello")), None);
    }

    #[test]
    fn a_stale_foreign_or_empty_reply_is_no_arrival() {
        let mut hub = arrival_hub();
        assert_eq!(hub.reply(1, reply(2, ClipboardFormat::Text, "hello")), None);
        assert_eq!(hub.reply(2, reply(1, ClipboardFormat::Text, "hello")), None);
        assert_eq!(hub.reply(1, reply(1, ClipboardFormat::Text, "")), None);
    }

    #[test]
    fn the_size_of_an_arrival_is_the_decompressed_size() {
        let mut hub = arrival_hub();
        let mut r = reply(1, ClipboardFormat::Text, "");
        r.clipboard = MessageField::some(Clipboard {
            format: ClipboardFormat::Text.into(),
            compress: true,
            content: hbb_common::compress::compress(b"hello").into(),
            ..Default::default()
        });
        assert_eq!(hub.reply(1, r), Some(Arrival { format: ClipboardFormat::Text, size: 5 }));
    }
}
