//! Windows installed service: `--server` runs as SYSTEM, and Defender's session helper reads a
//! delayed clipboard entry owned by a SYSTEM process at once. So the user's `--cm` owns the entry:
//! `--server` sends it the offered formats over `_cm` and answers its requests from [`fetch`].
#[cfg(target_os = "windows")]
use super::{fetch, win::WindowsProvider, Provider, REQUEST_TIMEOUT};
use crate::ipc::LazyClipboardIpc;
#[cfg(target_os = "windows")]
use crate::ipc::{ConnectionTmpl, Data};
#[cfg(target_os = "windows")]
use base::message_proto::ClipboardFormat;
#[cfg(target_os = "windows")]
use hbb_common::{
    anyhow::anyhow,
    log,
    protobuf::Enum,
    tokio::{
        self,
        sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender},
    },
    ResultType,
};
#[cfg(target_os = "windows")]
use std::sync::{Arc, Mutex, OnceLock};
use std::{collections::HashMap, sync::mpsc, time::Duration};

#[cfg(target_os = "windows")]
type Link = ConnectionTmpl<parity_tokio_ipc::ConnectionClient>;

/// `--server`: hands the entry to `--cm` through the `lazy-clipboard-cm` thread.
#[cfg(target_os = "windows")]
pub struct CmProvider {
    tx: UnboundedSender<LazyClipboardIpc>,
}

#[cfg(target_os = "windows")]
impl CmProvider {
    pub fn start() -> ResultType<Self> {
        let (tx, rx) = unbounded_channel();
        let replies = tx.clone();
        std::thread::Builder::new()
            .name("lazy-clipboard-cm".into())
            .spawn(move || serve(rx, replies))?;
        Ok(Self { tx })
    }
}

#[cfg(target_os = "windows")]
impl Provider for CmProvider {
    fn place(&mut self, formats: &[ClipboardFormat]) -> ResultType<()> {
        let formats = formats.iter().map(|f| f.value()).collect();
        self.tx
            .send(LazyClipboardIpc::Place(formats))
            .map_err(|_| anyhow!("the --cm link thread is gone"))
    }

    fn clear(&mut self) {
        self.tx.send(LazyClipboardIpc::Clear).ok();
    }
}

#[cfg(target_os = "windows")]
fn serve(mut rx: UnboundedReceiver<LazyClipboardIpc>, replies: UnboundedSender<LazyClipboardIpc>) {
    let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            log::error!("lazy clipboard: no runtime for the --cm link: {}", e);
            return;
        }
    };
    rt.block_on(async move {
        let mut link: Option<Link> = None;
        loop {
            let Some(conn) = link.as_mut() else {
                let Some(cmd) = rx.recv().await else { return };
                // `--cm` drops its entry when the link ends, so only a new offer needs one.
                if matches!(cmd, LazyClipboardIpc::Place(_)) {
                    link = connect(cmd).await;
                }
                continue;
            };
            let lost = tokio::select! {
                cmd = rx.recv() => {
                    let Some(cmd) = cmd else { return };
                    match conn.send(&Data::LazyClipboard(cmd)).await {
                        Ok(()) => false,
                        Err(e) => {
                            hbb_common::throttled_log!(
                                Duration::from_secs(60),
                                warn,
                                "lazy clipboard: --cm link lost: {}",
                                e
                            );
                            true
                        }
                    }
                }
                res = conn.next() => match res {
                    Ok(Some(Data::LazyClipboard(LazyClipboardIpc::Request { id, format }))) => {
                        answer(id, format, replies.clone());
                        false
                    }
                    Ok(_) => false,
                    Err(_) => true,
                },
            };
            if lost {
                link = None;
            }
        }
    });
}

#[cfg(target_os = "windows")]
async fn connect(place: LazyClipboardIpc) -> Option<Link> {
    // The first offer comes at session start, while `--cm` may still be starting; retry as
    // `connection.rs` `start_ipc` does.
    let mut tries = 0;
    let mut conn = loop {
        match crate::ipc::connect(1000, "_cm").await {
            Ok(conn) => break conn,
            Err(_) if tries < 20 => {
                tries += 1;
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            Err(e) => {
                hbb_common::throttled_log!(
                    Duration::from_secs(60),
                    warn,
                    "lazy clipboard: no --cm to own the entry: {}",
                    e
                );
                return None;
            }
        }
    };
    if let Err(e) = conn.send(&Data::LazyClipboard(place)).await {
        hbb_common::throttled_log!(
            Duration::from_secs(60),
            warn,
            "lazy clipboard: failed to send the entry to --cm: {}",
            e
        );
        return None;
    }
    Some(conn)
}

/// [`fetch`] blocks until the viewer replies, so it runs off the link thread.
#[cfg(target_os = "windows")]
fn answer(id: u32, format: i32, replies: UnboundedSender<LazyClipboardIpc>) {
    let spawned = std::thread::Builder::new()
        .name("lazy-clipboard-fetch".into())
        .spawn(move || {
            let data = ClipboardFormat::from_i32(format).and_then(fetch);
            replies.send(LazyClipboardIpc::Reply { id, data }).ok();
        });
    if let Err(e) = spawned {
        hbb_common::throttled_log!(
            Duration::from_secs(60),
            error,
            "lazy clipboard: failed to start a fetch: {}",
            e
        );
    }
}

/// `--cm`: the entry on the clipboard, and the `--server` connection its data comes from.
#[cfg(target_os = "windows")]
#[derive(Default)]
struct CmSide {
    provider: Option<WindowsProvider>,
    link: Option<UnboundedSender<Data>>,
    waiters: Waiters,
}

#[cfg(target_os = "windows")]
impl CmSide {
    fn is_link(&self, tx: &UnboundedSender<Data>) -> bool {
        self.link.as_ref().is_some_and(|l| l.same_channel(tx))
    }
}

#[cfg(target_os = "windows")]
fn cm_side() -> &'static Mutex<CmSide> {
    static SIDE: OnceLock<Mutex<CmSide>> = OnceLock::new();
    SIDE.get_or_init(Default::default)
}

/// `--cm`: handles `msg` from `--server`; `tx` sends back on the same IPC connection.
#[cfg(target_os = "windows")]
pub fn on_ipc(msg: LazyClipboardIpc, tx: &UnboundedSender<Data>) {
    let mut side = cm_side().lock().unwrap();
    match msg {
        LazyClipboardIpc::Place(formats) => {
            if !side.is_link(tx) {
                side.link = Some(tx.clone());
                watch(tx.clone());
            }
            if side.provider.is_none() {
                match WindowsProvider::start(Arc::new(fetch_from_server)) {
                    Ok(p) => side.provider = Some(p),
                    Err(e) => {
                        hbb_common::throttled_log!(
                            Duration::from_secs(60),
                            error,
                            "lazy clipboard: Windows provider did not start: {}",
                            e
                        );
                        return;
                    }
                }
            }
            let formats: Vec<ClipboardFormat> =
                formats.into_iter().filter_map(ClipboardFormat::from_i32).collect();
            if let Some(Err(e)) = side.provider.as_mut().map(|p| p.place(&formats)) {
                hbb_common::throttled_log!(
                    Duration::from_secs(60),
                    error,
                    "lazy clipboard: failed to place the entry: {}",
                    e
                );
            }
        }
        LazyClipboardIpc::Clear => {
            if side.is_link(tx) {
                if let Some(p) = side.provider.as_mut() {
                    p.clear();
                }
            }
        }
        LazyClipboardIpc::Reply { id, data } => {
            if side.is_link(tx) {
                side.waiters.deliver(id, data);
            }
        }
        LazyClipboardIpc::Request { .. } => {}
    }
}

/// Drops the entry when the `--server` connection that placed it ends.
#[cfg(target_os = "windows")]
fn watch(link: UnboundedSender<Data>) {
    tokio::spawn(async move {
        link.closed().await;
        let mut side = cm_side().lock().unwrap();
        if side.is_link(&link) {
            side.link = None;
            side.waiters.waiting.clear();
            if let Some(p) = side.provider.as_mut() {
                p.clear();
            }
        }
    });
}

/// `--server` waits `REQUEST_TIMEOUT` for the viewer; the extra second leaves room for the IPC hops,
/// so a reply that arrives near that limit is not dropped here.
#[cfg(target_os = "windows")]
const CM_WAIT: Duration = REQUEST_TIMEOUT.saturating_add(Duration::from_secs(1));

/// Runs on the provider's window thread when an app reads a format.
#[cfg(target_os = "windows")]
fn fetch_from_server(format: ClipboardFormat) -> Option<Vec<u8>> {
    let (id, rx) = {
        let mut side = cm_side().lock().unwrap();
        let link = side.link.clone()?;
        let (id, rx) = side.waiters.add();
        let request = LazyClipboardIpc::Request { id, format: format.value() };
        if link.send(Data::LazyClipboard(request)).is_err() {
            side.waiters.forget(id);
            return None;
        }
        (id, rx)
    };
    let data = wait(&rx, CM_WAIT);
    cm_side().lock().unwrap().waiters.forget(id);
    data
}

/// Requests sent to `--server`, keyed by id, until the matching reply arrives.
#[derive(Default)]
struct Waiters {
    next_id: u32,
    waiting: HashMap<u32, mpsc::Sender<Option<Vec<u8>>>>,
}

impl Waiters {
    fn add(&mut self) -> (u32, mpsc::Receiver<Option<Vec<u8>>>) {
        self.next_id = self.next_id.wrapping_add(1);
        let (tx, rx) = mpsc::channel();
        self.waiting.insert(self.next_id, tx);
        (self.next_id, rx)
    }

    fn deliver(&mut self, id: u32, data: Option<Vec<u8>>) {
        if let Some(tx) = self.waiting.remove(&id) {
            tx.send(data).ok();
        }
    }

    #[cfg(target_os = "windows")]
    fn forget(&mut self, id: u32) {
        self.waiting.remove(&id);
    }
}

fn wait(rx: &mpsc::Receiver<Option<Vec<u8>>>, timeout: Duration) -> Option<Vec<u8>> {
    rx.recv_timeout(timeout).ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::Data;

    #[test]
    fn lazy_clipboard_ipc_survives_serde() {
        for msg in [
            LazyClipboardIpc::Place(vec![0, 2]),
            LazyClipboardIpc::Clear,
            LazyClipboardIpc::Request { id: 7, format: 1 },
            LazyClipboardIpc::Reply { id: 7, data: Some(b"hi".to_vec()) },
            LazyClipboardIpc::Reply { id: 8, data: None },
        ] {
            let json = serde_json::to_string(&Data::LazyClipboard(msg.clone())).unwrap();
            let Data::LazyClipboard(back) = serde_json::from_str(&json).unwrap() else {
                panic!("not a lazy clipboard message: {}", json)
            };
            assert_eq!(back, msg);
        }
    }

    #[test]
    fn a_reply_reaches_the_request_with_its_id() {
        let mut waiters = Waiters::default();
        let (first, first_rx) = waiters.add();
        let (second, second_rx) = waiters.add();
        waiters.deliver(second, Some(b"hi".to_vec()));
        waiters.deliver(second + 100, Some(b"stray".to_vec()));
        assert_eq!(wait(&second_rx, Duration::from_millis(10)), Some(b"hi".to_vec()));
        assert_eq!(first_rx.try_recv(), Err(mpsc::TryRecvError::Empty));
        waiters.deliver(first, None);
        assert_eq!(wait(&first_rx, Duration::from_millis(10)), None);
    }

    #[test]
    fn no_reply_in_time_gives_nothing() {
        let mut waiters = Waiters::default();
        let (_, rx) = waiters.add();
        assert_eq!(wait(&rx, Duration::from_millis(10)), None);
    }
}
