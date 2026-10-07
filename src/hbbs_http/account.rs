use super::HbbHttpResponse;
use crate::hbbs_http::create_http_client_with_url;
use hbb_common::{config::LocalConfig, log, ResultType};
use serde_derive::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
    time::{Duration, Instant},
};
use url::Url;

lazy_static::lazy_static! {
    static ref OIDC_SESSION: Arc<RwLock<OidcSession>> = Arc::new(RwLock::new(OidcSession::new()));
}

const QUERY_TIMEOUT_SECS: u64 = 60 * 3;

const REQUESTING_ACCOUNT_AUTH: &str = "Requesting account auth";
const WAITING_ACCOUNT_AUTH: &str = "Waiting account auth";
const LOGIN_ACCOUNT_AUTH: &str = "Login account auth";

#[derive(Deserialize, Clone, Debug)]
pub struct OidcAuthUrl {
    code: String,
    url: Url,
}

#[derive(Debug, Deserialize, Serialize, Default, Clone)]
pub struct DeviceInfo {
    /// Linux , Windows , Android ...
    #[serde(default)]
    pub os: String,

    /// `browser` or `client`
    #[serde(default)]
    pub r#type: String,

    /// device name from rustdesk client,
    /// browser info(name + version) from browser
    #[serde(default)]
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WhitelistItem {
    data: String, // ip / device uuid
    info: DeviceInfo,
    exp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserInfo {
    #[serde(default, flatten)]
    pub settings: UserSettings,
    #[serde(default)]
    pub login_device_whitelist: Vec<WhitelistItem>,
    #[serde(default)]
    pub other: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UserSettings {
    #[serde(default)]
    pub email_verification: bool,
    #[serde(default)]
    pub email_alarm_notification: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize_repr, Deserialize_repr)]
#[repr(i64)]
pub enum UserStatus {
    Disabled = 0,
    Normal = 1,
    Unverified = -1,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPayload {
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub status: UserStatus,
    pub info: UserInfo,
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default)]
    pub third_auth_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthBody {
    pub access_token: String,
    pub r#type: String,
    #[serde(default)]
    pub tfa_type: String,
    #[serde(default)]
    pub secret: String,
    pub user: UserPayload,
}

pub struct OidcSession {
    warmed_api_server: Option<String>,
    state_msg: &'static str,
    failed_msg: String,
    code_url: Option<OidcAuthUrl>,
    auth_body: Option<AuthBody>,
    auth_attempt: u64,
    running: bool,
    query_timeout: Duration,
}

#[derive(Serialize)]
pub struct AuthResult {
    pub state_msg: String,
    pub failed_msg: String,
    pub url: Option<String>,
    pub auth_body: Option<AuthBody>,
}

impl Default for UserStatus {
    fn default() -> Self {
        UserStatus::Normal
    }
}

impl OidcSession {
    fn new() -> Self {
        Self {
            warmed_api_server: None,
            state_msg: REQUESTING_ACCOUNT_AUTH,
            failed_msg: "".to_owned(),
            code_url: None,
            auth_body: None,
            auth_attempt: 0,
            running: false,
            query_timeout: Duration::from_secs(QUERY_TIMEOUT_SECS),
        }
    }

    fn ensure_client(api_server: &str) {
        let mut write_guard = OIDC_SESSION.write().unwrap();
        if write_guard.warmed_api_server.as_deref() == Some(api_server) {
            return;
        }
        // This URL is used to detect the appropriate TLS implementation for the server.
        let login_option_url = format!("{}/api/login-options", api_server);
        let _ = create_http_client_with_url(&login_option_url);
        write_guard.warmed_api_server = Some(api_server.to_owned());
    }

    fn auth(
        api_server: &str,
        op: &str,
        id: &str,
        uuid: &str,
        return_to: &str,
        code_challenge: &str,
    ) -> ResultType<HbbHttpResponse<OidcAuthUrl>> {
        Self::ensure_client(api_server);
        let body = serde_json::json!({
            "op": op,
            "id": id,
            "uuid": uuid,
            "deviceInfo": crate::ui_interface::get_login_device_info(),
            "apiDomain": api_server,
            "returnTo": return_to,
            "codeChallenge": code_challenge,
        })
        .to_string();
        let resp = crate::post_request_sync(format!("{}/api/oidc/auth", api_server), body, "")?;
        HbbHttpResponse::parse(&resp)
    }

    /// Exchanges the one-time result for the session token.
    fn redeem(
        api_server: &str,
        result: &str,
        code_verifier: &str,
        id: &str,
        uuid: &str,
    ) -> ResultType<HbbHttpResponse<AuthBody>> {
        let body = serde_json::json!({
            "result": result,
            "codeVerifier": code_verifier,
            "id": id,
            "uuid": uuid,
        })
        .to_string();
        let resp = crate::post_request_sync(format!("{}/api/oidc/token", api_server), body, "")?;
        HbbHttpResponse::parse(&resp)
    }

    /// Waits for the browser's redirect to the loopback listener.
    fn wait_loopback(
        listener: &std::net::TcpListener,
        auth_attempt: u64,
        login_code: &str,
        timeout: Duration,
    ) -> Result<String, String> {
        use std::io::{Read, Write};
        let begin = Instant::now();
        while Self::auth_attempt_is_current(auth_attempt) && begin.elapsed() < timeout {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    // Any local process can call the loopback; only this login's redirect counts.
                    let reply = parse_loopback_request(&String::from_utf8_lossy(&buf[..n]))
                        .filter(|(_, code)| code == login_code);
                    let (status, text) = match &reply {
                        Some((Ok(_), _)) => ("200 OK", "Login received. Return to RustDesk."),
                        Some((Err(_), _)) => {
                            ("200 OK", "Login failed. Return to RustDesk and try again.")
                        }
                        None => ("404 Not Found", "Not found"),
                    };
                    let _ = stream.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!DOCTYPE html><html><body><p>{text}</p></body></html>").as_bytes());
                    if let Some((reply, _)) = reply {
                        return reply;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Self::sleep(0.2),
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("timeout".to_owned())
    }

    fn reset(&mut self) {
        self.state_msg = REQUESTING_ACCOUNT_AUTH;
        self.failed_msg = "".to_owned();
        self.running = false;
        self.code_url = None;
        self.auth_body = None;
    }

    fn before_task(&mut self) {
        self.reset();
        self.running = true;
    }

    fn after_task(&mut self) {
        self.running = false;
    }

    fn start_auth_attempt(&mut self) -> u64 {
        self.auth_attempt = self.auth_attempt.wrapping_add(1);
        self.auth_attempt
    }

    fn cancel_auth_attempt(&mut self) {
        self.auth_attempt = self.auth_attempt.wrapping_add(1);
    }

    fn is_current_auth_attempt(&self, auth_attempt: u64) -> bool {
        self.auth_attempt == auth_attempt
    }

    fn auth_attempt_is_current(auth_attempt: u64) -> bool {
        OIDC_SESSION
            .read()
            .unwrap()
            .is_current_auth_attempt(auth_attempt)
    }

    fn set_state_if_current(auth_attempt: u64, state_msg: &'static str, failed_msg: String) {
        let mut session = OIDC_SESSION.write().unwrap();
        if session.is_current_auth_attempt(auth_attempt) {
            session.set_state(state_msg, failed_msg);
        }
    }

    fn sleep(secs: f32) {
        std::thread::sleep(std::time::Duration::from_secs_f32(secs));
    }

    fn auth_task(
        api_server: String,
        op: String,
        id: String,
        uuid: String,
        remember_me: bool,
        auth_attempt: u64,
    ) {
        let listener = match std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.set_nonblocking(true).map(|_| l))
        {
            Ok(l) => l,
            Err(err) => {
                Self::set_state_if_current(auth_attempt, REQUESTING_ACCOUNT_AUTH, err.to_string());
                return;
            }
        };
        let return_to = match listener.local_addr() {
            Ok(addr) => format!("http://127.0.0.1:{}/", addr.port()),
            Err(err) => {
                Self::set_state_if_current(auth_attempt, REQUESTING_ACCOUNT_AUTH, err.to_string());
                return;
            }
        };
        let (code_verifier, code_challenge) = pkce_pair();
        let auth_request_res =
            Self::auth(&api_server, &op, &id, &uuid, &return_to, &code_challenge);
        log::info!("Request oidc auth result: {:?}", &auth_request_res);
        if !Self::auth_attempt_is_current(auth_attempt) {
            return;
        }
        let code_url = match auth_request_res {
            Ok(HbbHttpResponse::<_>::Data(code_url)) => code_url,
            Ok(HbbHttpResponse::<_>::Error(err)) => {
                Self::set_state_if_current(auth_attempt, REQUESTING_ACCOUNT_AUTH, err);
                return;
            }
            Ok(_) => {
                Self::set_state_if_current(
                    auth_attempt,
                    REQUESTING_ACCOUNT_AUTH,
                    "Invalid auth response".to_owned(),
                );
                return;
            }
            Err(err) => {
                Self::set_state_if_current(auth_attempt, REQUESTING_ACCOUNT_AUTH, err.to_string());
                return;
            }
        };

        let login_code = code_url.code.clone();
        {
            let mut session = OIDC_SESSION.write().unwrap();
            if !session.is_current_auth_attempt(auth_attempt) {
                return;
            }
            session.set_state(WAITING_ACCOUNT_AUTH, "".to_owned());
            session.code_url = Some(code_url);
        }

        let query_timeout = OIDC_SESSION.read().unwrap().query_timeout;
        let result = match Self::wait_loopback(&listener, auth_attempt, &login_code, query_timeout)
        {
            Ok(result) => result,
            Err(err) => {
                Self::set_state_if_current(auth_attempt, WAITING_ACCOUNT_AUTH, err);
                return;
            }
        };
        match Self::redeem(&api_server, &result, &code_verifier, &id, &uuid) {
            Ok(HbbHttpResponse::<_>::Data(auth_body)) => {
                let mut session = OIDC_SESSION.write().unwrap();
                if !session.is_current_auth_attempt(auth_attempt) {
                    return;
                }
                if auth_body.r#type == "access_token" {
                    if remember_me {
                        LocalConfig::set_option(
                            "access_token".to_owned(),
                            auth_body.access_token.clone(),
                        );
                        LocalConfig::set_option(
                            "user_info".to_owned(),
                            serde_json::json!({
                                "name": auth_body.user.name,
                                "display_name": auth_body.user.display_name,
                                "avatar": auth_body.user.avatar,
                                "status": auth_body.user.status
                            })
                            .to_string(),
                        );
                    }
                }
                session.set_state(LOGIN_ACCOUNT_AUTH, "".to_owned());
                session.auth_body = Some(auth_body);
            }
            Ok(HbbHttpResponse::<_>::Error(err)) => {
                Self::set_state_if_current(auth_attempt, WAITING_ACCOUNT_AUTH, err)
            }
            Ok(_) => Self::set_state_if_current(
                auth_attempt,
                WAITING_ACCOUNT_AUTH,
                "Invalid auth response".to_owned(),
            ),
            Err(err) => {
                Self::set_state_if_current(auth_attempt, WAITING_ACCOUNT_AUTH, err.to_string())
            }
        }
    }

    fn set_state(&mut self, state_msg: &'static str, failed_msg: String) {
        self.state_msg = state_msg;
        self.failed_msg = failed_msg;
    }

    fn wait_stop_querying() {
        let wait_secs = 0.3;
        while OIDC_SESSION.read().unwrap().running {
            Self::sleep(wait_secs);
        }
    }

    pub fn account_auth(
        api_server: String,
        op: String,
        id: String,
        uuid: String,
        remember_me: bool,
    ) {
        let auth_attempt = OIDC_SESSION.write().unwrap().start_auth_attempt();
        Self::wait_stop_querying();
        {
            let mut session = OIDC_SESSION.write().unwrap();
            if !session.is_current_auth_attempt(auth_attempt) {
                return;
            }
            session.before_task();
        }
        std::thread::spawn(move || {
            Self::auth_task(api_server, op, id, uuid, remember_me, auth_attempt);
            OIDC_SESSION.write().unwrap().after_task();
        });
    }

    fn get_result_(&self) -> AuthResult {
        AuthResult {
            state_msg: self.state_msg.to_string(),
            failed_msg: self.failed_msg.clone(),
            url: self.code_url.as_ref().map(|x| x.url.to_string()),
            auth_body: self.auth_body.clone(),
        }
    }

    pub fn auth_cancel() {
        OIDC_SESSION.write().unwrap().cancel_auth_attempt();
    }

    pub fn get_result() -> AuthResult {
        OIDC_SESSION.read().unwrap().get_result_()
    }
}

/// PKCE verifier and its S256 challenge (RFC 7636).
fn pkce_pair() -> (String, String) {
    use hbb_common::{
        base64::prelude::{Engine as _, BASE64_URL_SAFE_NO_PAD},
        rand::{distributions::Alphanumeric, Rng},
        sha2::{Digest, Sha256},
    };
    let verifier: String = hbb_common::rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();
    let challenge = BASE64_URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// The browser's request to the loopback: `Ok(result)` or `Err(error)` with the login code, or `None` for other requests (e.g. favicon).
fn parse_loopback_request(request: &str) -> Option<(Result<String, String>, String)> {
    let target = request.lines().next()?.split_whitespace().nth(1)?;
    let url = Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    let param = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
    };
    let code = param("code")?;
    let reply = match param("result") {
        Some(result) => Ok(result),
        None => Err(param("error")?),
    };
    Some((reply, code))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_request_carries_the_result_or_the_error() {
        assert_eq!(
            parse_loopback_request("GET /?result=abc&code=x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
            Some((Ok("abc".to_owned()), "x".to_owned()))
        );
        assert_eq!(
            parse_loopback_request("GET /?error=login_failed&code=x HTTP/1.1\r\n\r\n"),
            Some((Err("login_failed".to_owned()), "x".to_owned()))
        );
        assert_eq!(
            parse_loopback_request("GET /?result=abc HTTP/1.1\r\n\r\n"),
            None
        );
        assert_eq!(
            parse_loopback_request("GET /?code=x HTTP/1.1\r\n\r\n"),
            None
        );
        assert_eq!(
            parse_loopback_request("GET /favicon.ico HTTP/1.1\r\n\r\n"),
            None
        );
        assert_eq!(parse_loopback_request(""), None);
    }

    #[test]
    fn pkce_pair_is_s256() {
        use hbb_common::{
            base64::prelude::{Engine as _, BASE64_URL_SAFE_NO_PAD},
            sha2::{Digest, Sha256},
        };
        let (v, c) = pkce_pair();
        assert_eq!(v.len(), 64);
        assert_eq!(
            c,
            BASE64_URL_SAFE_NO_PAD.encode(Sha256::digest(v.as_bytes()))
        );
    }
}
