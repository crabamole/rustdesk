#[cfg(target_os = "linux")]
pub mod linux;

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(not(debug_assertions))]
use hbb_common::{config::Config, log};
#[cfg(not(debug_assertions))]
use std::process::exit;

#[cfg(not(debug_assertions))]
static mut GLOBAL_CALLBACK: Option<Box<dyn Fn()>> = None;

#[cfg(not(debug_assertions))]
extern "C" fn breakdown_signal_handler(sig: i32) {
    let mut stack = vec![];
    backtrace::trace(|frame| {
        backtrace::resolve_frame(frame, |symbol| {
            if let Some(name) = symbol.name() {
                stack.push(name.to_string());
            }
        });
        true // keep going to the next frame
    });
    let mut info = String::default();
    if stack.iter().any(|s| {
        s.contains(&"nouveau_pushbuf_kick")
            || s.to_lowercase().contains("nvidia")
            || s.contains("gdk_window_end_draw_frame")
            || s.contains("glGetString")
    }) {
        Config::set_option("allow-always-software-render".to_string(), "Y".to_string());
        info = "Always use software rendering will be set.".to_string();
        log::info!("{}", info);
    }
    if stack.iter().any(|s| {
        s.to_lowercase().contains("nvidia")
            || s.to_lowercase().contains("amf")
            || s.to_lowercase().contains("mfx")
            || s.contains("cuProfilerStop")
    }) {
        Config::set_option("enable-hwcodec".to_string(), "N".to_string());
        info = "Perhaps hwcodec causing the crash, disable it first".to_string();
        log::info!("{}", info);
    }
    log::error!(
        "Got signal {} and exit. stack:\n{}",
        sig,
        stack.join("\n").to_string()
    );
    if !info.is_empty() {
        #[cfg(target_os = "linux")]
        linux::system_message(
            "RustDesk",
            &format!("Got signal {} and exit.{}", sig, info),
            true,
        )
        .ok();
    }
    unsafe {
        #[allow(static_mut_refs)]
        if let Some(callback) = &GLOBAL_CALLBACK {
            callback()
        }
    }
    // End as the crash it is, not with exit(0): the macOS agent restarts --server only after an
    // unsuccessful exit (KeepAlive SuccessfulExit=false), and macOS then writes a crash report.
    unsafe {
        libc::signal(sig, libc::SIG_DFL);
        // The signal is blocked while its handler runs; raised as is, it would only be pending.
        #[cfg(unix)]
        {
            let mut set: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut set);
            libc::sigaddset(&mut set, sig);
            libc::pthread_sigmask(libc::SIG_UNBLOCK, &set, std::ptr::null_mut());
        }
        libc::raise(sig);
    }
    exit(1);
}

#[cfg(not(debug_assertions))]
pub fn register_breakdown_handler<T>(callback: T)
where
    T: Fn() + 'static,
{
    unsafe {
        GLOBAL_CALLBACK = Some(Box::new(callback));
        libc::signal(libc::SIGSEGV, breakdown_signal_handler as _);
    }
}
