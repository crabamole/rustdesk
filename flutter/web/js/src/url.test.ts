import { describe, it, expect, beforeEach, vi } from "vitest";
import { setConfig, getDefaultUri, getHost, getRelayHost, getConfigKey, loadConfig, resolveUri, getRelayUri } from "./url";

describe("resolveUri", () => {
  it("resolves path to wss:// on HTTPS page", () => {
    Object.defineProperty(globalThis, "location", {
      value: { protocol: "https:", host: "rustdesk.corp.com" },
      writable: true,
    });
    expect(resolveUri("/ws/id")).toBe("wss://rustdesk.corp.com/ws/id");
    expect(resolveUri("/ws/relay")).toBe("wss://rustdesk.corp.com/ws/relay");
  });

  it("resolves path to ws:// on HTTP page", () => {
    (globalThis as any).location = { protocol: "http:", host: "localhost:8080" };
    expect(resolveUri("/ws/id")).toBe("ws://localhost:8080/ws/id");
  });

  it("returns full URI as-is", () => {
    expect(resolveUri("wss://example.com/ws/id")).toBe("wss://example.com/ws/id");
    expect(resolveUri("ws://127.0.0.1:21118")).toBe("ws://127.0.0.1:21118");
  });

  it("returns host:port as-is", () => {
    expect(resolveUri("myserver.com:21118")).toBe("myserver.com:21118");
  });
});

describe("getDefaultUri", () => {
  beforeEach(() => {
    setConfig("/ws/id", "/ws/relay", "");
    (globalThis as any).location = { protocol: "https:", host: "rustdesk.corp.com" };
  });

  it("defaults resolve to same-origin wss paths", () => {
    expect(getDefaultUri()).toBe("wss://rustdesk.corp.com/ws/id");
    expect(getDefaultUri(true)).toBe("wss://rustdesk.corp.com/ws/relay");
  });

  it("returns full wss:// host URL without modification", () => {
    setConfig("wss://rustdesk.example.com/ws/id", "wss://rustdesk.example.com/ws/relay", "");
    expect(getDefaultUri()).toBe("wss://rustdesk.example.com/ws/id");
  });

  it("returns full wss:// relay URL without modification", () => {
    setConfig("wss://rustdesk.example.com/ws/id", "wss://rustdesk.example.com/ws/relay", "");
    expect(getDefaultUri(true)).toBe("wss://rustdesk.example.com/ws/relay");
  });

  it("returns full ws:// URL without modification", () => {
    setConfig("ws://127.0.0.1:12022/ws/id", "ws://127.0.0.1:12022/ws/relay", "");
    expect(getDefaultUri()).toBe("ws://127.0.0.1:12022/ws/id");
    expect(getDefaultUri(true)).toBe("ws://127.0.0.1:12022/ws/relay");
  });

  it("falls back to HOST when RELAY_HOST is empty", () => {
    setConfig("/ws/id", "", "");
    expect(getDefaultUri(true)).toBe("wss://rustdesk.corp.com/ws/id");
  });

  it("returns relay when relay is set", () => {
    setConfig("host.example.com:21116", "relay.example.com:21117", "");
    expect(getDefaultUri(true)).toBe("relay.example.com:21117");
  });
});

describe("getRelayUri", () => {
  beforeEach(() => {
    setConfig("/ws/id", "/ws/relay", "");
    (globalThis as any).location = { protocol: "https:", host: "rustdesk.corp.com" };
  });

  it("dials a wss:// relay server from hbbs as is", () => {
    expect(getRelayUri("wss://rustdesk.corp.com/ws/relay/1")).toBe("wss://rustdesk.corp.com/ws/relay/1");
  });

  it("dials a ws:// relay server from hbbs as is", () => {
    expect(getRelayUri("ws://10.0.0.5:21119/ws/relay/0")).toBe("ws://10.0.0.5:21119/ws/relay/0");
  });

  it("uses the configured relay for anything else", () => {
    expect(getRelayUri("relay.example.com:21117")).toBe("wss://rustdesk.corp.com/ws/relay");
    expect(getRelayUri("")).toBe("wss://rustdesk.corp.com/ws/relay");
    expect(getRelayUri(undefined)).toBe("wss://rustdesk.corp.com/ws/relay");
  });
});

describe("setConfig / getters", () => {
  it("stores and retrieves host, relay, and key", () => {
    setConfig("myhost", "myrelay", "mykey123");
    expect(getHost()).toBe("myhost");
    expect(getRelayHost()).toBe("myrelay");
    expect(getConfigKey()).toBe("mykey123");
  });
});

describe("loadConfig", () => {
  beforeEach(() => {
    setConfig("", "", "");
  });

  it("loads config from fetch response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        host: "wss://test.example.com/ws/id",
        relay: "wss://test.example.com/ws/relay",
        key: "testkey123",
      }),
    });
    await loadConfig();
    expect(getHost()).toBe("wss://test.example.com/ws/id");
    expect(getRelayHost()).toBe("wss://test.example.com/ws/relay");
    expect(getConfigKey()).toBe("testkey123");
  });

  it("keeps defaults when fetch fails", async () => {
    setConfig("default-host", "", "");
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));
    await loadConfig();
    expect(getHost()).toBe("default-host");
  });

  it("keeps defaults when response is not ok", async () => {
    setConfig("default-host", "", "");
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
    await loadConfig();
    expect(getHost()).toBe("default-host");
  });

  it("handles partial config (only host)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ host: "partial-host" }),
    });
    await loadConfig();
    expect(getHost()).toBe("partial-host");
    expect(getRelayHost()).toBe("");
    expect(getConfigKey()).toBe("");
  });

  it("loads path-based config", async () => {
    (globalThis as any).location = { protocol: "https:", host: "myapp.com" };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ host: "/ws/id", relay: "/ws/relay", key: "k1" }),
    });
    await loadConfig();
    expect(getDefaultUri()).toBe("wss://myapp.com/ws/id");
    expect(getDefaultUri(true)).toBe("wss://myapp.com/ws/relay");
  });
});
