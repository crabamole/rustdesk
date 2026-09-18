import { vi } from "vitest";

(globalThis as any).YUVCanvas = {
  WebGLFrameSink: { isAvailable: () => false },
  attach: vi.fn(() => ({
    drawFrame: vi.fn(),
  })),
};
(globalThis as any).Worker = class MockWorker {
  postMessage = vi.fn();
  onmessage: any = null;
  onerror: any = null;
  terminate = vi.fn();
  constructor() {}
};
