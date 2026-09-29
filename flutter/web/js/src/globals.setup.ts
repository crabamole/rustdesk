import { vi } from "vitest";

(globalThis as any).YUVCanvas = {
  WebGLFrameSink: { isAvailable: () => false },
  attach: vi.fn(() => ({
    drawFrame: vi.fn(),
  })),
};
// Workers created by the module under test, so tests can drive their messages.
(globalThis as any).__workers = [] as any[];
(globalThis as any).Worker = class MockWorker {
  postMessage = vi.fn();
  onmessage: any = null;
  onerror: any = null;
  terminate = vi.fn();
  constructor(public url?: string) {
    (globalThis as any).__workers.push(this);
  }
};
