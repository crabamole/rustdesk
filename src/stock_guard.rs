#[cfg(any(target_os = "macos", target_os = "linux", test))]
use std::path::Path;

/// True when any of `paths` exists.
#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn any_exists<P: AsRef<Path>>(paths: &[P]) -> bool {
    paths.iter().any(|p| p.as_ref().exists())
}

/// Stock RustDesk installed next to a renamed build: both would share links, clipboard and machine ID.
pub fn stock_rustdesk_present() -> bool {
    if !crate::common::is_custom_client() {
        return false;
    }
    stock_installed()
}

#[cfg(target_os = "macos")]
fn stock_installed() -> bool {
    any_exists(&[
        "/Applications/RustDesk.app",
        "/Library/LaunchDaemons/com.carriez.RustDesk_service.plist",
        "/Library/LaunchAgents/com.carriez.RustDesk_server.plist",
    ])
}

#[cfg(target_os = "linux")]
fn stock_installed() -> bool {
    any_exists(&["/usr/share/rustdesk/rustdesk", "/usr/lib/systemd/system/rustdesk.service"])
}

#[cfg(windows)]
fn stock_installed() -> bool {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SYSTEM\\CurrentControlSet\\Services\\RustDesk")
        .is_ok()
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn stock_installed() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn any_exists_detects_one_present_path() {
        let dir = std::env::temp_dir().join(format!("stock-guard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let present = dir.join("RustDesk.app");
        std::fs::create_dir_all(&present).unwrap();
        assert!(any_exists(&[dir.join("missing"), present.clone()]));
        assert!(!any_exists(&[dir.join("missing")]));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
