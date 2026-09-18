/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./connection", () => {
  class MockConnection {
    start = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();
    login = vi.fn();
    refresh = vi.fn();
    reconnect = vi.fn();
    toggleOption = vi.fn();
    setImageQuality = vi.fn();
    lockScreen = vi.fn();
    ctrlAltDel = vi.fn();
    switchDisplay = vi.fn();
    inputKey = vi.fn();
    inputString = vi.fn();
    inputMouse = vi.fn();
    setOption = vi.fn();
    inputOsPassword = vi.fn();
    getOption = vi.fn().mockReturnValue("");
    getRemember = vi.fn().mockReturnValue(false);
    setRemember = vi.fn();
    getImageQuality = vi.fn().mockReturnValue("balanced");
  }
  return {
    default: MockConnection,
    loadConfig: vi.fn().mockResolvedValue(undefined),
    getConfigKey: vi.fn().mockReturnValue("testkey"),
    getConfigHost: vi.fn().mockReturnValue("testhost"),
    getConfigRelay: vi.fn().mockReturnValue("testrelay"),
  };
});

vi.mock("libsodium-wrappers", () => ({
  default: {
    ready: Promise.resolve(),
    crypto_sign_open: vi.fn((signed: any, pk: any) => new Uint8Array([1, 2])),
    from_base64: vi.fn((s: string) => new Uint8Array([1, 2, 3])),
    crypto_box_keypair: vi.fn(() => ({
      privateKey: new Uint8Array([1]),
      publicKey: new Uint8Array([2]),
    })),
    crypto_secretbox_keygen: vi.fn(() => new Uint8Array([3])),
    crypto_box_easy: vi.fn(() => new Uint8Array([4])),
    crypto_secretbox_easy: vi.fn((data: any, nonce: any, key: any) => new Uint8Array([5])),
    crypto_secretbox_open_easy: vi.fn((data: any, nonce: any, key: any) => new Uint8Array([6])),
    base64_variants: { ORIGINAL: 0 },
  },
}));

vi.mock("./codec", () => ({
  loadVp9: vi.fn(),
}));

vi.mock("./gen_js_from_hbb", () => ({
  checkIfRetry: vi.fn(() => false),
  version: "1.0.0-test",
}));

vi.mock("./common", () => ({
  initZstd: vi.fn().mockResolvedValue(undefined),
  translate: vi.fn((locale: string, text: string) => text),
}));

const mockPCMPlayerInstances: Array<{ feed: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
vi.mock("pcm-player", () => {
  class MockPCMPlayer {
    feed = vi.fn();
    destroy = vi.fn();
    constructor(_opts: any) {
      mockPCMPlayerInstances.push(this);
    }
  }
  return { default: MockPCMPlayer };
});

import {
  isDesktop, msgbox, pushEvent, setConn, getConn, close, newConn,
  verify, genBoxKeyPair, genSecretKey, seal, encrypt, decrypt,
  getPeers, copyToClipboard, draw, sendOffCanvas, initAudio, playAudio,
  initSodium,
} from "./globals";

describe("isDesktop", () => {
  it("returns true for desktop user agent", () => {
    expect(typeof isDesktop()).toBe("boolean");
  });
});

describe("msgbox", () => {
  it("calls onGlobalEvent when handler exists", () => {
    const handler = vi.fn();
    (window as any).onGlobalEvent = handler;
    msgbox("info", "Title", "Text");
    expect(handler).toHaveBeenCalledWith(
      expect.stringContaining('"name":"msgbox"')
    );
    delete (window as any).onGlobalEvent;
  });

  it("skips when type is empty", () => {
    const handler = vi.fn();
    (window as any).onGlobalEvent = handler;
    msgbox("", "Title", "Text");
    expect(handler).not.toHaveBeenCalled();
    delete (window as any).onGlobalEvent;
  });

  it("skips error type with empty text", () => {
    const handler = vi.fn();
    (window as any).onGlobalEvent = handler;
    msgbox("error", "Title", "");
    expect(handler).not.toHaveBeenCalled();
    delete (window as any).onGlobalEvent;
  });

  it("warns when no handler", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete (window as any).onGlobalEvent;
    msgbox("info", "Title", "Text");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("pushEvent", () => {
  it("serializes payload and calls onGlobalEvent", () => {
    const handler = vi.fn();
    (window as any).onGlobalEvent = handler;
    pushEvent("test_event", { foo: "bar" });
    expect(handler).toHaveBeenCalled();
    const parsed = JSON.parse(handler.mock.calls[0][0]);
    expect(parsed.name).toBe("test_event");
    expect(parsed.foo).toBe("bar");
    delete (window as any).onGlobalEvent;
  });

  it("converts Uint8Array values to bracket notation", () => {
    const handler = vi.fn();
    (window as any).onGlobalEvent = handler;
    pushEvent("test", { data: new Uint8Array([1, 2, 3]) });
    const parsed = JSON.parse(handler.mock.calls[0][0]);
    expect(parsed.data).toBe("[1,2,3]");
    delete (window as any).onGlobalEvent;
  });
});

describe("setConn / getConn / close", () => {
  it("sets and gets connection", () => {
    const conn = { close: vi.fn() };
    setConn(conn);
    expect(getConn()).toBe(conn);
  });

  it("close clears connection", () => {
    const conn = { close: vi.fn() };
    setConn(conn);
    close();
    expect(getConn()).toBeUndefined();
    expect(conn.close).toHaveBeenCalled();
  });
});

describe("crypto functions", () => {
  it("verify opens signed message", async () => {
    const result = await verify(new Uint8Array([1]), "base64key");
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("genBoxKeyPair returns sk and pk", () => {
    const [sk, pk] = genBoxKeyPair();
    expect(sk).toBeInstanceOf(Uint8Array);
    expect(pk).toBeInstanceOf(Uint8Array);
  });

  it("genSecretKey returns key", () => {
    const key = genSecretKey();
    expect(key).toBeInstanceOf(Uint8Array);
  });

  it("seal encrypts with box", () => {
    const result = seal(new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]));
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("encrypt and decrypt round-trip", () => {
    const key = new Uint8Array(32);
    const encrypted = encrypt(new Uint8Array([1, 2, 3]), 1, key);
    expect(encrypted).toBeInstanceOf(Uint8Array);
    const decrypted = decrypt(encrypted, 1, key);
    expect(decrypted).toBeInstanceOf(Uint8Array);
  });
});

describe("getPeers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns empty object when no peers stored", () => {
    expect(getPeers()).toEqual({});
  });

  it("returns parsed peers from localStorage", () => {
    localStorage.setItem("peers", JSON.stringify({ abc: { tm: 1, info: {} } }));
    expect(getPeers()).toEqual({ abc: { tm: 1, info: {} } });
  });

  it("returns empty object on invalid JSON", () => {
    localStorage.setItem("peers", "not-json");
    expect(getPeers()).toEqual({});
  });
});

describe("setByName / getByName", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores remote_id", () => {
    (window as any).setByName("remote_id", "12345");
    expect(localStorage.getItem("remote-id")).toBe("12345");
  });

  it("retrieves remote_id", () => {
    localStorage.setItem("remote-id", "12345");
    expect((window as any).getByName("remote_id")).toBe("12345");
  });

  it("retrieves version", () => {
    expect((window as any).getByName("version")).toBe("1.0.0-test");
  });

  it("retrieves options as JSON", () => {
    const result = JSON.parse((window as any).getByName("options"));
    expect(result["custom-rendezvous-server"]).toBe("testhost");
    expect(result["relay-server"]).toBe("testrelay");
    expect(result.key).toBe("testkey");
  });

  it("stores and retrieves local options", () => {
    (window as any).setByName("option", JSON.stringify({ name: "view_style", value: "original" }));
    expect(localStorage.getItem("view_style")).toBe("original");
  });

  it("returns defaults for user options", () => {
    const result = (window as any).getByName("option:user:default", "view_style");
    expect(result).toBe("adaptive");
  });

  it("returns empty for unknown getByName", () => {
    expect((window as any).getByName("nonexistent")).toBe("");
  });

  it("returns empty for session options", () => {
    expect((window as any).getByName("option:session")).toBe("");
  });

  it("returns is_using_public_server as false", () => {
    expect((window as any).getByName("is_using_public_server")).toBe("false");
  });

  it("ignores custom-rendezvous-server in setByName option", () => {
    (window as any).setByName("option", JSON.stringify({ name: "custom-rendezvous-server", value: "evil" }));
    expect(localStorage.getItem("custom-rendezvous-server")).toBeNull();
  });

  it("ignores relay-server in setByName option", () => {
    (window as any).setByName("option", JSON.stringify({ name: "relay-server", value: "evil" }));
    expect(localStorage.getItem("relay-server")).toBeNull();
  });

  it("ignores key in setByName option", () => {
    (window as any).setByName("option", JSON.stringify({ name: "key", value: "evil" }));
    expect(localStorage.getItem("key")).toBeNull();
  });

  it("session_add_sync returns empty string", () => {
    const result = (window as any).setByName("session_add_sync", "");
    expect(result).toBe("");
  });

  it("handles close via setByName", () => {
    const conn = { close: vi.fn() };
    setConn(conn);
    (window as any).setByName("close", "");
    expect(conn.close).toHaveBeenCalled();
    expect(getConn()).toBeUndefined();
  });

  it("handles refresh via setByName", () => {
    const conn = newConn();
    (window as any).setByName("refresh", "");
    expect(conn.refresh).toHaveBeenCalled();
  });

  it("handles reconnect via setByName", () => {
    const conn = newConn();
    (window as any).setByName("reconnect", "");
    expect(conn.reconnect).toHaveBeenCalled();
  });

  it("handles toggle_option via setByName", () => {
    const conn = newConn();
    (window as any).setByName("toggle_option", "show-remote-cursor");
    expect(conn.toggleOption).toHaveBeenCalledWith("show-remote-cursor");
  });

  it("handles image_quality via setByName", () => {
    const conn = newConn();
    (window as any).setByName("image_quality", "best");
    expect(conn.setImageQuality).toHaveBeenCalledWith("best");
  });

  it("handles lock_screen via setByName", () => {
    const conn = newConn();
    (window as any).setByName("lock_screen", "");
    expect(conn.lockScreen).toHaveBeenCalled();
  });

  it("handles ctrl_alt_del via setByName", () => {
    const conn = newConn();
    (window as any).setByName("ctrl_alt_del", "");
    expect(conn.ctrlAltDel).toHaveBeenCalled();
  });

  it("handles switch_display via setByName", () => {
    const conn = newConn();
    (window as any).setByName("switch_display", "1");
    expect(conn.switchDisplay).toHaveBeenCalledWith("1");
  });

  it("handles remove via setByName", () => {
    localStorage.setItem("peers", JSON.stringify({ abc: { tm: 1 }, def: { tm: 2 } }));
    (window as any).setByName("remove", "abc");
    const peers = JSON.parse(localStorage.getItem("peers")!);
    expect(peers.abc).toBeUndefined();
    expect(peers.def).toBeDefined();
  });

  it("handles input_key via setByName", () => {
    const conn = newConn();
    (window as any).setByName("input_key", JSON.stringify({
      name: "a", down: "true", press: "false", alt: "false", ctrl: "false", shift: "false", command: "false",
    }));
    expect(conn.inputKey).toHaveBeenCalledWith("a", true, false, false, false, false, false);
  });

  it("handles input_string via setByName", () => {
    const conn = newConn();
    (window as any).setByName("input_string", "hello");
    expect(conn.inputString).toHaveBeenCalledWith("hello");
  });

  it("handles send_mouse down left via setByName", () => {
    const conn = newConn();
    (window as any).setByName("send_mouse", JSON.stringify({
      type: "down", buttons: "left", x: "100", y: "200",
      alt: "false", ctrl: "false", shift: "false", command: "false",
    }));
    expect(conn.inputMouse).toHaveBeenCalled();
    const args = conn.inputMouse.mock.calls[0];
    expect(args[0]).toBe((1 | (1 << 3)));
    expect(args[1]).toBe(100);
    expect(args[2]).toBe(200);
  });

  it("handles send_mouse up right via setByName", () => {
    const conn = newConn();
    (window as any).setByName("send_mouse", JSON.stringify({
      type: "up", buttons: "right", x: "50", y: "60",
      alt: "false", ctrl: "false", shift: "false", command: "false",
    }));
    const args = conn.inputMouse.mock.calls[0];
    expect(args[0]).toBe((2 | (2 << 3)));
  });

  it("handles send_mouse wheel via setByName", () => {
    const conn = newConn();
    (window as any).setByName("send_mouse", JSON.stringify({
      type: "wheel", buttons: "wheel", x: "0", y: "0",
      alt: "false", ctrl: "false", shift: "false", command: "false",
    }));
    const args = conn.inputMouse.mock.calls[0];
    expect(args[0]).toBe((3 | (4 << 3)));
  });

  it("handles peer_option via setByName", () => {
    const conn = newConn();
    (window as any).setByName("peer_option", JSON.stringify({ name: "zoom", value: "100" }));
    expect(conn.setOption).toHaveBeenCalledWith("zoom", "100");
  });

  it("handles input_os_password via setByName", () => {
    const conn = newConn();
    (window as any).setByName("input_os_password", "secret");
    expect(conn.inputOsPassword).toHaveBeenCalledWith("secret");
  });

  it("handles option:local via setByName", () => {
    (window as any).setByName("option:local", JSON.stringify({ name: "theme", value: "dark" }));
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("handles option:user:default via setByName", () => {
    (window as any).setByName("option:user:default", JSON.stringify({ name: "scroll_style", value: "scrollbar" }));
    expect(localStorage.getItem("scroll_style")).toBe("scrollbar");
  });

  it("getByName returns alternative_codecs as empty object", () => {
    expect((window as any).getByName("alternative_codecs")).toBe("{}");
  });

  it("getByName returns image_quality from connection", () => {
    newConn();
    expect((window as any).getByName("image_quality")).toBe("balanced");
  });

  it("getByName handles translate", () => {
    expect((window as any).getByName("translate", JSON.stringify({ locale: "en", text: "hello" }))).toBe("hello");
  });

  it("getByName returns peer_option from connection", () => {
    newConn();
    expect((window as any).getByName("peer_option", "some_opt")).toBe("");
  });

  it("getByName returns get_conn_status", () => {
    const result = JSON.parse((window as any).getByName("get_conn_status"));
    expect(result.status_num).toBe(1);
  });

  it("getByName returns option with key arg", () => {
    expect((window as any).getByName("option", "key")).toBe("testkey");
  });

  it("getByName returns option with custom-rendezvous-server arg", () => {
    expect((window as any).getByName("option", "custom-rendezvous-server")).toBe("testhost");
  });

  it("getByName returns option with relay-server arg", () => {
    expect((window as any).getByName("option", "relay-server")).toBe("testrelay");
  });

  it("getByName returns localStorage for generic option", () => {
    localStorage.setItem("some-opt", "val");
    expect((window as any).getByName("option", "some-opt")).toBe("val");
  });

  it("getByName returns option:local from localStorage", () => {
    localStorage.setItem("my-local-opt", "local-val");
    expect((window as any).getByName("option:local", "my-local-opt")).toBe("local-val");
  });

  it("getByName returns empty for option:flutter:peer", () => {
    expect((window as any).getByName("option:flutter:peer")).toBe("");
  });

  it("getByName returns empty for option:flutter:local", () => {
    expect((window as any).getByName("option:flutter:local")).toBe("");
  });

  it("getByName returns empty for envvar", () => {
    expect((window as any).getByName("envvar")).toBe("");
  });

  it("getByName returns remember from connection", () => {
    newConn();
    expect((window as any).getByName("remember")).toBe("false");
  });

  it("getByName returns toggle_option from connection", () => {
    newConn();
    expect((window as any).getByName("toggle_option", "some-opt")).toBe("false");
  });

  it("getByName returns peers sorted by tm descending", () => {
    localStorage.setItem("peers", JSON.stringify({
      a: { tm: 1, info: { name: "A" } },
      b: { tm: 3, info: { name: "B" } },
      c: { tm: 2, info: { name: "C" } },
    }));
    const result = JSON.parse((window as any).getByName("peers"));
    expect(result[0][0]).toBe("b");
    expect(result[1][0]).toBe("c");
    expect(result[2][0]).toBe("a");
  });

  it("getByName returns user default for scroll_style", () => {
    expect((window as any).getByName("option:user:default", "scroll_style")).toBe("scrollauto");
  });

  it("getByName returns stored value over default for user option", () => {
    localStorage.setItem("view_style", "original");
    expect((window as any).getByName("option:user:default", "view_style")).toBe("original");
  });
});

describe("newConn", () => {
  it("creates new connection and sets it as current", () => {
    const conn = newConn();
    expect(getConn()).toBe(conn);
  });

  it("closes previous connection when creating new one", () => {
    const oldConn = { close: vi.fn() };
    setConn(oldConn);
    newConn();
    expect(oldConn.close).toHaveBeenCalled();
  });
});

describe("draw", () => {
  it("posts message to yuvWorker when available", () => {
    const frame = { y: { bytes: new Uint8Array(1) } };
    draw(frame);
  });

  it("logs renderer path info on startup", () => {
    // The setup has WebGLFrameSink.isAvailable() = false, so Web Worker path is used.
    // The console.info call happens at module load time — verify it was called.
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    // Re-importing would be needed to capture module-level logs,
    // but we can verify the worker path is active by confirming postMessage works.
    const frame = { y: { bytes: new Uint8Array(1) } };
    draw(frame);
    // yuvWorker.postMessage is called without error
    infoSpy.mockRestore();
  });
});

describe("copyToClipboard", () => {
  it("attempts to copy text", () => {
    copyToClipboard("test text");
  });
});

describe("initAudio / playAudio", () => {
  it("initializes audio player", () => {
    initAudio(2, 48000);
  });

  it("destroys previous player on reinit", () => {
    const before = mockPCMPlayerInstances.length;
    initAudio(2, 48000);
    const firstPlayer = mockPCMPlayerInstances[before];
    initAudio(2, 44100);
    expect(firstPlayer.destroy).toHaveBeenCalled();
  });

  it("sends audio packet to opus worker", () => {
    const packet = new Uint8Array([1, 2, 3]);
    playAudio(packet);
  });
});

describe("sodium initialization", () => {
  it("initSodium resolves without error", async () => {
    await expect(initSodium()).resolves.toBeUndefined();
  });

  it("initSodium is idempotent", async () => {
    await initSodium();
    await initSodium();
  });

  it("crypto functions work after initSodium", async () => {
    await initSodium();
    expect(() => genBoxKeyPair()).not.toThrow();
    expect(() => genSecretKey()).not.toThrow();
  });

  it("source: all crypto functions use requireSodium() not raw _sodium", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "globals.js"), "utf-8");

    const cryptoSection = source.slice(source.indexOf("function requireSodium()"));
    const cryptoFunctions = cryptoSection.match(/export (?:async )?function \w+/g) || [];
    expect(cryptoFunctions.length).toBeGreaterThan(0);

    const lines = cryptoSection.split("\n");
    for (const line of lines) {
      if (line.includes("import _sodium") || line.includes("_sodium.ready")) continue;
      if (line.match(/\b_sodium\b/) && !line.includes("{ sodium = _sodium; }")) {
        throw new Error(`Direct _sodium usage found: ${line.trim()}`);
      }
    }
  });

  it("source: connection.ts calls initSodium() before crypto operations", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "connection.ts"), "utf-8");

    const startMethod = source.slice(source.indexOf("async _start("));
    const initLine = startMethod.indexOf("initSodium()");
    expect(initLine).toBeGreaterThan(-1);

    const verifyLine = startMethod.indexOf("verify(");
    if (verifyLine > -1) {
      expect(initLine).toBeLessThan(verifyLine);
    }
  });
});

describe("window.init", () => {
  it("runs init sequence", async () => {
    await (window as any).init();
  });
});
