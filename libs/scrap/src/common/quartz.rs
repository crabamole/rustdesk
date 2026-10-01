use crate::{quartz, Frame, Pixfmt};
use std::marker::PhantomData;
use std::sync::{Arc, Mutex, TryLockError};
use std::{io, mem};

use hbb_common::libc::c_void;

enum CapturerBackend {
    DisplayStream(quartz::Capturer),
    #[cfg(feature = "screencapturekit")]
    ScreenCaptureKit {
        handle: *mut c_void,
        ctx_ptr: *const Mutex<Option<quartz::Frame>>,
    },
}

unsafe impl Send for CapturerBackend {}

pub struct Capturer {
    _backend: CapturerBackend,
    frame: Arc<Mutex<Option<quartz::Frame>>>,
    saved_raw_data: Vec<u8>,
    width: usize,
    height: usize,
}

#[cfg(feature = "screencapturekit")]
extern "C" fn sc_frame_callback(
    ctx: *mut c_void,
    surface: crate::quartz::ffi::IOSurfaceRef,
    _width: u32,
    _height: u32,
    _display_time: u64,
) {
    let frame_arc =
        unsafe { &*(ctx as *const Mutex<Option<quartz::Frame>>) };
    let frame = unsafe { quartz::Frame::new(surface) };
    if let Ok(mut f) = frame_arc.lock() {
        *f = Some(frame);
    }
}

impl Capturer {
    pub fn new(display: Display) -> io::Result<Capturer> {
        let frame = Arc::new(Mutex::new(None));

        #[cfg(feature = "screencapturekit")]
        {
            // ScreenCaptureKit is the primary capture backend on macOS 12.3+
            if unsafe { quartz::sc_ffi::sc_capturer_available() } != 0 {
                let w = display.width();
                let h = display.height();
                let ctx = Arc::into_raw(frame.clone()) as *mut c_void;
                let handle = unsafe {
                    quartz::sc_ffi::sc_capturer_create(
                        display.0.id(),
                        w as u32,
                        h as u32,
                        sc_frame_callback,
                        ctx,
                    )
                };

                if !handle.is_null() {
                    hbb_common::log::info!("ScreenCaptureKit capturer created for display {}", display.0.id());
                    return Ok(Capturer {
                        _backend: CapturerBackend::ScreenCaptureKit { handle, ctx_ptr: ctx as *const _ },
                        frame,
                        saved_raw_data: Vec::new(),
                        width: w,
                        height: h,
                    });
                }

                // Recover the Arc to avoid leak
                unsafe { Arc::from_raw(ctx as *const Mutex<Option<quartz::Frame>>) };
                hbb_common::log::warn!(
                    "ScreenCaptureKit failed for display {}, falling back to CGDisplayStream",
                    display.0.id()
                );
            }
        }

        // CGDisplayStream fallback (or primary when screencapturekit feature is not enabled)
        let f = frame.clone();
        let inner = quartz::Capturer::new(
            display.0,
            display.width(),
            display.height(),
            quartz::PixelFormat::Argb8888,
            Default::default(),
            move |inner| {
                if let Ok(mut f) = f.lock() {
                    *f = Some(inner);
                }
            },
        )
        .map_err(|_| io::Error::new(io::ErrorKind::Other, "CGDisplayStream creation failed"))?;

        let w = inner.width();
        let h = inner.height();
        Ok(Capturer {
            _backend: CapturerBackend::DisplayStream(inner),
            frame,
            saved_raw_data: Vec::new(),
            width: w,
            height: h,
        })
    }

    pub fn width(&self) -> usize {
        self.width
    }

    pub fn height(&self) -> usize {
        self.height
    }
}

impl crate::TraitCapturer for Capturer {
    fn frame<'a>(&'a mut self, _timeout_ms: std::time::Duration) -> io::Result<Frame<'a>> {
        match self.frame.try_lock() {
            Ok(mut handle) => {
                let mut frame = None;
                mem::swap(&mut frame, &mut handle);

                match frame {
                    Some(mut frame) => {
                        crate::would_block_if_equal(&mut self.saved_raw_data, frame.inner())?;
                        frame.surface_to_bgra(self.height);
                        Ok(Frame::PixelBuffer(PixelBuffer {
                            frame,
                            data: PhantomData,
                            width: self.width,
                            height: self.height,
                        }))
                    }

                    None => Err(io::ErrorKind::WouldBlock.into()),
                }
            }

            Err(TryLockError::WouldBlock) => Err(io::ErrorKind::WouldBlock.into()),

            Err(TryLockError::Poisoned(..)) => Err(io::ErrorKind::Other.into()),
        }
    }
}

impl Drop for Capturer {
    fn drop(&mut self) {
        #[cfg(feature = "screencapturekit")]
        if let CapturerBackend::ScreenCaptureKit { handle, ctx_ptr } = &self._backend {
            unsafe {
                quartz::sc_ffi::sc_capturer_destroy(*handle);
                Arc::from_raw(*ctx_ptr);
            }
        }
    }
}

pub struct PixelBuffer<'a> {
    frame: quartz::Frame,
    data: PhantomData<&'a [u8]>,
    width: usize,
    height: usize,
}

impl<'a> crate::TraitPixelBuffer for PixelBuffer<'a> {
    fn data(&self) -> &[u8] {
        &*self.frame
    }

    fn width(&self) -> usize {
        self.width
    }

    fn height(&self) -> usize {
        self.height
    }

    fn stride(&self) -> Vec<usize> {
        let mut v = Vec::new();
        v.push(self.frame.stride());
        v
    }

    fn pixfmt(&self) -> Pixfmt {
        Pixfmt::BGRA
    }
}

pub struct Display(quartz::Display);

impl Display {
    pub fn primary() -> io::Result<Display> {
        Ok(Display(quartz::Display::primary()))
    }

    pub fn all() -> io::Result<Vec<Display>> {
        Ok(quartz::Display::online()
            .map_err(|_| io::Error::from(io::ErrorKind::Other))?
            .into_iter()
            .map(Display)
            .collect())
    }

    pub fn width(&self) -> usize {
        self.0.width()
    }

    pub fn height(&self) -> usize {
        self.0.height()
    }

    pub fn scale(&self) -> f64 {
        self.0.scale()
    }

    pub fn name(&self) -> String {
        self.0.id().to_string()
    }

    pub fn is_online(&self) -> bool {
        self.0.is_online()
    }

    pub fn origin(&self) -> (i32, i32) {
        let o = self.0.bounds().origin;
        (o.x as _, o.y as _)
    }

    pub fn is_primary(&self) -> bool {
        self.0.is_primary()
    }
}
