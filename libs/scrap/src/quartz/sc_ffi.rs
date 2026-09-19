use super::ffi::IOSurfaceRef;
use hbb_common::libc::c_void;

pub type SCFrameCallback = extern "C" fn(
    ctx: *mut c_void,
    surface: IOSurfaceRef,
    width: u32,
    height: u32,
    display_time: u64,
);

extern "C" {
    pub fn sc_capturer_available() -> i32;
    pub fn sc_capturer_create(
        display_id: u32,
        width: u32,
        height: u32,
        callback: SCFrameCallback,
        ctx: *mut c_void,
    ) -> *mut c_void;
    pub fn sc_capturer_destroy(handle: *mut c_void);
    pub fn sc_capturer_is_stopped(handle: *mut c_void) -> i32;
}
