//! The viewer's side of clipboard text on request (docs/design-clipboard-on-request.md): offer the
//! format names of the local clipboard, send its content only when the device asks.
use crate::clipboard::{clipboard_listener, proto, ClipboardContext, ClipboardSide};
use base::message_proto::{
    message, Clipboard, ClipboardFormat, ClipboardOffer, ClipboardReply, ClipboardRequest, Message,
};
use hbb_common::log;

const TEXT_FORMATS: [ClipboardFormat; 3] =
    [ClipboardFormat::Text, ClipboardFormat::Rtf, ClipboardFormat::Html];

/// Whether the device takes clipboard text on request (`lazy_text_clipboard` in its PeerInfo).
pub fn device_supports(platform_additions: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(platform_additions)
        .ok()
        .and_then(|v| v.get("lazy_text_clipboard").and_then(|b| b.as_bool()))
        .unwrap_or(false)
}

/// The offer number: it changes with every change of the local clipboard.
fn seq() -> u32 {
    clipboard_listener::current_generation() as u32
}

/// The text formats on the local clipboard; read here, never sent with an offer.
fn local_text(ctx: &mut Option<ClipboardContext>) -> Vec<Clipboard> {
    if ctx.is_none() {
        *ctx = ClipboardContext::new().ok();
    }
    let Some(ctx) = ctx.as_mut() else { return vec![] };
    match ctx.get(ClipboardSide::Client, false) {
        Ok(data) => proto::create_multi_clipboards(data)
            .clipboards
            .into_iter()
            .filter(|c| c.format.enum_value().map_or(false, |f| TEXT_FORMATS.contains(&f)))
            .collect(),
        Err(e) => {
            log::trace!("clipboard offer: failed to read the clipboard: {}", e);
            vec![]
        }
    }
}

/// An offer of the local clipboard's text formats; an empty one withdraws the previous offer.
pub fn offer_msg(ctx: &mut Option<ClipboardContext>) -> Message {
    let formats = local_text(ctx).into_iter().map(|c| c.format).collect();
    let mut msg = Message::new();
    msg.set_clipboard_offer(ClipboardOffer { seq: seq(), formats, ..Default::default() });
    msg
}

/// Whether `req` is for the offer this connection sent last (`sent`), and that offer is still
/// the current one.
fn answers(sent: Option<u32>, current: u32, req: &ClipboardRequest) -> bool {
    sent == Some(req.seq) && req.seq == current
}

/// The reply to a device's request: the format as it is now; empty when not `allowed`, when the
/// request is not for the last offer `sent` on this connection or that offer is old, or when the
/// format is gone.
pub fn reply_msg(req: &ClipboardRequest, sent: Option<u32>, allowed: bool) -> Message {
    let format = req.format.enum_value().unwrap_or(ClipboardFormat::Text);
    let clipboard = (allowed && answers(sent, seq(), req))
        .then(|| local_text(&mut None).into_iter().find(|c| c.format.enum_value() == Ok(format)))
        .flatten()
        .unwrap_or_else(|| Clipboard { format: format.into(), ..Default::default() });
    let mut msg = Message::new();
    msg.set_clipboard_reply(ClipboardReply {
        seq: req.seq,
        clipboard: Some(clipboard).into(),
        ..Default::default()
    });
    msg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_device_flag_is_read_from_platform_additions() {
        assert!(device_supports(r#"{"lazy_text_clipboard":true,"x":1}"#));
        assert!(!device_supports(r#"{"lazy_text_clipboard":false}"#));
        assert!(!device_supports(r#"{"has_file_clipboard":true}"#));
        assert!(!device_supports(""));
    }

    fn reply_of(msg: Message) -> ClipboardReply {
        match msg.union {
            Some(message::Union::ClipboardReply(r)) => r,
            _ => panic!("not a reply"),
        }
    }

    #[test]
    fn a_refused_request_gets_an_empty_reply_in_its_format() {
        let req = ClipboardRequest { seq: seq(), format: ClipboardFormat::Html.into(), ..Default::default() };
        let r = reply_of(reply_msg(&req, Some(req.seq), false));
        assert_eq!(r.seq, req.seq);
        assert_eq!(r.clipboard.format.enum_value(), Ok(ClipboardFormat::Html));
        assert!(r.clipboard.content.is_empty());
    }

    #[test]
    fn a_request_for_an_older_offer_gets_an_empty_reply() {
        let req = ClipboardRequest { seq: seq().wrapping_add(1), format: ClipboardFormat::Text.into(), ..Default::default() };
        assert!(reply_of(reply_msg(&req, Some(req.seq), true)).clipboard.content.is_empty());
    }

    #[test]
    fn only_a_request_for_the_offer_sent_that_is_still_current_is_answered() {
        let req = ClipboardRequest { seq: 7, ..Default::default() };
        assert!(answers(Some(7), 7, &req));
        assert!(!answers(None, 7, &req));
        assert!(!answers(Some(6), 7, &req));
        assert!(!answers(Some(7), 8, &req));
    }

    #[test]
    fn a_request_without_an_offer_sent_gets_an_empty_reply() {
        let req = ClipboardRequest { seq: seq(), format: ClipboardFormat::Text.into(), ..Default::default() };
        assert!(reply_of(reply_msg(&req, None, true)).clipboard.content.is_empty());
    }
}
