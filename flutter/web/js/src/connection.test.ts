/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./message.js", () => ({
  Message: {
    encode: vi.fn(() => ({ finish: () => new Uint8Array([1]) })),
    fromPartial: vi.fn((v: any) => v),
    decode: vi.fn(() => ({})),
  },
  Hash: { fromPartial: vi.fn((v: any) => v) },
  LoginRequest: { fromPartial: vi.fn((v: any) => v) },
  OptionMessage: { fromPartial: vi.fn((v: any) => v) },
  OptionMessage_BoolOption: { Yes: 1, No: 0 },
  KeyEvent: { fromPartial: vi.fn((v: any) => v) },
  MouseEvent: { fromPartial: vi.fn((v: any) => v) },
  Misc: { fromPartial: vi.fn((v: any) => v) },
  SwitchDisplay: { fromPartial: vi.fn((v: any) => v) },
  PublicKey: { fromPartial: vi.fn((v: any) => v) },
  PeerInfo: { fromPartial: vi.fn((v: any) => v) },
  IdPk: { decode: vi.fn(() => ({ id: "test", pk: new Uint8Array(32) })) },
  ControlKey: {
    Alt: 1, Control: 2, Shift: 3, Meta: 4,
    CtrlAltDel: 100, Delete: 101, LockScreen: 102,
  },
  ImageQuality: { Low: 0, Best: 1, Balanced: 2 },
  PermissionInfo_Permission: { Keyboard: 1, Clipboard: 2, Audio: 3 },
}));

vi.mock("./rendezvous.js", () => ({
  RendezvousMessage: {
    encode: vi.fn(() => ({ finish: () => new Uint8Array([1]) })),
    fromPartial: vi.fn((v: any) => v),
    decode: vi.fn(() => ({})),
  },
  ConnType: { DEFAULT_CONN: 0 },
  NatType: { SYMMETRIC: 0 },
  PunchHoleRequest: { fromPartial: vi.fn((v: any) => v) },
  PunchHoleResponse_Failure: {
    UNRECOGNIZED: -1, ID_NOT_EXIST: 0, OFFLINE: 1, LICENSE_MISMATCH: 2, LICENSE_OVERUSE: 3,
  },
  RequestRelay: { fromPartial: vi.fn((v: any) => v) },
  RelayResponse: { fromPartial: vi.fn((v: any) => v) },
}));

let nextWsResponse: any = {};
let nextWsResponses: any[] = [];

vi.mock("./websock", () => {
  class MockWebsock {
    sendMessage = vi.fn();
    sendRendezvous = vi.fn();
    open = vi.fn().mockResolvedValue(undefined);
    next = vi.fn().mockImplementation(() => {
      if (nextWsResponses.length) return Promise.resolve(nextWsResponses.shift());
      return Promise.resolve(nextWsResponse);
    });
    close = vi.fn();
    setSecretKey = vi.fn();
  }
  return { default: MockWebsock };
});

vi.mock("./codec", () => ({
  loadVp9: vi.fn((cb: Function) => {
    cb({ processFrame: vi.fn(), close: vi.fn() });
  }),
}));

vi.mock("fast-sha256", () => {
  class MockHash {
    update = vi.fn();
    digest = vi.fn(() => new Uint8Array(32));
  }
  return { Hash: MockHash };
});

vi.mock("./globals", () => ({
  msgbox: vi.fn(),
  draw: vi.fn(),
  pushEvent: vi.fn(),
  getPeers: vi.fn(() => ({})),
  initSodium: vi.fn().mockResolvedValue(undefined),
  isDesktop: vi.fn(() => true),
  verify: vi.fn().mockResolvedValue(new Uint8Array(32)),
  genBoxKeyPair: vi.fn(() => [new Uint8Array(32), new Uint8Array(32)]),
  genSecretKey: vi.fn(() => new Uint8Array(32)),
  seal: vi.fn(() => new Uint8Array(48)),
  copyToClipboard: vi.fn(),
  initAudio: vi.fn(),
  playAudio: vi.fn(),
}));

vi.mock("./common", () => ({
  decompress: vi.fn().mockResolvedValue(new Uint8Array(10)),
  mapKey: vi.fn((name: string) => ({ chr: name.charCodeAt(0) })),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./url", () => ({
  loadConfig: vi.fn().mockResolvedValue(undefined),
  getConfigKey: vi.fn(() => "testkey"),
  getDefaultUri: vi.fn((relay?: boolean) => relay ? "ws://relay:21119" : "ws://host:21118"),
  getHost: vi.fn(() => "host:21116"),
  getRelayHost: vi.fn(() => "relay:21117"),
}));

import Connection, { getConfigHost, getConfigRelay } from "./connection";
import * as globals from "./globals";
import { IdPk } from "./message.js";

describe("getConfigHost / getConfigRelay", () => {
  it("returns host from url module", () => {
    expect(getConfigHost()).toBe("host:21116");
  });

  it("returns relay from url module", () => {
    expect(getConfigRelay()).toBe("relay:21117");
  });
});

describe("Connection", () => {
  let conn: Connection;

  let mockWs: any;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    nextWsResponse = {};
    nextWsResponses = [];
    conn = new Connection();
    (conn as any)._options = {};
    (conn as any)._id = "test-id";
    mockWs = {
      sendMessage: vi.fn(),
      sendRendezvous: vi.fn(),
      open: vi.fn().mockResolvedValue(undefined),
      next: vi.fn().mockResolvedValue({}),
      close: vi.fn(),
      setSecretKey: vi.fn(),
    };
    (conn as any)._ws = mockWs;
  });

  describe("constructor", () => {
    it("initializes with empty state", () => {
      const c = new Connection();
      expect((c as any)._msgs).toEqual([]);
      expect((c as any)._id).toBe("");
      expect((c as any)._videoTestSpeed).toEqual([0, 0]);
    });
  });

  describe("getOption / setOption", () => {
    it("gets and sets options", () => {
      conn.setOption("test", "value");
      expect(conn.getOption("test")).toBe("value");
    });

    it("deletes option when value is undefined", () => {
      conn.setOption("test", "value");
      conn.setOption("test", undefined);
      expect(conn.getOption("test")).toBeUndefined();
    });

    it("persists to localStorage", () => {
      conn.setOption("foo", "bar");
      const peers = JSON.parse(localStorage.getItem("peers")!);
      expect(peers["test-id"].foo).toBe("bar");
    });
  });

  describe("getRemember / setRemember", () => {
    it("returns false by default", () => {
      expect(conn.getRemember()).toBe(false);
    });

    it("returns true when set", () => {
      conn.setRemember(true);
      expect(conn.getRemember()).toBe(true);
    });
  });

  describe("getMod", () => {
    it("returns empty array when no modifiers", () => {
      expect(conn.getMod(false, false, false, false)).toEqual([]);
    });

    it("returns all modifiers when all true", () => {
      const mods = conn.getMod(true, true, true, true);
      expect(mods).toHaveLength(4);
    });

    it("returns only alt when alt is true", () => {
      expect(conn.getMod(true, false, false, false)).toEqual([1]);
    });
  });

  describe("getImageQuality", () => {
    it("returns image-quality option", () => {
      conn.setOption("image-quality", "best");
      expect(conn.getImageQuality()).toBe("best");
    });
  });

  describe("getImageQualityEnum", () => {
    it("returns Low for 'low'", () => {
      expect(conn.getImageQualityEnum("low", false)).toBe(0);
    });

    it("returns Best for 'best'", () => {
      expect(conn.getImageQualityEnum("best", false)).toBe(1);
    });

    it("returns Balanced for 'balanced' when not ignoring default", () => {
      expect(conn.getImageQualityEnum("balanced", false)).toBe(2);
    });

    it("returns undefined for 'balanced' when ignoring default", () => {
      expect(conn.getImageQualityEnum("balanced", true)).toBeUndefined();
    });

    it("returns undefined for unknown quality", () => {
      expect(conn.getImageQualityEnum("unknown", false)).toBeUndefined();
    });
  });

  describe("getOptionMessage", () => {
    it("returns undefined when no options set", () => {
      expect(conn.getOptionMessage()).toBeUndefined();
    });

    it("returns message with show-remote-cursor", () => {
      (conn as any)._options["show-remote-cursor"] = true;
      const msg = conn.getOptionMessage();
      expect(msg).toBeDefined();
      expect(msg!.show_remote_cursor).toBe(1);
    });

    it("returns message with image quality", () => {
      conn.setOption("image-quality", "best");
      const msg = conn.getOptionMessage();
      expect(msg).toBeDefined();
    });

    it("returns message with multiple options", () => {
      (conn as any)._options["disable-audio"] = true;
      (conn as any)._options["disable-clipboard"] = true;
      (conn as any)._options["lock-after-session-end"] = true;
      (conn as any)._options["privacy-mode"] = true;
      const msg = conn.getOptionMessage();
      expect(msg).toBeDefined();
    });
  });

  describe("shouldAutoLogin", () => {
    it("returns empty string by default", () => {
      expect(conn.shouldAutoLogin()).toBe("");
    });

    it("returns password when all conditions met", () => {
      conn.setOption("os-password", "secret");
      conn.setOption("lock-after-session-end", true);
      conn.setOption("auto-login", true);
      expect(conn.shouldAutoLogin()).toBe("secret");
    });
  });

  describe("close", () => {
    it("clears msgs and closes ws", () => {
      (conn as any)._msgs = [{ test: true }];
      conn.close();
      expect((conn as any)._msgs).toEqual([]);
      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe("refresh", () => {
    it("sends refresh_video message", () => {
      conn.refresh();
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });
  });

  describe("inputKey", () => {
    it("sends key event", () => {
      conn.inputKey("a", true, false, false, false, false, false);
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("clears alt modifier for VK_MENU", () => {
      conn.inputKey("VK_MENU", true, false, true, false, false, false);
      const call = mockWs.sendMessage.mock.calls[0][0];
      expect(call.key_event.modifiers).toEqual([]);
    });

    it("clears ctrl modifier for VK_CONTROL", () => {
      conn.inputKey("VK_CONTROL", true, false, false, true, false, false);
      const call = mockWs.sendMessage.mock.calls[0][0];
      expect(call.key_event.modifiers).toEqual([]);
    });

    it("clears shift modifier for VK_SHIFT", () => {
      conn.inputKey("VK_SHIFT", true, false, false, false, true, false);
      const call = mockWs.sendMessage.mock.calls[0][0];
      expect(call.key_event.modifiers).toEqual([]);
    });

    it("clears command modifier for Meta", () => {
      conn.inputKey("Meta", true, false, false, false, false, true);
      const call = mockWs.sendMessage.mock.calls[0][0];
      expect(call.key_event.modifiers).toEqual([]);
    });
  });

  describe("inputString", () => {
    it("sends key event with seq", () => {
      conn.inputString("hello");
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });
  });

  describe("inputMouse", () => {
    it("sends mouse event", () => {
      conn.inputMouse(1, 100, 200, false, false, false, false);
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("sends mouse event with default params", () => {
      conn.inputMouse();
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });
  });

  describe("ctrlAltDel", () => {
    it("sends CtrlAltDel for Windows", () => {
      (conn as any)._peerInfo = { platform: "Windows" };
      conn.ctrlAltDel();
      const call = mockWs.sendMessage.mock.calls[0][0];
      expect(call.key_event.control_key).toBe(100);
    });

    it("sends Delete+mods for non-Windows", () => {
      (conn as any)._peerInfo = { platform: "Linux" };
      conn.ctrlAltDel();
      const call = mockWs.sendMessage.mock.calls[0][0];
      expect(call.key_event.control_key).toBe(101);
    });
  });

  describe("lockScreen", () => {
    it("sends LockScreen key event", () => {
      conn.lockScreen();
      const call = mockWs.sendMessage.mock.calls[0][0];
      expect(call.key_event.control_key).toBe(102);
    });
  });

  describe("switchDisplay", () => {
    it("sends switch_display misc message", () => {
      conn.switchDisplay(1);
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });
  });

  describe("setImageQuality", () => {
    it("sends image quality option", () => {
      conn.setImageQuality("best");
      expect(conn.getOption("image-quality")).toBe("best");
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("does not send when quality is undefined", () => {
      conn.setImageQuality("unknown");
      expect(mockWs.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("toggleOption", () => {
    it("toggles show-remote-cursor", () => {
      conn.toggleOption("show-remote-cursor");
      expect(conn.getOption("show-remote-cursor")).toBe(true);
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("toggles disable-audio", () => {
      conn.toggleOption("disable-audio");
      expect(conn.getOption("disable-audio")).toBe(true);
    });

    it("toggles disable-clipboard", () => {
      conn.toggleOption("disable-clipboard");
      expect(conn.getOption("disable-clipboard")).toBe(true);
    });

    it("toggles lock-after-session-end", () => {
      conn.toggleOption("lock-after-session-end");
      expect(conn.getOption("lock-after-session-end")).toBe(true);
    });

    it("toggles privacy-mode", () => {
      conn.toggleOption("privacy-mode");
      expect(conn.getOption("privacy-mode")).toBe(true);
    });

    it("handles block-input without setting option", () => {
      conn.toggleOption("block-input");
      expect(conn.getOption("block-input")).toBeUndefined();
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("handles unblock-input", () => {
      conn.toggleOption("unblock-input");
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("ignores unknown option", () => {
      conn.toggleOption("unknown-option");
      expect(mockWs.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    beforeEach(() => {
      (conn as any)._hash = {
        salt: new Uint8Array(16),
        challenge: new Uint8Array(16),
      };
    });

    it("sends login with hashed password", () => {
      conn.login("mypassword");
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("sends login with stored password", () => {
      (conn as any)._password = new Uint8Array(32);
      conn.login();
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("sends login without password", () => {
      conn.login();
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });
  });

  describe("handlePeerInfo", () => {
    it("shows error when no displays", () => {
      conn.handlePeerInfo({ displays: [] } as any);
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Remote Error", "No Display");
    });

    it("pushes peer_info event on success", () => {

      conn.handlePeerInfo({
        displays: [{ x: 0, y: 0, width: 1920, height: 1080 }],
        username: "user",
      } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("peer_info", expect.anything());
    });

    it("saves password when remember is true", () => {
      conn.setRemember(true);
      (conn as any)._password = new Uint8Array([1, 2, 3]);
      conn.handlePeerInfo({
        displays: [{ x: 0, y: 0, width: 1920, height: 1080 }],
      } as any);
      expect(conn.getOption("password")).toBeDefined();
    });

    it("clears password when remember is false", () => {
      conn.setOption("password", "old");
      conn.handlePeerInfo({
        displays: [{ x: 0, y: 0, width: 1920, height: 1080 }],
      } as any);
      expect(conn.getOption("password")).toBeUndefined();
    });
  });

  describe("handleMisc", () => {
    it("handles audio_format", () => {

      conn.handleMisc({ audio_format: { channels: 2, sample_rate: 48000 } } as any);
      expect(globals.initAudio).toHaveBeenCalledWith(2, 48000);
    });

    it("handles chat_message", () => {

      conn.handleMisc({ chat_message: { text: "hello" } } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("chat", { text: "hello" });
    });

    it("handles permission_info for keyboard", () => {

      conn.handleMisc({ permission_info: { permission: 1, enabled: true } } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("permission", { keyboard: true });
    });

    it("handles permission_info for clipboard", () => {

      conn.handleMisc({ permission_info: { permission: 2, enabled: true } } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("permission", { clipboard: true });
    });

    it("handles permission_info for audio", () => {

      conn.handleMisc({ permission_info: { permission: 3, enabled: false } } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("permission", { audio: false });
    });

    it("returns undefined for unknown permission", () => {
      const result = conn.handleMisc({ permission_info: { permission: 99, enabled: true } } as any);
      expect(result).toBeUndefined();
    });

    it("handles switch_display", () => {

      conn.handleMisc({ switch_display: { display: 1 } } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("switch_display", { display: 1 });
    });

    it("handles close_reason and returns false", () => {
      const result = conn.handleMisc({ close_reason: "Kicked" } as any);
      expect(result).toBe(false);
    });

    it("returns true for other misc messages", () => {
      const result = conn.handleMisc({ audio_format: { channels: 1, sample_rate: 44100 } } as any);
      expect(result).toBe(true);
    });
  });

  describe("msgbox", () => {
    it("calls the msgbox callback", () => {

      conn.msgbox("info", "Title", "Text");
      expect(globals.msgbox).toHaveBeenCalledWith("info", "Title", "Text");
    });
  });

  describe("draw", () => {
    it("calls draw callback and globals.draw", () => {

      const frame = { y: new Uint8Array(1) };
      conn.draw(frame);
      expect(globals.draw).toHaveBeenCalledWith(frame);
    });
  });

  describe("setMsgbox / setDraw", () => {
    it("sets custom msgbox callback", () => {
      const custom = vi.fn();
      conn.setMsgbox(custom);
      conn.msgbox("info", "T", "M");
      expect(custom).toHaveBeenCalledWith("info", "T", "M");
    });

    it("sets custom draw callback", () => {
      const custom = vi.fn();
      conn.setDraw(custom);
      conn.draw({ test: true });
      expect(custom).toHaveBeenCalledWith({ test: true });
    });
  });

  describe("sendVideoReceived", () => {
    it("sends video_received misc message", () => {
      conn.sendVideoReceived();
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });
  });

  describe("start", () => {
    it("catches and displays connection errors", async () => {

      (conn as any)._start = vi.fn().mockRejectedValue(new Error("fail"));
      await conn.start("test");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Error: fail");
    });

    it("shows 'Reset by the peer' for close events", async () => {

      (conn as any)._start = vi.fn().mockRejectedValue({ type: "close" });
      await conn.start("test");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Reset by the peer");
    });
  });

  describe("reconnect", () => {
    it("closes and restarts connection", async () => {
      const closeSpy = vi.spyOn(conn, "close");
      const startSpy = vi.spyOn(conn, "start").mockResolvedValue(undefined);
      await conn.reconnect();
      expect(closeSpy).toHaveBeenCalled();
      expect(startSpy).toHaveBeenCalledWith("test-id");
    });
  });

  describe("inputOsPassword", () => {
    it("sends mouse clicks and password", async () => {
      await conn.inputOsPassword("secret");
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });
  });

  describe("handleVideoFrame", () => {
    it("clears msgbox on first frame", () => {
      const mockDecoder = {
        processFrame: vi.fn((data: any, cb: Function) => cb(false)),
        frameBuffer: null,
        close: vi.fn(),
      };
      (conn as any)._videoDecoder = mockDecoder;
      (conn as any)._firstFrame = false;

      conn.handleVideoFrame({
        vp9s: { frames: [{ data: new Uint8Array([1, 2]) }] },
      } as any);

      expect(globals.msgbox).toHaveBeenCalledWith("", "", "");
    });

    it("draws frame when decoder succeeds", () => {
      const frameBuffer = { format: { displayWidth: 1920, displayHeight: 1080 } };
      const mockDecoder = {
        processFrame: vi.fn((data: any, cb: Function) => {
          mockDecoder.frameBuffer = frameBuffer;
          cb(true);
        }),
        frameBuffer: null as any,
        close: vi.fn(),
      };
      (conn as any)._videoDecoder = mockDecoder;
      (conn as any)._firstFrame = true;

      conn.handleVideoFrame({
        vp9s: { frames: [{ data: new Uint8Array([1, 2]) }] },
      } as any);

      expect(globals.draw).toHaveBeenCalledWith(frameBuffer);
    });

    it("sends video received after processing all frames", () => {
      const mockDecoder = {
        processFrame: vi.fn((data: any, cb: Function) => cb(false)),
        frameBuffer: null,
        close: vi.fn(),
      };
      (conn as any)._videoDecoder = mockDecoder;
      (conn as any)._firstFrame = true;

      conn.handleVideoFrame({
        vp9s: { frames: [{ data: new Uint8Array([1]) }, { data: new Uint8Array([2]) }] },
      } as any);

      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("acks frames without crashing when decoder is not ready", () => {
      (conn as any)._videoDecoder = undefined;
      (conn as any)._firstFrame = true;
      (conn as any)._ws = mockWs;

      conn.handleVideoFrame({
        vp9s: { frames: [{ data: new Uint8Array([1]) }] },
      } as any);

      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("warns once when decoder is not ready", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      (conn as any)._videoDecoder = undefined;
      (conn as any)._firstFrame = true;

      conn.handleVideoFrame({ vp9s: { frames: [{ data: new Uint8Array([1]) }] } } as any);
      conn.handleVideoFrame({ vp9s: { frames: [{ data: new Uint8Array([2]) }] } } as any);

      const decoderWarns = warnSpy.mock.calls.filter(c => c[0].includes("decoder not ready"));
      expect(decoderWarns).toHaveLength(1);
      warnSpy.mockRestore();
    });

    it("warns once on decode failure", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mockDecoder = {
        processFrame: vi.fn((data: any, cb: Function) => cb(false)),
        frameBuffer: null,
        close: vi.fn(),
      };
      (conn as any)._videoDecoder = mockDecoder;
      (conn as any)._firstFrame = true;

      conn.handleVideoFrame({ vp9s: { frames: [{ data: new Uint8Array([1]) }] } } as any);
      conn.handleVideoFrame({ vp9s: { frames: [{ data: new Uint8Array([2]) }] } } as any);

      const decodeWarns = warnSpy.mock.calls.filter(c => c[0].includes("decode failed"));
      expect(decodeWarns).toHaveLength(1);
      warnSpy.mockRestore();
    });

    it("warns once for unsupported codec and acks the frame", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      (conn as any)._firstFrame = true;

      conn.handleVideoFrame({ av1s: { frames: [{ data: new Uint8Array([1]) }] } } as any);
      conn.handleVideoFrame({ h264s: { frames: [{ data: new Uint8Array([2]) }] } } as any);

      const codecWarns = warnSpy.mock.calls.filter(c => c[0].includes("unsupported codec"));
      expect(codecWarns).toHaveLength(1);
      expect(codecWarns[0][0]).toContain("AV1");
      expect(mockWs.sendMessage).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("decoder lifecycle", () => {
    it("close() clears decoder and increments generation", () => {
      const mockDecoder = { close: vi.fn() };
      (conn as any)._videoDecoder = mockDecoder;
      const genBefore = (conn as any)._decoderGeneration;
      conn.close();
      expect(mockDecoder.close).toHaveBeenCalled();
      expect((conn as any)._videoDecoder).toBeUndefined();
      expect((conn as any)._decoderGeneration).toBeGreaterThan(genBefore);
    });
  });

  describe("_start", () => {
    it("connects to rendezvous and handles punch_hole_response with other_failure", async () => {
      nextWsResponse = { punch_hole_response: { other_failure: "Server busy" } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Error", "Server busy");
    });

    it("does not treat default failure value (0) as an error", async () => {
      nextWsResponse = { punch_hole_response: { failure: 0 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).not.toHaveBeenCalledWith("error", expect.anything(), expect.anything());
    });

    it("handles OFFLINE failure", async () => {
      nextWsResponse = { punch_hole_response: { failure: 1 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Error", "Remote desktop is offline");
    });

    it("handles LICENSE_MISMATCH failure", async () => {
      nextWsResponse = { punch_hole_response: { failure: 2 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Error", "Key mismatch");
    });

    it("handles LICENSE_OVERUSE failure", async () => {
      nextWsResponse = { punch_hole_response: { failure: 3 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Error", "Key overuse");
    });

    it("handles unrecognized nonzero failure with generic message", async () => {
      nextWsResponse = { punch_hole_response: { failure: 99 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Error", "Connection failed");
    });

    it("handles relay_response with no version", async () => {
      nextWsResponse = { relay_response: { version: 0, pk: new Uint8Array(32), uuid: "test-uuid" } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Error", "Remote version is low, not support web");
    });

    it("loads stored password from options", async () => {
      (conn as any)._options = { password: "1,2,3,4" };
      (conn as any)._password = undefined;
      nextWsResponse = { punch_hole_response: { other_failure: "stop" } };
      await (conn as any)._start("test-peer");
      expect((conn as any)._password).toBeInstanceOf(Uint8Array);
    });

    it("handles invalid stored password gracefully", async () => {
      (conn as any)._options = { password: "not-valid-array" };
      (conn as any)._password = undefined;
      nextWsResponse = { punch_hole_response: { other_failure: "stop" } };
      await (conn as any)._start("test-peer");
    });
  });

  describe("connectRelay", () => {
    it("connects to relay server and starts msg loop", async () => {
      const secureSpy = vi.spyOn(conn as any, "secure").mockResolvedValue(true);
      const msgLoopSpy = vi.spyOn(conn as any, "msgLoop").mockResolvedValue(undefined);

      await conn.connectRelay({
        pk: new Uint8Array(32),
        uuid: "test-uuid",
      } as any);

      expect(secureSpy).toHaveBeenCalled();
      expect(globals.pushEvent).toHaveBeenCalledWith("connection_ready", { secure: true, direct: false });
      expect(msgLoopSpy).toHaveBeenCalled();
    });
  });

  describe("secure", () => {
    it("sends empty public key when pk is undefined", async () => {
      await (conn as any).secure(undefined);
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("sends empty public key when pk verification fails", async () => {
      vi.mocked(globals.verify).mockRejectedValueOnce(new Error("verify failed"));
      await (conn as any).secure(new Uint8Array(32));
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("establishes secure connection with valid pk", async () => {

      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });
      vi.mocked(globals.verify).mockResolvedValueOnce(new Uint8Array(64));
      mockWs.next.mockResolvedValueOnce({
        signed_id: { id: new Uint8Array(32) },
      });
      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });

      const result = await (conn as any).secure(new Uint8Array(32));
      expect(result).toBe(true);
      expect(mockWs.setSecretKey).toHaveBeenCalled();
    });

    it("falls back when signed_id is missing", async () => {

      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });
      vi.mocked(globals.verify).mockResolvedValueOnce(new Uint8Array(64));
      mockWs.next.mockResolvedValueOnce({});

      await (conn as any).secure(new Uint8Array(32));
      expect(mockWs.sendMessage).toHaveBeenCalled();
    });

    it("falls back when id doesn't match", async () => {

      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });
      vi.mocked(globals.verify).mockResolvedValueOnce(new Uint8Array(64));
      mockWs.next.mockResolvedValueOnce({
        signed_id: { id: new Uint8Array(32) },
      });
      IdPk.decode.mockReturnValueOnce({ id: "wrong-id", pk: new Uint8Array(32) });

      await (conn as any).secure(new Uint8Array(32));
    });

    it("falls back when peer pk length is wrong", async () => {

      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });
      vi.mocked(globals.verify).mockResolvedValueOnce(new Uint8Array(64));
      mockWs.next.mockResolvedValueOnce({
        signed_id: { id: new Uint8Array(32) },
      });
      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(16) });

      await (conn as any).secure(new Uint8Array(32));
    });
  });
});
