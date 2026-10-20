//! macOS: one pasteboard item whose text types come from a data provider; macOS calls it, on the
//! main thread, when an app reads a type.
use super::{fetch, Provider};
use base::message_proto::ClipboardFormat;
use hbb_common::{log, ResultType};
use objc2::{
    declare_class, msg_send_id, mutability,
    rc::{autoreleasepool, Id},
    runtime::{NSObject, NSObjectProtocol, ProtocolObject},
    ClassType, DeclaredClass,
};
use objc2_app_kit::{
    NSPasteboard, NSPasteboardItem, NSPasteboardItemDataProvider, NSPasteboardType,
    NSPasteboardTypeHTML, NSPasteboardTypeRTF, NSPasteboardTypeString,
};
use objc2_foundation::{NSArray, NSData, NSString};
use std::{sync::mpsc, time::Duration};

/// `RUSTDESK_CLIPBOARD_OWNER_FORMAT` and the marker of an entry the device placed.
const OWNER_FORMAT: &str = "dyn.com.rustdesk.owner";
const HOST_OWNER_DATA: [u8; 1] = [0b01];

declare_class!(
    struct TextProvider;

    unsafe impl ClassType for TextProvider {
        type Super = NSObject;
        type Mutability = mutability::InteriorMutable;
        const NAME: &'static str = "CrabamoleLazyTextProvider";
    }

    impl DeclaredClass for TextProvider {
        type Ivars = ();
    }

    unsafe impl NSObjectProtocol for TextProvider {}

    unsafe impl NSPasteboardItemDataProvider for TextProvider {
        #[method(pasteboard:item:provideDataForType:)]
        #[allow(non_snake_case)]
        unsafe fn pasteboard_item_provideDataForType(
            &self,
            _pasteboard: Option<&NSPasteboard>,
            item: &NSPasteboardItem,
            r#type: &NSPasteboardType,
        ) {
            provide(item, r#type);
        }
    }
);

fn new_provider() -> Id<TextProvider> {
    let this = TextProvider::alloc().set_ivars(());
    unsafe { msg_send_id![super(this), init] }
}

unsafe fn pasteboard_type(format: ClipboardFormat) -> Option<&'static NSPasteboardType> {
    match format {
        ClipboardFormat::Text => Some(NSPasteboardTypeString),
        ClipboardFormat::Rtf => Some(NSPasteboardTypeRTF),
        ClipboardFormat::Html => Some(NSPasteboardTypeHTML),
        _ => None,
    }
}

unsafe fn provide(item: &NSPasteboardItem, r#type: &NSPasteboardType) {
    let Some(format) = [ClipboardFormat::Text, ClipboardFormat::Rtf, ClipboardFormat::Html]
        .into_iter()
        .find(|f| pasteboard_type(*f).map_or(false, |t| t == r#type))
    else {
        return;
    };
    if let Some(data) = fetch(format) {
        item.setData_forType(&NSData::with_bytes(&data), r#type);
    }
}

enum Command {
    Place(Vec<ClipboardFormat>),
    Clear,
}

pub struct MacProvider {
    tx: mpsc::Sender<Command>,
}

impl MacProvider {
    pub fn start() -> ResultType<Self> {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("lazy-clipboard-mac".into())
            .spawn(move || serve(rx))?;
        Ok(Self { tx })
    }
}

impl Provider for MacProvider {
    fn place(&mut self, formats: &[ClipboardFormat]) -> ResultType<()> {
        self.tx.send(Command::Place(formats.to_vec()))?;
        Ok(())
    }

    fn clear(&mut self) {
        self.tx.send(Command::Clear).ok();
    }
}

/// Writes on its own thread: macOS calls the provider on the main thread, which must stay free
/// while the hub lock is held.
fn serve(rx: mpsc::Receiver<Command>) {
    // The change count after our write, and the provider the item refers to.
    let mut placed: Option<(isize, Id<TextProvider>)> = None;
    for command in rx {
        autoreleasepool(|_| unsafe {
            let pasteboard = NSPasteboard::generalPasteboard();
            match command {
                Command::Place(formats) => {
                    let provider = new_provider();
                    let types = NSArray::from_vec(
                        formats
                            .iter()
                            .filter_map(|f| pasteboard_type(*f))
                            .map(|t| NSString::from_str(&t.to_string()))
                            .collect(),
                    );
                    let item = NSPasteboardItem::new();
                    item.setDataProvider_forTypes(&ProtocolObject::from_id(provider.clone()), &types);
                    item.setData_forType(
                        &NSData::with_bytes(&HOST_OWNER_DATA),
                        &NSString::from_str(OWNER_FORMAT),
                    );
                    pasteboard.clearContents();
                    if pasteboard.writeObjects(&Id::cast(NSArray::from_vec(vec![item]))) {
                        placed = Some((pasteboard.changeCount(), provider));
                    } else {
                        placed = None;
                        hbb_common::throttled_log!(
                            Duration::from_secs(60),
                            error,
                            "lazy clipboard: failed to write the pasteboard item"
                        );
                    }
                }
                Command::Clear => {
                    if placed.as_ref().map(|(count, _)| *count) == Some(pasteboard.changeCount()) {
                        pasteboard.clearContents();
                    }
                    placed = None;
                }
            }
        });
    }
    log::info!("lazy clipboard: macOS provider stopped");
}
