//! Windows: a message-only window owns the clipboard with delayed rendering; `WM_RENDERFORMAT`
//! fetches the viewer's data only when an app reads a format.
use super::{win_text, Provider};
use base::message_proto::ClipboardFormat;
use hbb_common::{anyhow::anyhow, bail, log, ResultType};
use std::{
    ptr::{null, null_mut},
    sync::{mpsc, Arc, Mutex, OnceLock},
    time::Duration,
};
use winapi::{
    shared::{
        minwindef::{HGLOBAL, LPARAM, LRESULT, UINT, WPARAM},
        windef::HWND,
    },
    um::{
        errhandlingapi::GetLastError,
        libloaderapi::GetModuleHandleW,
        winbase::{GlobalAlloc, GlobalFree, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        winuser::{
            CloseClipboard, CreateWindowExW, DefWindowProcW, DispatchMessageW, EmptyClipboard,
            GetClipboardOwner, GetMessageW, OpenClipboard, PostMessageW, RegisterClassW,
            RegisterClipboardFormatW, SetClipboardData, TranslateMessage, CF_UNICODETEXT,
            HWND_MESSAGE, MSG, WM_APP, WM_RENDERALLFORMATS, WM_RENDERFORMAT, WNDCLASSW,
        },
    },
};

const WM_PLACE: UINT = WM_APP + 1;
const WM_CLEAR: UINT = WM_APP + 2;
/// `RUSTDESK_CLIPBOARD_OWNER_FORMAT` and the marker of an entry the device placed.
const OWNER_FORMAT: &str = "dyn.com.rustdesk.owner";
const HOST_OWNER_DATA: [u8; 1] = [0b01];

/// Gets the viewer's data for a format an app reads; blocks until it arrives or times out.
pub type Fetch = Arc<dyn Fn(ClipboardFormat) -> Option<Vec<u8>> + Send + Sync>;

struct Shared {
    rtf: UINT,
    html: UINT,
    owner: UINT,
    offered: Mutex<Vec<ClipboardFormat>>,
    fetch: Fetch,
}

impl Shared {
    fn id(&self, format: ClipboardFormat) -> Option<UINT> {
        match format {
            ClipboardFormat::Text => Some(CF_UNICODETEXT),
            ClipboardFormat::Rtf => Some(self.rtf),
            ClipboardFormat::Html => Some(self.html),
            _ => None,
        }
    }

    fn format(&self, id: UINT) -> Option<ClipboardFormat> {
        [ClipboardFormat::Text, ClipboardFormat::Rtf, ClipboardFormat::Html]
            .into_iter()
            .find(|f| self.id(*f) == Some(id))
    }
}

/// The window procedure has no context pointer, so the one provider keeps its state here.
static SHARED: OnceLock<Shared> = OnceLock::new();

pub struct WindowsProvider {
    hwnd: usize,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

fn register(name: &str) -> ResultType<UINT> {
    let id = unsafe { RegisterClipboardFormatW(wide(name).as_ptr()) };
    if id == 0 {
        bail!("RegisterClipboardFormatW({}) failed: {}", name, unsafe { GetLastError() });
    }
    Ok(id)
}

impl WindowsProvider {
    pub fn start(fetch: Fetch) -> ResultType<Self> {
        let shared = Shared {
            rtf: register("Rich Text Format")?,
            html: register("HTML Format")?,
            owner: register(OWNER_FORMAT)?,
            offered: Mutex::new(Vec::new()),
            fetch,
        };
        if SHARED.set(shared).is_err() {
            bail!("the Windows provider started twice");
        }
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("lazy-clipboard-win".into())
            .spawn(move || serve(tx))?;
        let hwnd = rx.recv()??;
        Ok(Self { hwnd })
    }

    fn post(&self, msg: UINT) -> ResultType<()> {
        if unsafe { PostMessageW(self.hwnd as HWND, msg, 0, 0) } == 0 {
            bail!("PostMessageW failed: {}", unsafe { GetLastError() });
        }
        Ok(())
    }
}

impl Provider for WindowsProvider {
    fn place(&mut self, formats: &[ClipboardFormat]) -> ResultType<()> {
        let Some(shared) = SHARED.get() else { bail!("no provider state") };
        *shared.offered.lock().unwrap() = formats.to_vec();
        self.post(WM_PLACE)
    }

    fn clear(&mut self) {
        if let Some(shared) = SHARED.get() {
            shared.offered.lock().unwrap().clear();
        }
        self.post(WM_CLEAR).ok();
    }
}

fn serve(tx: mpsc::Sender<ResultType<usize>>) {
    let class = wide("CrabamoleLazyClipboard");
    let hwnd = unsafe {
        let instance = GetModuleHandleW(null());
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance,
            lpszClassName: class.as_ptr(),
            ..std::mem::zeroed()
        };
        RegisterClassW(&wc);
        CreateWindowExW(
            0,
            class.as_ptr(),
            class.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            null_mut(),
            instance,
            null_mut(),
        )
    };
    if hwnd.is_null() {
        tx.send(Err(anyhow!("CreateWindowExW failed: {}", unsafe { GetLastError() })))
            .ok();
        return;
    }
    tx.send(Ok(hwnd as usize)).ok();
    let mut msg: MSG = unsafe { std::mem::zeroed() };
    while unsafe { GetMessageW(&mut msg, null_mut(), 0, 0) } > 0 {
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: UINT, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let Some(shared) = SHARED.get() else {
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    };
    match msg {
        WM_PLACE => {
            place_entry(hwnd, shared);
            0
        }
        WM_CLEAR => {
            if GetClipboardOwner() == hwnd && open(hwnd) {
                EmptyClipboard();
                CloseClipboard();
            }
            0
        }
        WM_RENDERFORMAT => {
            render(shared, wparam as UINT);
            0
        }
        // Rendering everything on exit would fetch every format from the viewer.
        WM_RENDERALLFORMATS => 0,
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

/// Another app may hold the clipboard open for a moment.
unsafe fn open(hwnd: HWND) -> bool {
    for _ in 0..10 {
        if OpenClipboard(hwnd) != 0 {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

unsafe fn place_entry(hwnd: HWND, shared: &Shared) {
    let formats = shared.offered.lock().unwrap().clone();
    if formats.is_empty() {
        return;
    }
    if !open(hwnd) {
        hbb_common::throttled_log!(
            Duration::from_secs(60),
            error,
            "lazy clipboard: OpenClipboard failed: {}",
            GetLastError()
        );
        return;
    }
    EmptyClipboard();
    for id in formats.iter().filter_map(|f| shared.id(*f)) {
        SetClipboardData(id, null_mut());
    }
    set_data(shared.owner, &HOST_OWNER_DATA);
    CloseClipboard();
}

unsafe fn render(shared: &Shared, id: UINT) {
    let Some(format) = shared.format(id) else { return };
    if !shared.offered.lock().unwrap().contains(&format) {
        return;
    }
    let Some(data) = (shared.fetch)(format) else { return };
    let data = match format {
        ClipboardFormat::Text => win_text::utf16_text(&data),
        ClipboardFormat::Html => win_text::cf_html(&data),
        _ => data,
    };
    set_data(id, &data);
}

/// Hands `data` to the clipboard, which then owns the memory.
unsafe fn set_data(id: UINT, data: &[u8]) {
    let h: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, data.len().max(1) as _);
    if h.is_null() {
        return;
    }
    let p = GlobalLock(h) as *mut u8;
    if p.is_null() {
        GlobalFree(h);
        return;
    }
    std::ptr::copy_nonoverlapping(data.as_ptr(), p, data.len());
    GlobalUnlock(h);
    if SetClipboardData(id, h).is_null() {
        log::debug!("lazy clipboard: SetClipboardData({}) failed: {}", id, GetLastError());
        GlobalFree(h);
    }
}
