//! Calls to the api-server that the device signs with its key (docs/design-signed-device-calls.md).
use hbb_common::{config::Config, sodiumoxide::crypto::sign};
use sha2::{Digest, Sha256};

/// The bytes the device signs; the api-server (`device_call::message`) builds the same.
pub fn message(ts: &str, path: &str, body: &[u8]) -> Vec<u8> {
    let digest: String = Sha256::digest(body).iter().map(|b| format!("{b:02x}")).collect();
    [b"device-call".as_slice(), ts.as_bytes(), path.as_bytes(), digest.as_bytes()].join(&0u8)
}

/// The `X-Device-Signature` header for a POST of `body` to `url`, signed now; empty when the device
/// has no usable key. The signed path starts at `/api/`, as the api-server sees it behind a proxy
/// that strips a prefix.
pub fn header(url: &str, body: &str) -> String {
    let Some(sk) = sign::SecretKey::from_slice(&Config::get_key_pair().0) else {
        return String::new();
    };
    let path = url::Url::parse(url).map(|u| u.path().to_owned()).unwrap_or_default();
    let path = &path[path.find("/api/").unwrap_or(0)..];
    format!("X-Device-Signature: {}", signature(&sk, hbb_common::get_time() / 1000, path, body))
}

/// `<ts>.<base64 signature>` of `body` posted to `path` at `ts`.
fn signature(sk: &sign::SecretKey, ts: i64, path: &str, body: &str) -> String {
    let sig = sign::sign_detached(&message(&ts.to_string(), path, body.as_bytes()), sk);
    format!("{ts}.{}", hbb_common::base64::encode(sig.to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_matches_the_api_server() {
        assert_eq!(
            message("1800000000", "/api/heartbeat", b"{}"),
            b"device-call\x001800000000\x00/api/heartbeat\x0044136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
                .to_vec()
        );
    }

    /// The api-server's `device_call` tests verify the same signature.
    #[test]
    fn signature_matches_the_api_server() {
        let (_, sk) = sign::keypair_from_seed(&sign::Seed([7; 32]));
        assert_eq!(
            signature(&sk, 1800000000, "/api/heartbeat", "{}"),
            "1800000000.2GuRO1FkhojSdpBOJYhJwk1UjQmu2OkX0qdzo0t1jzSIAZ6S58cRy5hlpiQarK3QLAVWpLr5MOHY4IgT1W/RCQ=="
        );
    }
}
