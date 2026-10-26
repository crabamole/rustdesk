/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  CaptureDisplays: { fromPartial: vi.fn((v: any) => v) },
  PublicKey: { fromPartial: vi.fn((v: any) => v) },
  PeerInfo: { fromPartial: vi.fn((v: any) => v) },
  ControlKey: {
    Alt: 1, Control: 2, Shift: 3, Meta: 4,
    CtrlAltDel: 100, Delete: 101, LockScreen: 102, CapsLock: 3, NumLock: 63,
  },
  KeyboardMode: { Legacy: 0, Map: 1 },
  ImageQuality: { Low: 0, Best: 1, Balanced: 2 },
  PermissionInfo_Permission: { Keyboard: 1, Clipboard: 2, Audio: 3, Restart: 5, BlockInput: 7, PrivacyMode: 8 },
  BackNotification_BlockInputState: { BlkOnSucceeded: 2, BlkOnFailed: 3, BlkOffSucceeded: 4, BlkOffFailed: 5 },
  BackNotification_PrivacyModeState: { PrvOnByOther: 2, PrvNotSupported: 3, PrvOnSucceeded: 4, PrvOnFailedDenied: 5, PrvOnFailedPlugin: 6, PrvOnFailed: 7, PrvOffSucceeded: 8, PrvOffByPeer: 9, PrvOffFailed: 10, PrvOffUnknown: 11 },
  TogglePrivacyMode: { fromPartial: vi.fn((v: any) => v) },
  Clipboard: { fromPartial: vi.fn((v: any) => v) },
  ClipboardFormat: { Text: 0, Html: 2 },
  ClipboardOffer: { fromPartial: vi.fn((v: any) => v) },
  ClipboardReply: { fromPartial: vi.fn((v: any) => v) },
  ChatMessage: { fromPartial: vi.fn((v: any) => v) },
  Resolution: { fromPartial: vi.fn((v: any) => v) },
  DisplayResolution: { fromPartial: vi.fn((v: any) => v) },
  Auth2FA: { fromPartial: vi.fn((v: any) => v) },
  ScreenshotRequest: { fromPartial: vi.fn((v: any) => v) },
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
  IdPk: { decode: vi.fn(() => ({ id: "test", pk: new Uint8Array(32) })) },
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
  pkToFingerprint: vi.fn(() => "fp"),
  getVersionNumber: vi.fn((v: string) => {
    const [a = 0, b = 0, c = 0] = (v || "").split("-")[0].split(".").map(Number);
    return a * 1000000 + b * 1000 + c * 10;
  }),
}));

vi.mock("./url", () => ({
  loadConfig: vi.fn().mockResolvedValue(undefined),
  getConfigKey: vi.fn(() => "testkey"),
  getDefaultUri: vi.fn(() => "ws://host:21118"),
  getHost: vi.fn(() => "host:21116"),
  getRelayUri: vi.fn((relay?: string) => relay || "ws://relay:21119"),
  getApiServer: vi.fn(() => "https://api.example.com"),
}));

import Connection, { getConfigHost } from "./connection";
import * as globals from "./globals";
import { IdPk } from "./rendezvous.js";
import { getRelayUri } from "./url";

describe("getConfigHost", () => {
  it("returns host from url module", () => {
    expect(getConfigHost()).toBe("host:21116");
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
    it("falls back to the user's default image quality", () => {
      localStorage.setItem("image_quality", "best");
      expect(conn.getImageQuality()).toBe("best");
      conn.setOption("image-quality", "low");
      expect(conn.getImageQuality()).toBe("low");
    });

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
    it("sends the stored toggles at login, as native; view-only overrides", () => {
      (conn as any)._options = { "follow-remote-cursor": true, "lock-after-session-end": true, "view-only": true };
      expect(conn.getOptionMessage()).toMatchObject({
        follow_remote_cursor: 1, disable_keyboard: 1, show_remote_cursor: 1, disable_clipboard: 1,
      });
      expect(conn.getOptionMessage()!.lock_after_session_end).toBeUndefined();
    });

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
    it("tells the device before closing, once", () => {
      conn.close();
      conn.close();
      const closes = mockWs.sendMessage.mock.calls.filter((c: any) => c[0].misc?.close_reason === "");
      expect(closes.length).toBe(1);
    });

    it("clears msgs and closes ws", () => {
      (conn as any)._msgs = [{ test: true }];
      conn.close();
      expect((conn as any)._msgs).toEqual([]);
      expect(mockWs.close).toHaveBeenCalled();
    });
  });

  describe("login message", () => {
    const sentName = () => mockWs.sendMessage.mock.calls[0][0].login_request.my_name;

    it("names the logged-in user", () => {
      localStorage.setItem("user_info", JSON.stringify({ name: "Alice Chen" }));
      (conn as any)._sendLoginMessage();
      expect(sentName()).toBe("Alice Chen");
    });

    it("falls back to web without a login", () => {
      (conn as any)._sendLoginMessage();
      expect(sentName()).toBe("web");
    });
  });

  describe("map mode, as native", () => {
    const sentKey = () => mockWs.sendMessage.mock.calls.at(-1)[0].key_event;

    it("sends the peer platform's key code for the USB HID code", () => {
      (conn as any)._peerInfo = { platform: "Windows", version: "1.5.0" };
      conn.inputMapKey(4, 0, true);
      expect(sentKey()).toEqual({ mode: 1, chr: 30, down: true, modifiers: [] });
      (conn as any)._peerInfo = { platform: "Linux", version: "1.5.0" };
      conn.inputMapKey(80, 0, false);
      expect(sentKey()).toMatchObject({ chr: 113, down: false });
      (conn as any)._peerInfo = { platform: "Mac OS", version: "1.5.0" };
      conn.inputMapKey(53, 0, true);
      expect(sentKey().chr).toBe(50);
      localStorage.setItem("kb_layout_type", "ISO");
      conn.inputMapKey(53, 0, true);
      expect(sentKey().chr).toBe(10);
      localStorage.removeItem("kb_layout_type");
    });

    it("adds Caps Lock to letter keys and Num Lock to keypad keys", () => {
      (conn as any)._peerInfo = { platform: "Windows", version: "1.5.0" };
      conn.inputMapKey(4, 0b110, true);
      expect(sentKey().modifiers).toEqual([3]);
      conn.inputMapKey(89, 0b110, true);
      expect(sentKey().modifiers).toEqual([63]);
      conn.inputMapKey(40, 0b110, true);
      expect(sentKey().modifiers).toEqual([]);
    });

    it("sends nothing for a key the peer's table lacks", () => {
      (conn as any)._peerInfo = { platform: "Windows", version: "1.5.0" };
      conn.inputMapKey(0x7fff, 0, true);
      expect(mockWs.sendMessage).not.toHaveBeenCalled();
    });

    it("offers map mode as native: not for Android peers or before 1.2.0", () => {
      (conn as any)._peerInfo = { platform: "Linux", version: "1.5.0" };
      expect(conn.isKeyboardModeSupported("map")).toBe(true);
      expect(conn.isKeyboardModeSupported("translate")).toBe(false);
      (conn as any)._peerInfo = { platform: "Android", version: "1.5.0" };
      expect(conn.isKeyboardModeSupported("map")).toBe(false);
      (conn as any)._peerInfo = { platform: "Linux", version: "1.1.9" };
      expect(conn.isKeyboardModeSupported("map")).toBe(false);
      expect(conn.isKeyboardModeSupported("legacy")).toBe(true);
    });
  });

  describe("session options", () => {
    it("are readable as soon as the session starts, as native", () => {
      const c = new Connection();
      (globals.initSodium as any).mockReturnValueOnce(new Promise(() => {}));
      (globals.getPeers as any).mockReturnValueOnce({ "p1": { view_style: "original" } });
      c.start("p1");
      expect(c.getOption("view_style")).toBe("original");
      c.setOption("scroll_style", "bar");
      expect((localStorage.getItem("peers") || "").includes('"p1"')).toBe(true);
    });
  });

  describe("remote cursor", () => {
    it("keeps each shape by ID and hands it to Flutter", async () => {
      const onCursorData = vi.fn();
      (window as any).onCursorData = onCursorData;
      mockWs.next
        .mockResolvedValueOnce({ cursor_data: { id: 7, hotx: 1, hoty: 2, width: 3, height: 4, colors: new Uint8Array([9]) } })
        .mockResolvedValueOnce({ misc: { close_reason: "done" } });
      await conn.msgLoop();
      expect(onCursorData).toHaveBeenCalledWith("7", 1, 2, 3, 4, expect.any(Uint8Array));
      expect((conn as any)._cursorShapes[7]).toMatchObject({ hotx: 1, hoty: 2, width: 3, height: 4 });
      delete (window as any).onCursorData;
    });
  });

  describe("screenshot, as native", () => {
    it("asks the device for the display and saves the PNG it sends back as a download", async () => {
      (conn as any)._peerInfo = { version: "1.4.0" };
      expect(conn.isScreenshotSupported()).toBe(true);
      conn.takeScreenshot(1);
      expect(mockWs.sendMessage.mock.calls.at(-1)[0].screenshot_request).toMatchObject({ display: 1 });
      mockWs.next
        .mockResolvedValueOnce({ screenshot_response: { sid: "", msg: "", data: new Uint8Array([137, 80]) } })
        .mockResolvedValueOnce({ misc: { close_reason: "done" } });
      await conn.msgLoop();
      expect(globals.pushEvent).toHaveBeenCalledWith("screenshot", { msg: "" });
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      (URL as any).createObjectURL ??= () => "blob:x";
      expect(conn.handleScreenshot("0:shot.png")).toBe("");
      expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe("shot.png");
      expect(conn.handleScreenshot("2")).toBe("No cached screenshot");
      click.mockRestore();
    });

    it("is not offered for devices older than 1.4.0", () => {
      (conn as any)._peerInfo = { version: "1.3.9" };
      expect(conn.isScreenshotSupported()).toBe(false);
    });
  });

  describe("session actions, as native", () => {
    const sent = () => mockWs.sendMessage.mock.calls.at(-1)[0];

    it("sends chat text", () => {
      conn.sendChat("hi");
      expect(sent().misc.chat_message).toEqual({ text: "hi" });
    });

    it("asks the device to restart", () => {
      conn.restartRemoteDevice();
      expect(sent().misc.restart_remote_device).toBe(true);
    });

    it("changes the resolution per display on newer peers, as one resolution on older ones", () => {
      (conn as any)._peerInfo = { version: "1.5.0" };
      conn.changeResolution(1, 1280, 800);
      expect(sent().misc.change_display_resolution).toEqual({ display: 1, resolution: { width: 1280, height: 800 } });
      (conn as any)._peerInfo = { version: "1.2.3" };
      conn.changeResolution(0, 1024, 768);
      expect(sent().misc.change_resolution).toEqual({ width: 1024, height: 768 });
    });

    it("sends custom quality shifted by 8 bits and custom fps", () => {
      conn.setCustomImageQuality(70);
      expect(sent().misc.option.custom_image_quality).toBe(70 << 8);
      conn.setCustomFps(15);
      expect(sent().misc.option.custom_fps).toBe(15);
      conn.setImageQuality("custom");
      expect(sent().misc.option.custom_image_quality).toBe(70 << 8);
    });

    it("sends the 2FA code", () => {
      conn.send2fa("123456");
      expect(sent().auth_2fa).toEqual({ code: "123456" });
    });

    it("sends a session ID in the login request", () => {
      (conn as any)._sendLoginMessage();
      expect(sent().login_request.session_id).toBe((conn as any)._sessionId);
      expect((conn as any)._sessionId).toBeGreaterThan(0);
    });

    it("posts the note to the audit for this session when logged in", () => {
      const fetchMock = vi.fn().mockResolvedValue({});
      vi.stubGlobal("fetch", fetchMock);
      conn.sendNote("first");
      expect(fetchMock).not.toHaveBeenCalled();
      localStorage.setItem("access_token", "t");
      conn.sendNote("checked the logs");
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/api\/audit\/conn$/);
      expect(JSON.parse(init.body)).toEqual({ id: "test-id", session_id: (conn as any)._sessionId, note: "checked the logs" });
      vi.unstubAllGlobals();
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
      const sent = mockWs.sendMessage.mock.calls.map((c: any) => c[0].misc);
      expect(sent.at(-2).switch_display).toEqual({ display: 1 });
      expect(sent.at(-1).capture_displays).toEqual({ set: [1] });
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

    it("asks for privacy mode, kept only once the device confirms it, as native", () => {
      conn.toggleOption("privacy-mode");
      expect(mockWs.sendMessage.mock.calls.at(-1)[0].misc.option.privacy_mode).toBe(1);
      expect(conn.getOption("privacy-mode")).toBeUndefined();
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

    // As native toggle_option: these reach the device, the rest are stored on the session only.
    const sentOption = () => mockWs.sendMessage.mock.calls.at(-1)[0].misc.option;

    it("sends follow-remote-cursor, follow-remote-window and show-my-cursor to the device", () => {
      conn.toggleOption("follow-remote-cursor");
      expect(sentOption().follow_remote_cursor).toBe(1);
      conn.toggleOption("follow-remote-window");
      expect(sentOption().follow_remote_window).toBe(1);
      conn.toggleOption("show-my-cursor");
      expect(sentOption().show_my_cursor).toBe(1);
      expect(conn.getOption("show-my-cursor")).toBe(true);
    });

    it("turns the session view-only and back", () => {
      conn.toggleOption("show-my-cursor");
      conn.toggleOption("view-only");
      expect(sentOption()).toMatchObject({ disable_keyboard: 1, disable_clipboard: 1, show_remote_cursor: 1, enable_file_transfer: 0, lock_after_session_end: 0 });
      conn.toggleOption("view-only");
      expect(sentOption()).toMatchObject({ disable_keyboard: 0, disable_clipboard: 0, show_remote_cursor: 0, show_my_cursor: 0 });
      expect(conn.getOption("show-my-cursor")).toBe(false);
    });

    it("stores local-only toggles without sending them", () => {
      conn.toggleOption("show-quality-monitor");
      conn.toggleOption("zoom-cursor");
      expect(conn.getOption("show-quality-monitor")).toBe(true);
      expect(conn.getOption("zoom-cursor")).toBe(true);
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
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Remote Error", "No Display", false);
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

  describe("clipboard on request", () => {
    const sent = (field: string) => mockWs.sendMessage.mock.calls.map((c: any[]) => c[0][field]).filter(Boolean);
    const text = (cb: any) => new TextDecoder().decode(cb.content);
    const connectTo = (lazy: boolean) =>
      conn.handlePeerInfo({
        displays: [{ x: 0, y: 0, width: 1920, height: 1080 }],
        platform_additions: JSON.stringify({ lazy_text_clipboard: lazy }),
      } as any);
    const browserClipboard = (plain: string, html?: string) => {
      const item = {
        types: html === undefined ? ["text/plain"] : ["text/plain", "text/html"],
        getType: async (t: string) => ({ text: async () => (t == "text/html" ? html : plain) }),
      };
      const clipboard = { read: vi.fn().mockResolvedValue([item]), readText: vi.fn().mockResolvedValue(plain) };
      vi.stubGlobal("navigator", { clipboard });
      return clipboard;
    };
    const tips = (msgbox: any, tip: string) => msgbox.mock.calls.filter((c: any[]) => c[2] === tip).length;

    afterEach(() => vi.unstubAllGlobals());

    it("offers only Text when the browser clipboard holds no HTML", async () => {
      browserClipboard("copied");
      connectTo(true);
      await conn.offerClipboard();
      expect(sent("clipboard_offer")).toEqual([{ seq: 1, formats: [0] }]);
      expect(sent("clipboard")).toEqual([]);
    });

    it("offers Text and Html when the browser clipboard holds HTML", async () => {
      browserClipboard("copied", "<b>copied</b>");
      connectTo(true);
      await conn.offerClipboard();
      expect(sent("clipboard_offer")).toEqual([{ seq: 1, formats: [0, 2] }]);
    });

    it("offers nothing when the browser clipboard is empty or unchanged", async () => {
      const clipboard = browserClipboard("");
      connectTo(true);
      await conn.offerClipboard();
      clipboard.read.mockResolvedValue([{ types: ["text/plain"], getType: async () => ({ text: async () => "a" }) }]);
      await conn.offerClipboard();
      await conn.offerClipboard();
      expect(sent("clipboard_offer")).toEqual([{ seq: 1, formats: [0] }]);
    });

    it("offers nothing for text the device just sent", async () => {
      browserClipboard("from-device");
      vi.mocked(globals.copyToClipboard).mockReturnValueOnce(true);
      connectTo(true);
      mockWs.next
        .mockResolvedValueOnce({ clipboard: { compress: false, content: new TextEncoder().encode("from-device") } })
        .mockResolvedValueOnce({ misc: { close_reason: "done" } });
      await conn.msgLoop();
      await conn.offerClipboard();
      expect(sent("clipboard_offer")).toEqual([]);
    });

    it("does not offer the old browser text again after the copy of the device text failed", async () => {
      browserClipboard("old-browser-text");
      vi.mocked(globals.copyToClipboard).mockReturnValueOnce(false);
      connectTo(true);
      await conn.offerClipboard();
      mockWs.next
        .mockResolvedValueOnce({ clipboard: { compress: false, content: new TextEncoder().encode("from-device") } })
        .mockResolvedValueOnce({ misc: { close_reason: "done" } });
      await conn.msgLoop();
      await conn.offerClipboard();
      expect(sent("clipboard_offer")).toEqual([{ seq: 1, formats: [0] }]);
    });

    it("shows the browser tip only for an interactive offer whose local read fails", async () => {
      vi.stubGlobal("navigator", { clipboard: { read: vi.fn().mockRejectedValue(new Error("denied")) } });
      const msgbox = vi.spyOn(conn, "msgbox");
      connectTo(true);
      await conn.offerClipboard();
      expect(tips(msgbox, "clipboard_on_request_browser_tip")).toBe(0);
      await conn.offerClipboard(true);
      await conn.offerClipboard(true);
      expect(sent("clipboard_offer")).toEqual([]);
      expect(tips(msgbox, "clipboard_on_request_browser_tip")).toBe(1);
    });

    it("offers nothing to an older device", async () => {
      browserClipboard("copied");
      connectTo(false);
      await conn.offerClipboard();
      expect(sent("clipboard_offer")).toEqual([]);
    });

    it("offers nothing while the host disables clipboard", async () => {
      browserClipboard("copied");
      connectTo(true);
      conn.handleMisc({ permission_info: { permission: 2, enabled: false } } as any);
      await conn.offerClipboard();
      expect(sent("clipboard_offer")).toEqual([]);
    });

    it("shows the old-device note once for a device without the flag", () => {
      const msgbox = vi.spyOn(conn, "msgbox");
      connectTo(false);
      connectTo(false);
      expect(tips(msgbox, "clipboard_on_request_old_device_tip")).toBe(1);
      expect(msgbox).toHaveBeenCalledWith("custom-nook-nocancel-hasclose", "Clipboard", "clipboard_on_request_old_device_tip");
    });

    it("shows no old-device note for a device with the flag or with clipboard off", () => {
      const msgbox = vi.spyOn(conn, "msgbox");
      connectTo(true);
      const other = new Connection();
      (other as any)._options = { "disable-clipboard": true };
      const otherBox = vi.spyOn(other, "msgbox");
      other.handlePeerInfo({ displays: [{ x: 0, y: 0, width: 1, height: 1 }], platform_additions: "{}" } as any);
      expect(tips(msgbox, "clipboard_on_request_old_device_tip")).toBe(0);
      expect(tips(otherBox, "clipboard_on_request_old_device_tip")).toBe(0);
    });

    it("replies with the clipboard text when the device asks", async () => {
      browserClipboard("copied");
      connectTo(true);
      await conn.offerClipboard();
      await conn.handleClipboardRequest({ seq: 1, format: 0 } as any);
      const [reply] = sent("clipboard_reply");
      expect(reply.seq).toBe(1);
      expect(text(reply.clipboard)).toBe("copied");
    });

    it("replies empty to a request for an older offer", async () => {
      const clipboard = browserClipboard("one");
      connectTo(true);
      await conn.offerClipboard();
      clipboard.read.mockResolvedValue([{ types: ["text/plain"], getType: async () => ({ text: async () => "two" }) }]);
      await conn.offerClipboard();
      await conn.handleClipboardRequest({ seq: 1, format: 0 } as any);
      expect(text(sent("clipboard_reply")[0].clipboard)).toBe("");
      expect(clipboard.readText).not.toHaveBeenCalled();
    });

    it("replies empty and shows the browser tip once when the read on request fails", async () => {
      const clipboard = browserClipboard("copied");
      const msgbox = vi.spyOn(conn, "msgbox");
      connectTo(true);
      await conn.offerClipboard();
      clipboard.readText.mockRejectedValue(new Error("denied"));
      await conn.handleClipboardRequest({ seq: 1, format: 0 } as any);
      await conn.handleClipboardRequest({ seq: 1, format: 0 } as any);
      expect(sent("clipboard_reply").map((r: any) => text(r.clipboard))).toEqual(["", ""]);
      expect(tips(msgbox, "clipboard_on_request_browser_tip")).toBe(1);
    });
  });

  describe("handleMisc", () => {
    it("handles audio_format", () => {

      conn.handleMisc({ audio_format: { channels: 2, sample_rate: 48000 } } as any);
      expect(globals.initAudio).toHaveBeenCalledWith(2, 48000);
    });

    it("handles chat_message", () => {

      conn.handleMisc({ chat_message: { text: "hello" } } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("chat_client_mode", { text: "hello" });
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

    it("keeps the session running for permissions it does not show", () => {
      // File (4), Recording (6): hosts report them disabled at login.
      for (const permission of [4, 6, 99]) {
        const result = conn.handleMisc({ permission_info: { permission, enabled: false } } as any);
        expect(result).toBe(true);
      }
      expect(globals.pushEvent).not.toHaveBeenCalled();
    });

    it("handles switch_display", () => {

      conn.handleMisc({ switch_display: { display: 1 } } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("switch_display", { display: 1 });
    });

    it("asks for a fresh picture once the decoder is reloaded after a display switch", () => {
      (conn as any)._firstFrame = true;
      conn.handleMisc({ switch_display: { display: 1 } } as any);
      expect(mockWs.sendMessage.mock.calls.at(-1)[0].misc.refresh_video).toBe(true);
    });

    it("shows block input and privacy mode results from the device, as native", () => {
      expect(conn.handleMisc({ back_notification: { block_input_state: 2, details: "", impl_key: "" } } as any)).toBe(true);
      expect(globals.pushEvent).toHaveBeenCalledWith("update_block_input_state", { input_state: "on" });
      conn.handleMisc({ back_notification: { privacy_mode_state: 4, details: "", impl_key: "privacy_mode_impl_virtual_display" } } as any);
      expect(conn.getOption("privacy-mode")).toBe(true);
      expect(conn.getOption("privacy-mode-impl-key")).toBe("privacy_mode_impl_virtual_display");
      expect(globals.pushEvent).toHaveBeenCalledWith("update_privacy_mode", {});
      conn.handleMisc({ back_notification: { privacy_mode_state: 9, details: "", impl_key: "" } } as any);
      expect(conn.getOption("privacy-mode")).toBeUndefined();
      expect(conn.handleMisc({ back_notification: { privacy_mode_state: 2, details: "", impl_key: "" } } as any)).toBe(false);
    });

    it("shows the UAC prompt while keyboard is allowed and clears it after", () => {
      const msgbox = vi.spyOn(conn, "msgbox");
      conn.handleMisc({ uac: true } as any);
      expect(msgbox).toHaveBeenCalledWith("on-uac", "Prompt", "Please wait for confirmation of UAC...");
      conn.handleMisc({ uac: false } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("cancel_msgbox", { tag: "on-uac" });
    });

    it("asks the device to toggle a privacy mode", () => {
      conn.togglePrivacyMode("privacy_mode_impl_mag", true);
      expect(mockWs.sendMessage.mock.calls.at(-1)[0].misc.toggle_privacy_mode).toEqual({ impl_key: "privacy_mode_impl_mag", on: true });
    });

    it("follows the display the device reports, as native", () => {
      conn.handleMisc({ follow_current_display: 1 } as any);
      expect(globals.pushEvent).toHaveBeenCalledWith("follow_current_display", { display_idx: 1 });
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
      expect(globals.msgbox).toHaveBeenCalledWith("info", "Title", "Text", false);
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
      expect(custom).toHaveBeenCalledWith("info", "T", "M", false);
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
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Error: fail", false);
    });

    it("ends quietly when the user closed the session", async () => {
      (conn as any)._start = vi.fn(async () => {
        conn.close();
        throw { type: "close" };
      });
      await conn.start("test");
      expect(globals.msgbox).not.toHaveBeenCalled();
    });

    it("shows 'Reset by the peer' for close events", async () => {

      (conn as any)._start = vi.fn().mockRejectedValue({ type: "close" });
      await conn.start("test");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Reset by the peer", true);
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

      expect(globals.msgbox).toHaveBeenCalledWith("", "", "", false);
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
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Server busy", false);
    });

    it("does not treat failure 0 as an error when the peer address is set", async () => {
      nextWsResponse = { punch_hole_response: { failure: 0, socket_addr: new Uint8Array([1, 2, 3]) } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).not.toHaveBeenCalledWith("error", expect.anything(), expect.anything());
    });

    it("handles ID_NOT_EXIST failure", async () => {
      nextWsResponse = { punch_hole_response: { failure: 0, socket_addr: new Uint8Array(0) } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "ID does not exist", false);
    });

    it("handles OFFLINE failure", async () => {
      nextWsResponse = { punch_hole_response: { failure: 1 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Remote desktop is offline", false);
    });

    it("handles LICENSE_MISMATCH failure", async () => {
      nextWsResponse = { punch_hole_response: { failure: 2 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Key mismatch", false);
    });

    it("handles LICENSE_OVERUSE failure", async () => {
      nextWsResponse = { punch_hole_response: { failure: 3 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Key overuse", false);
    });

    it("handles unrecognized nonzero failure with generic message", async () => {
      nextWsResponse = { punch_hole_response: { failure: 99 } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Connection Error", "Connection failed", false);
    });

    it("handles relay_response with no version", async () => {
      nextWsResponse = { relay_response: { version: 0, pk: new Uint8Array(32), uuid: "test-uuid" } };
      await (conn as any)._start("test-peer");
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Error", "Remote version is low, not support web", false);
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

    it("starts no session when the handshake is refused", async () => {
      vi.spyOn(conn as any, "secure").mockResolvedValue(false);
      const msgLoopSpy = vi.spyOn(conn as any, "msgLoop").mockResolvedValue(undefined);

      await conn.connectRelay({ pk: new Uint8Array(32), uuid: "test-uuid" } as any);

      expect(globals.pushEvent).not.toHaveBeenCalledWith("connection_ready", expect.anything());
      expect(msgLoopSpy).not.toHaveBeenCalled();
    });

    it("dials the relay server named in the relay response", async () => {
      vi.spyOn(conn as any, "secure").mockResolvedValue(true);
      vi.spyOn(conn as any, "msgLoop").mockResolvedValue(undefined);

      await conn.connectRelay({
        pk: new Uint8Array(32),
        uuid: "test-uuid",
        relay_server: "wss://rustdesk.example.com/ws/relay/1",
      } as any);

      expect(getRelayUri).toHaveBeenCalledWith("wss://rustdesk.example.com/ws/relay/1");
    });

    it("fails the session when hbbs names no WebSocket relay", async () => {
      vi.mocked(getRelayUri).mockImplementationOnce(() => {
        throw new Error("No WebSocket relay from the rendezvous server");
      });

      await expect(conn.connectRelay({ pk: new Uint8Array(32), uuid: "test-uuid" } as any))
        .rejects.toThrow("No WebSocket relay");
    });
  });

  describe("secure", () => {
    // Every failed check refuses the session: nothing is sent and the user is told why.
    const expectRefused = (result: unknown) => {
      expect(result).toBe(false);
      expect(mockWs.sendMessage).not.toHaveBeenCalled();
      expect(mockWs.setSecretKey).not.toHaveBeenCalled();
      expect(globals.msgbox).toHaveBeenCalledWith("error", "Insecure Connection", "conn-e2ee-refused-tip", false);
    };

    it("refuses when hbbs sends no peer key", async () => {
      expectRefused(await (conn as any).secure(undefined));
    });

    it("refuses when the peer key does not verify under the server key", async () => {
      vi.mocked(globals.verify).mockRejectedValueOnce(new Error("verify failed"));
      expectRefused(await (conn as any).secure(new Uint8Array(32)));
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
      expect(globals.pushEvent).toHaveBeenCalledWith("fingerprint", { fingerprint: "fp" });
      expect(mockWs.setSecretKey).toHaveBeenCalled();
    });

    it("refuses when the device sends no signed identity", async () => {
      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });
      vi.mocked(globals.verify).mockResolvedValueOnce(new Uint8Array(64));
      mockWs.next.mockResolvedValueOnce({});
      expectRefused(await (conn as any).secure(new Uint8Array(32)));
    });

    it("refuses when the device's signature does not verify under its key", async () => {
      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });
      vi.mocked(globals.verify).mockResolvedValueOnce(new Uint8Array(64)).mockRejectedValueOnce(new Error("bad sig"));
      mockWs.next.mockResolvedValueOnce({ signed_id: { id: new Uint8Array(32) } });
      expectRefused(await (conn as any).secure(new Uint8Array(32)));
    });

    it("refuses when the signed identity names another ID", async () => {
      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });
      vi.mocked(globals.verify).mockResolvedValueOnce(new Uint8Array(64));
      mockWs.next.mockResolvedValueOnce({ signed_id: { id: new Uint8Array(32) } });
      IdPk.decode.mockReturnValueOnce({ id: "wrong-id", pk: new Uint8Array(32) });
      expectRefused(await (conn as any).secure(new Uint8Array(32)));
    });

    it("refuses when the device's box key has the wrong length", async () => {
      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(32) });
      vi.mocked(globals.verify).mockResolvedValueOnce(new Uint8Array(64));
      mockWs.next.mockResolvedValueOnce({ signed_id: { id: new Uint8Array(32) } });
      IdPk.decode.mockReturnValueOnce({ id: "test-id", pk: new Uint8Array(16) });
      expectRefused(await (conn as any).secure(new Uint8Array(32)));
    });
  });
});
