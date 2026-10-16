//! Same-user access (docs/design-same-user-access.md): the owner proof a device login carries, and
//! the checks before a viewer is admitted without a password.
use hbb_common::{config::Config, log, rendezvous_proto::ControlledContext, sodiumoxide::crypto::sign, tokio};

/// The bytes the device signs; the api-server (`device_owner::owner_login_message`) builds the same.
pub fn owner_login_message(code: &str, id: &str, uuid: &str) -> Vec<u8> {
    [b"owner-login".as_slice(), code.as_bytes(), id.as_bytes(), uuid.as_bytes()].join(&0u8)
}

/// Signs the owner proof of login `code` with this device's key. Runs in the server process,
/// which holds the key hbbs registered; the key itself never leaves it.
pub fn sign_owner_login(code: &str) -> Option<Vec<u8>> {
    if code.contains('\0') {
        return None;
    }
    let sk = sign::SecretKey::from_slice(&Config::get_key_pair().0)?;
    let msg = owner_login_message(code, &Config::get_id(), &crate::encode64(hbb_common::get_uuid()));
    Some(sign::sign_detached(&msg, &sk).to_bytes().to_vec())
}

/// Asks the server process for the owner proof of login `code`; `None` when it does not answer.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tokio::main(flavor = "current_thread")]
pub async fn owner_login_signature(code: &str) -> Option<Vec<u8>> {
    use crate::ipc::Data;
    let mut c = crate::ipc::connect(1000, "").await.ok()?;
    c.send(&Data::OwnerLoginSignature((code.to_owned(), None))).await.ok()?;
    match c.next_timeout(1000).await {
        Ok(Some(Data::OwnerLoginSignature((answered, signature)))) if answered == code => signature,
        _ => None,
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn owner_login_signature(_code: &str) -> Option<Vec<u8>> {
    None
}

/// Clears the same-user flag unless it came over a `wss://` rendezvous link whose certificate was
/// verified: without that, anyone on the path could forge it.
pub fn checked_context(ctx: Option<ControlledContext>, rendezvous_url: &str) -> Option<ControlledContext> {
    ctx.map(|mut c| {
        if c.same_user && !(rendezvous_url.starts_with("wss://") && hbb_common::tls::is_verified_tls(rendezvous_url)) {
            log::warn!("same-user flag ignored: rendezvous link {rendezvous_url} is not wss with a verified certificate");
            c.same_user = false;
            c.owner_pk = Default::default();
        }
        c
    })
}

/// Whether the viewer is admitted without a password: hbbs says it is the device's owner, and the
/// owner's login was signed with this device's key.
pub fn admits(ctx: Option<&ControlledContext>) -> bool {
    let Some(c) = ctx.filter(|c| c.same_user) else {
        return false;
    };
    let ok = owner_matches(c, &Config::get_key_pair().1);
    if !ok {
        log::warn!("same-user flag ignored: the owner's login was signed with another key");
    }
    ok
}

fn owner_matches(ctx: &ControlledContext, own_pk: &[u8]) -> bool {
    ctx.same_user && !own_pk.is_empty() && ctx.owner_pk[..] == *own_pk
}

#[cfg(test)]
mod tests {
    use super::*;
    use hbb_common::tls::{upsert_tls_cache, TlsType};

    fn ctx(same_user: bool, owner_pk: &[u8]) -> ControlledContext {
        ControlledContext { conn_audit_ref: "r".into(), same_user, owner_pk: owner_pk.to_vec().into(), ..Default::default() }
    }

    #[test]
    fn signature_matches_the_api_server_vector() {
        assert!(sign_owner_login("a\0b").is_none());
        let (pk, sk) = sign::keypair_from_seed(&sign::Seed([7u8; 32]));
        let msg = owner_login_message("code1", "123456789", "dXVpZA==");
        assert_eq!(msg, b"owner-login\0code1\0123456789\0dXVpZA==".to_vec());
        assert_eq!(crate::encode64(pk.0), "6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw=");
        assert_eq!(
            crate::encode64(sign::sign_detached(&msg, &sk).to_bytes()),
            "CHBQueEnh5risrgJk9BCNDWL4oY4avo0EvOsri+0BfgkiMu+jojKu7M6fL+fwmb9AYJayOiGO/dh3LezDdeXAg=="
        );
    }

    #[test]
    fn flag_kept_only_on_a_verified_wss_link() {
        upsert_tls_cache("wss://su-verified.test/ws/id", TlsType::Rustls, false);
        upsert_tls_cache("wss://su-fallback.test/ws/id", TlsType::Rustls, true);
        let kept = |url: &str| checked_context(Some(ctx(true, &[1])), url).unwrap().same_user;
        assert!(kept("wss://su-verified.test/ws/id"));
        assert!(!kept("wss://su-fallback.test/ws/id"));
        assert!(!kept("ws://su-verified.test/ws/id"));
        assert!(!kept("su-verified.test:21116"));
        let dropped = checked_context(Some(ctx(true, &[1])), "ws://x/ws/id").unwrap();
        assert!(dropped.owner_pk.is_empty());
        assert_eq!(dropped.conn_audit_ref, "r", "the audit ref stays");
    }

    #[test]
    fn owner_key_must_be_this_device() {
        assert!(owner_matches(&ctx(true, &[1, 2]), &[1, 2]));
        assert!(!owner_matches(&ctx(true, &[3, 4]), &[1, 2]));
        assert!(!owner_matches(&ctx(false, &[1, 2]), &[1, 2]));
        assert!(!owner_matches(&ctx(true, &[]), &[]));
    }
}
