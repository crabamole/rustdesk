// Video decoding with the browser's WebCodecs: VP9, H264 and H265, in hardware where the browser can.
import * as message from "./message";

export type Codec = "vp9" | "h264" | "h265";

// Profile/level only matter for the support check; the decoder reads the stream's own headers.
const CODEC_STRING: Record<Codec, string> = {
  vp9: "vp09.00.41.08",
  h264: "avc1.640033",
  h265: "hvc1.1.6.L153.B0",
};

let supported: Promise<Set<Codec>> | undefined;

/** The codecs this browser decodes with WebCodecs. */
export function webCodecs(): Promise<Set<Codec>> {
  supported ??= (async () => {
    const set = new Set<Codec>();
    if (typeof VideoDecoder === "undefined") return set;
    for (const c of Object.keys(CODEC_STRING) as Codec[]) {
      try {
        if ((await VideoDecoder.isConfigSupported({ codec: CODEC_STRING[c] })).supported) set.add(c);
      } catch (e) {
        console.warn("video: WebCodecs check failed for " + c, e);
      }
    }
    console.info("video: WebCodecs decodes " + ([...set].join(", ") || "nothing"));
    return set;
  })();
  return supported;
}

export function codecOf(vf: message.VideoFrame): [Codec, message.EncodedVideoFrames] | undefined {
  if (vf.vp9s) return ["vp9", vf.vp9s];
  if (vf.h264s) return ["h264", vf.h264s];
  if (vf.h265s) return ["h265", vf.h265s];
  return undefined;
}

export class WebCodecsDecoder {
  readonly codec: Codec;
  askedKey = false;
  private dec: VideoDecoder;
  private needKey = true;

  /** onFrame owns the VideoFrame and must close it; its timestamp is when decode() got it (performance.now()). */
  constructor(codec: Codec, onFrame: (f: VideoFrame) => void, onError: (e: DOMException) => void) {
    this.codec = codec;
    this.dec = new VideoDecoder({ output: onFrame, error: onError });
    this.dec.configure({ codec: CODEC_STRING[codec], optimizeForLatency: true });
  }

  /** Queues the frames; returns false when a key frame is needed first (they were dropped). */
  decode(frames: message.EncodedVideoFrame[]): boolean {
    let queued = false;
    for (const f of frames) {
      if (this.needKey && !f.key) continue;
      this.needKey = false;
      this.dec.decode(new EncodedVideoChunk({ type: f.key ? "key" : "delta", timestamp: performance.now(), data: f.data }));
      queued = true;
    }
    return queued;
  }

  close() {
    if (this.dec.state != "closed") this.dec.close();
  }
}
