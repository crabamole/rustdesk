//! The bytes Windows apps expect for each text format.

/// CF_UNICODETEXT: UTF-16LE with a terminating NUL.
pub fn utf16_text(utf8: &[u8]) -> Vec<u8> {
    String::from_utf8_lossy(utf8)
        .encode_utf16()
        .chain(Some(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}

/// "HTML Format" (CF_HTML): the fragment inside the header Windows apps parse.
pub fn cf_html(fragment: &[u8]) -> Vec<u8> {
    const BEFORE: &[u8] = b"\r\n<html>\r\n<body>\r\n<!--StartFragment-->";
    const AFTER: &[u8] = b"<!--EndFragment-->\r\n</body>\r\n</html>";
    // Fixed-width offsets keep the header length independent of the values.
    let header_len = format!(
        "Version:0.9\r\nStartHTML:{:010}\r\nEndHTML:{:010}\r\nStartFragment:{:010}\r\nEndFragment:{:010}",
        0, 0, 0, 0
    )
    .len();
    let start_html = header_len + 2;
    let start_fragment = header_len + BEFORE.len();
    let end_fragment = start_fragment + fragment.len();
    let end_html = end_fragment + AFTER.len();
    let mut out = format!(
        "Version:0.9\r\nStartHTML:{:010}\r\nEndHTML:{:010}\r\nStartFragment:{:010}\r\nEndFragment:{:010}",
        start_html, end_html, start_fragment, end_fragment
    )
    .into_bytes();
    out.extend_from_slice(BEFORE);
    out.extend_from_slice(fragment);
    out.extend_from_slice(AFTER);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn offset(header: &str, key: &str) -> usize {
        let line = header.lines().find(|l| l.starts_with(key)).unwrap();
        line[key.len()..].trim().parse().unwrap()
    }

    #[test]
    fn text_is_nul_terminated_utf16() {
        assert_eq!(utf16_text("hé".as_bytes()), vec![0x68, 0, 0xe9, 0, 0, 0]);
    }

    #[test]
    fn html_offsets_point_at_the_fragment() {
        let fragment = "<b>héllo</b>";
        let out = cf_html(fragment.as_bytes());
        let text = String::from_utf8(out.clone()).unwrap();
        let (start, end) = (offset(&text, "StartFragment:"), offset(&text, "EndFragment:"));
        assert_eq!(&out[start..end], fragment.as_bytes());
        assert!(text[offset(&text, "StartHTML:")..].starts_with("<html>"));
        assert_eq!(offset(&text, "EndHTML:"), out.len());
    }
}
