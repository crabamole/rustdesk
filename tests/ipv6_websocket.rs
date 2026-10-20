// Its own binary: the websocket override is process-wide and would switch ws mode on for
// lib tests running in parallel.
use hbb_common::config::{keys, OVERWRITE_SETTINGS};

#[tokio::test]
async fn test_ipv6_does_not_probe_stun_in_websocket_mode() {
    OVERWRITE_SETTINGS
        .write()
        .unwrap()
        .insert(keys::OPTION_ALLOW_WEBSOCKET.to_owned(), "Y".to_owned());
    let res = hbb_common::timeout(1_000, librustdesk::common::test_ipv6()).await;
    assert!(matches!(res, Ok(None)));
}
