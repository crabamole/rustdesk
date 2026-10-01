// ScreenCaptureKit-based screen capturer for macOS 12.3+
// Fallback for when CGDisplayStream is unavailable (macOS 15+ virtual displays)

#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>

typedef void (*SCFrameCallback)(void *ctx, IOSurfaceRef surface, uint32_t
                                width, uint32_t height, uint64_t
                                display_time);

// Stream output delegate that delivers frames via C callback
@interface SCCapturerDelegate : NSObject <SCStreamOutput, SCStreamDelegate>
@property (assign) SCFrameCallback callback;
@property (assign) void *callbackCtx;
@property (assign) BOOL stopped;
@end

@implementation SCCapturerDelegate

- (void)stream:(SCStream *)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
               ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeScreen) return;
    if (!self.callback) return;

    CVPixelBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (!pixelBuffer) return;

    IOSurfaceRef surface = CVPixelBufferGetIOSurface(pixelBuffer);
    if (!surface) return;

    uint32_t w = (uint32_t)CVPixelBufferGetWidth(pixelBuffer);
    uint32_t h = (uint32_t)CVPixelBufferGetHeight(pixelBuffer);

    uint64_t pts = 0;
    CMTime t = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
    if (CMTIME_IS_VALID(t)) {
        pts = (uint64_t)(CMTimeGetSeconds(t) * 1e9);
    }

    self.callback(self.callbackCtx, surface, w, h, pts);
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    self.stopped = YES;
}

@end

// Opaque handle
typedef struct {
    SCStream *stream;
    SCCapturerDelegate *delegate;
    SCContentFilter *filter;
    SCStreamConfiguration *config;
} SCCapturer;

// Check if ScreenCaptureKit is available at runtime
int sc_capturer_available(void) {
    if (@available(macOS 12.3, *)) {
        return 1;
    }
    return 0;
}

// Create a ScreenCaptureKit capturer for a given display ID.
// Returns NULL on failure.
void *sc_capturer_create(uint32_t display_id, uint32_t width, uint32_t height,
                         SCFrameCallback callback, void *ctx) {
    if (@available(macOS 12.3, *)) {
        __block SCCapturer *capturer = NULL;
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);

        [SCShareableContent getShareableContentWithCompletionHandler:^(
                                SCShareableContent *content, NSError *error) {
            if (error || !content) {
                dispatch_semaphore_signal(sem);
                return;
            }

            SCDisplay *targetDisplay = nil;
            for (SCDisplay *d in content.displays) {
                if (d.displayID == display_id) {
                    targetDisplay = d;
                    break;
                }
            }

            if (!targetDisplay) {
                dispatch_semaphore_signal(sem);
                return;
            }

            SCContentFilter *filter = [[SCContentFilter alloc]
                initWithDisplay:targetDisplay
               excludingWindows:@[]];

            SCStreamConfiguration *config =
                [[SCStreamConfiguration alloc] init];
            config.width = width;
            config.height = height;
            config.pixelFormat = kCVPixelFormatType_32BGRA;
            config.minimumFrameInterval =
                CMTimeMake(1, 60); // 60 fps max
            config.showsCursor = NO;
            config.queueDepth = 3;

            SCCapturerDelegate *delegate =
                [[SCCapturerDelegate alloc] init];
            delegate.callback = callback;
            delegate.callbackCtx = ctx;

            NSError *streamError = nil;
            SCStream *stream =
                [[SCStream alloc] initWithFilter:filter
                                   configuration:config
                                        delegate:delegate];

            [stream addStreamOutput:delegate
                               type:SCStreamOutputTypeScreen
                 sampleHandlerQueue:nil
                              error:&streamError];
            if (streamError) {
                dispatch_semaphore_signal(sem);
                return;
            }

            capturer = (SCCapturer *)calloc(1, sizeof(SCCapturer));
            capturer->stream = stream;
            capturer->delegate = delegate;
            capturer->filter = filter;
            capturer->config = config;

            dispatch_semaphore_signal(sem);
        }];

        dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW,
                                                   5 * NSEC_PER_SEC));

        if (!capturer) return NULL;

        // Start capture
        dispatch_semaphore_t startSem = dispatch_semaphore_create(0);
        __block BOOL startOk = NO;

        [capturer->stream
            startCaptureWithCompletionHandler:^(NSError *error) {
                startOk = (error == nil);
                if (error) {
                    NSLog(@"SCStream startCapture error: %@", error);
                }
                dispatch_semaphore_signal(startSem);
            }];

        dispatch_semaphore_wait(startSem,
                               dispatch_time(DISPATCH_TIME_NOW,
                                             5 * NSEC_PER_SEC));

        if (!startOk) {
            free(capturer);
            return NULL;
        }

        return capturer;
    }
    return NULL;
}

// Stop and destroy the capturer
void sc_capturer_destroy(void *handle) {
    if (!handle) return;
    SCCapturer *capturer = (SCCapturer *)handle;

    if (@available(macOS 12.3, *)) {
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);
        [capturer->stream
            stopCaptureWithCompletionHandler:^(NSError *error) {
                dispatch_semaphore_signal(sem);
            }];
        dispatch_semaphore_wait(
            sem,
            dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
    }

    free(capturer);
}

// Check if the stream has stopped due to an error
int sc_capturer_is_stopped(void *handle) {
    if (!handle) return 1;
    SCCapturer *capturer = (SCCapturer *)handle;
    return capturer->delegate.stopped ? 1 : 0;
}
