include!(concat!(env!("OUT_DIR"), "/protos/mod.rs"));

#[cfg(test)]
mod tests {
    use super::message::*;
    use protobuf::Message as _;

    fn first_tag(msg: Message) -> u64 {
        let bytes = msg.write_to_bytes().unwrap();
        let mut is = protobuf::CodedInputStream::from_bytes(&bytes);
        is.read_raw_varint64().unwrap() >> 3
    }

    #[test]
    fn os_login_uses_the_stock_field_number() {
        let mut msg = Message::new();
        msg.set_os_login(OSLogin { password: "p".into(), ..Default::default() });
        assert_eq!(first_tag(msg), 34);
    }

    #[test]
    fn clipboard_messages_use_our_field_numbers() {
        let mut msg = Message::new();
        msg.set_clipboard_offer(ClipboardOffer { seq: 1, ..Default::default() });
        assert_eq!(first_tag(msg), 1001);
        let mut msg = Message::new();
        msg.set_clipboard_request(ClipboardRequest { seq: 1, ..Default::default() });
        assert_eq!(first_tag(msg), 1002);
        let mut msg = Message::new();
        msg.set_clipboard_reply(ClipboardReply { seq: 1, ..Default::default() });
        assert_eq!(first_tag(msg), 1003);
    }
}
