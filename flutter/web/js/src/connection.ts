import Websock from "./websock";
import * as message from "./message.js";
import * as rendezvous from "./rendezvous.js";
import { Codec, WebCodecsDecoder, codecOf, webCodecs } from "./webcodecs";
import * as sha256 from "fast-sha256";
import * as globals from "./globals";
import { decompress, getVersionNumber, mapKey, pkToFingerprint, sleep } from "./common";
import { HID_TO_LINUX_CODE, HID_TO_MACOS_CODE, HID_TO_MACOS_ISO_CODE, HID_TO_WIN_SCANCODE, LETTER_HIDS, NUMPAD_HIDS } from "./keymap";
import { loadConfig, getConfigKey, getDefaultUri, getHost, getApiServer, getRelayUri } from "./url";

// The device waits 5 s for a reply; give up before that.
const CLIPBOARD_READ_TIMEOUT_MS = 4000;
// The paste key waits for the read before an offer.
const LOCAL_READ_TIMEOUT_MS = 300;
// As native client::VIDEO_QUEUE_SIZE.
const VIDEO_QUEUE_SIZE = 120;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

async function readClipboard(format: message.ClipboardFormat): Promise<string> {
  const read =
    format == message.ClipboardFormat.Html
      ? navigator.clipboard.read().then(async (items) => {
          const item = items.find((i) => i.types.includes("text/html"));
          return item ? (await item.getType("text/html")).text() : "";
        })
      : navigator.clipboard.readText();
  return withTimeout(read, CLIPBOARD_READ_TIMEOUT_MS);
}

/** The browser clipboard's text, and whether it also holds HTML. */
async function readLocalClipboard(): Promise<{ text: string; html: boolean }> {
  if (!navigator.clipboard.read) return { text: await navigator.clipboard.readText(), html: false };
  const items = await navigator.clipboard.read();
  const plain = items.find((i) => i.types.includes("text/plain"));
  const text = plain ? await (await plain.getType("text/plain")).text() : "";
  return { text, html: items.some((i) => i.types.includes("text/html")) };
}

export { loadConfig, getConfigKey, getApiServer };

export function getConfigHost(): string {
  return getHost();
}

type MsgboxCallback = (type: string, title: string, text: string, retry?: boolean) => void;
//const cursorCanvas = document.createElement("canvas");

// The logged-in user's name, as the native client sends it (display_name, then name).
function viewerName(): string {
  try {
    const user = JSON.parse(localStorage.getItem("user_info") || "{}");
    return user.display_name?.trim() || user.name || "web";
  } catch (e) {
    return "web";
  }
}

export default class Connection {
  _msgs: any[];
  _ws: Websock | undefined;
  _interval: any;
  _id: string;
  _hash: message.Hash | undefined;
  _msgbox: MsgboxCallback;
  _peerInfo: message.PeerInfo | undefined;
  // As native LoginConfigHandler.session_id: one random ID for the session, kept across reconnects.
  _sessionId: number = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  _lastAuditNote = "";
  _screenshot?: Uint8Array;
  _selectedSid?: number;
  _closed = false;
  _cursorShapes: { [id: string]: { hotx: number; hoty: number; width: number; height: number; colors: Uint8Array } } = {};
  _auditGuid = "";
  _firstFrame: Boolean | undefined;
  _password: Uint8Array | undefined;
  _options: any;
  _videoTestSpeed: number[];
  _unsupportedCodecWarned: boolean | undefined;
  _webCodecs: Set<Codec> = new Set();
  _wc: WebCodecsDecoder | undefined;
  _clipboardAllowed: boolean;
  _lastClipboard: string | undefined;
  _offerSeq: number;
  _browserTipShown: boolean;
  _oldDeviceTipShown: boolean;
  //_cursors: { [name: number]: any };

  constructor() {
    this._msgbox = globals.msgbox;
    this._msgs = [];
    this._id = "";
    this._videoTestSpeed = [0, 0];
    this._clipboardAllowed = true;
    this._offerSeq = 0;
    this._browserTipShown = false;
    this._oldDeviceTipShown = false;
    //this._cursors = {};
  }

  async start(id: string) {
    this._closed = false;
    // As native, the peer's options are there when the session is created: Flutter reads them
    // right after session_start, before the first await below.
    this._id = id;
    if (!this._options) this._options = globals.getPeers()[id] || {};
    try {
      await this._start(id);
    } catch (e: any) {
      // Closed by the user, as native: the session ends without an error.
      if (this._closed) return;
      // Websock fails with a string or an event (closed, timed out, could not connect), never an
      // Error: a dropped connection, retried as the native client retries a relay connection.
      this.msgbox(
        "error",
        "Connection Error",
        e.type == "close" || e.type == "error" ? "Reset by the peer" : String(e),
        !(e instanceof Error)
      );
    }
  }

  async _start(id: string) {
    this._webCodecs = new Set(await webCodecs());
    if (!this._webCodecs.has("vp9")) {
      this.msgbox("error", "Error", "web_no_video_decoder_tip");
      return;
    }
    await globals.initSodium();
    if (!this._options) {
      this._options = globals.getPeers()[id] || {};
    }
    if (!this._password) {
      const p = this.getOption("password");
      if (p) {
        try {
          this._password = Uint8Array.from(JSON.parse("[" + p + "]"));
        } catch (e) {
          console.error(e);
        }
      }
    }
    this._interval = setInterval(() => {
      while (this._msgs.length) {
        this._ws?.sendMessage(this._msgs[0]);
        this._msgs.splice(0, 1);
      }
    }, 1);
    const uri = getDefaultUri();
    const ws = new Websock(uri, true);
    this._ws = ws;
    this._id = id;
    console.log(
      new Date() + ": Connecting to rendezvous server: " + uri + ", for " + id
    );
    // As native: a WebSocket connect that times out fails with tokio's text.
    await ws.open().catch((e) => {
      throw e == "Timeout" ? "deadline has elapsed" : e;
    });
    console.log(new Date() + ": Connected to rendezvous server");
    const conn_type = rendezvous.ConnType.DEFAULT_CONN;
    const nat_type = rendezvous.NatType.SYMMETRIC;
    const punch_hole_request = rendezvous.PunchHoleRequest.fromPartial({
      id,
      licence_key: getConfigKey() || undefined,
      conn_type,
      nat_type,
      token: localStorage.getItem("access_token") || undefined,
    });
    ws.sendRendezvous({ punch_hole_request });
    // As native client.rs: no answer to the punch hole request.
    const msg = (await ws.next().catch(() => {
      throw "Failed to connect via rendezvous server";
    })) as rendezvous.RendezvousMessage;
    ws.close();
    console.log(new Date() + ": Got relay response");
    const phr = msg.punch_hole_response;
    const rr = msg.relay_response;
    if (phr) {
      if (phr?.other_failure) {
        this.msgbox("error", "Connection Error", phr?.other_failure);
        return;
      }
      // As in the native client: an answer without the peer's address is a failure, including ID_NOT_EXIST (0).
      if (!phr.socket_addr?.length) {
        switch (phr.failure) {
          case rendezvous.PunchHoleResponse_Failure.ID_NOT_EXIST:
            this.msgbox("error", "Connection Error", "ID does not exist");
            break;
          case rendezvous.PunchHoleResponse_Failure.OFFLINE:
            this.msgbox("error", "Connection Error", "Remote desktop is offline");
            break;
          case rendezvous.PunchHoleResponse_Failure.LICENSE_MISMATCH:
            this.msgbox("error", "Connection Error", "Key mismatch");
            break;
          case rendezvous.PunchHoleResponse_Failure.LICENSE_OVERUSE:
            this.msgbox("error", "Connection Error", "Key overuse");
            break;
          default:
            this.msgbox("error", "Connection Error", "other punch hole failure");
            break;
        }
        return;
      }
    } else if (rr) {
      if (!rr.version) {
        this.msgbox("error", "Error", "Remote version is low, not support web");
        return;
      }
      await this.connectRelay(rr);
    }
  }

  async connectRelay(rr: rendezvous.RelayResponse) {
    const pk = rr.pk;
    const uri = getRelayUri(rr.relay_server);
    const uuid = rr.uuid;
    console.log(new Date() + ": Connecting to relay server: " + uri);
    const ws = new Websock(uri, false);
    // As native client.rs: the same text for any failure to reach the relay.
    await ws.open().catch(() => {
      throw "Failed to connect via relay server: Failed to connect to relay server";
    });
    console.log(new Date() + ": Connected to relay server");
    this._ws = ws;
    const request_relay = rendezvous.RequestRelay.fromPartial({
      licence_key: getConfigKey() || undefined,
      uuid,
    });
    ws.sendRendezvous({ request_relay });
    if (!(await this.secure(pk))) {
      this.close();
      return;
    }
    globals.pushEvent("connection_ready", { secure: true, direct: false });
    await this.msgLoop();
  }

  // Upstream continues unencrypted when a check fails; we never run a session without end-to-end
  // encryption (docs/design-e2ee-required.md).
  refuseInsecure(): false {
    this.msgbox("error", "Insecure Connection", "conn-e2ee-refused-tip");
    return false;
  }

  async secure(pk: Uint8Array | undefined) {
    if (pk) {
      const RS_PK = "OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw=";
      try {
        pk = await globals.verify(pk, getConfigKey() || RS_PK);
        if (pk) {
          const idpk = rendezvous.IdPk.decode(pk);
          if (idpk.id == this._id) {
            pk = idpk.pk;
          }
        }
        if (pk?.length != 32) {
          pk = undefined;
        }
      } catch (e) {
        console.error(e);
        pk = undefined;
      }
      if (!pk)
        console.error(
          "Handshake failed: invalid public key from rendezvous server"
        );
    }
    if (!pk) {
      return this.refuseInsecure();
    }
    const msg = (await this._ws?.next()) as message.Message;
    let signedId: any = msg?.signed_id;
    if (!signedId) {
      console.error("Handshake failed: invalid message type");
      return this.refuseInsecure();
    }
    try {
      signedId = await globals.verify(signedId.id, Uint8Array.from(pk!));
    } catch (e) {
      console.error(e);
      console.error("Handshake failed: pk mismatch");
      return this.refuseInsecure();
    }
    const idpk = rendezvous.IdPk.decode(signedId);
    const id = idpk.id;
    const theirPk = idpk.pk;
    if (id != this._id!) {
      console.error("Handshake failed: sign failure");
      return this.refuseInsecure();
    }
    if (theirPk.length != 32) {
      console.error(
        "Handshake failed: invalid public box key length from peer"
      );
      return this.refuseInsecure();
    }
    const [mySk, asymmetric_value] = globals.genBoxKeyPair();
    const secret_key = globals.genSecretKey();
    const symmetric_value = globals.seal(secret_key, theirPk, mySk);
    const public_key = message.PublicKey.fromPartial({
      asymmetric_value,
      symmetric_value,
    });
    this._ws?.sendMessage({ public_key });
    this._ws?.setSecretKey(secret_key);
    globals.pushEvent("fingerprint", { fingerprint: pkToFingerprint(pk) });
    console.log("secured");
    return true;
  }

  async msgLoop() {
    while (true) {
      const msg = (await this._ws?.next()) as message.Message;
      if (msg?.hash) {
        this._hash = msg?.hash;
        if (!this._password)
          this.msgbox("input-password", "Password Required", "");
        this.login();
      } else if (msg?.test_delay) {
        const test_delay = msg?.test_delay;
        console.log(test_delay);
        if (!test_delay.from_client) {
          this._ws?.sendMessage({ test_delay });
        }
      } else if (msg?.login_response) {
        const r = msg?.login_response;
        if (r.error) {
          if (r.error == "Wrong Password") {
            this._password = undefined;
            this.msgbox(
              "re-input-password",
              r.error,
              "Do you want to enter again?"
            );
          } else if (r.error == "2FA Required" || r.error == "Wrong 2FA Code") {
            this.msgbox("input-2fa", r.error, "");
          } else {
            this.msgbox("error", "Login Error", r.error);
          }
        } else if (r.peer_info) {
          this.handlePeerInfo(r.peer_info);
        }
      } else if (msg?.video_frame) {
        this.handleVideoFrame(msg.video_frame!);
      } else if (msg?.clipboard) {
        const cb = msg?.clipboard;
        if (cb.compress) {
          const c = await decompress(cb.content);
          if (!c) continue;
          cb.content = c;
        }
        try {
          const text = new TextDecoder().decode(cb.content);
          if (globals.copyToClipboard(text)) this._lastClipboard = text;
        } catch (e) {
          console.error(e);
        }
        // globals.pushEvent("clipboard", cb);
      } else if (msg?.clipboard_request) {
        this.handleClipboardRequest(msg.clipboard_request).catch(console.error);
      } else if (msg?.cursor_data) {
        const cd = msg?.cursor_data;
        const c = await decompress(cd.colors);
        if (!c) continue;
        // As native: shapes are kept by ID, later cursor_id messages refer to them.
        this._cursorShapes[cd.id] = { hotx: cd.hotx, hoty: cd.hoty, width: cd.width, height: cd.height, colors: c };
        (window as any).onCursorData?.(String(cd.id), cd.hotx, cd.hoty, cd.width, cd.height, c);
      } else if (msg?.cursor_id) {
        globals.pushEvent("cursor_id", { id: msg?.cursor_id });
      } else if (msg?.cursor_position) {
        globals.pushEvent("cursor_position", msg?.cursor_position);
      } else if (msg?.peer_info) {
        // As native: the device's displays changed during the session.
        if (this._peerInfo) this._peerInfo.displays = msg.peer_info.displays;
        globals.pushEvent("sync_peer_info", { displays: msg.peer_info.displays });
        globals.pushEvent("sync_platform_additions", { platform_additions: msg.peer_info.platform_additions });
      } else if (msg?.screenshot_response) {
        const r = msg.screenshot_response;
        this._screenshot = r.msg ? undefined : r.data;
        globals.pushEvent("screenshot", { msg: r.msg });
      } else if (msg?.misc) {
        if (!this.handleMisc(msg?.misc)) break;
      } else if (msg?.audio_frame) {
        globals.playAudio(msg?.audio_frame.data);
      }
    }
  }

  msgbox(type_: string, title: string, text: string, retry = false) {
    this._msgbox?.(type_, title, text, retry);
  }

  close() {
    // As native: tell the device first, so it ends the connection at once.
    if (!this._closed) {
      this._ws?.sendMessage({ misc: message.Misc.fromPartial({ close_reason: "" }) });
    }
    this._closed = true;
    this._msgs = [];
    clearInterval(this._interval);
    this._ws?.close();
    this.closeWebCodecs();
  }

  refresh() {
    const misc = message.Misc.fromPartial({ refresh_video: true });
    this._ws?.sendMessage({ misc });
  }

  setMsgbox(callback: MsgboxCallback) {
    this._msgbox = callback;
  }

  login(password: string | undefined = undefined) {
    if (password) {
      const salt = this._hash?.salt;
      let p = hash([password, salt!]);
      this._password = p;
      const challenge = this._hash?.challenge;
      p = hash([p, challenge!]);
      this.msgbox("connecting", "Connecting...", "Logging in...");
      this._sendLoginMessage(p);
    } else {
      let p = this._password;
      if (p) {
        const challenge = this._hash?.challenge;
        p = hash([p, challenge!]);
      }
      this._sendLoginMessage(p);
    }
  }

  async reconnect() {
    this.close();
    await this.start(this._id);
  }

  _sendLoginMessage(password: Uint8Array | undefined = undefined) {
    const login_request = message.LoginRequest.fromPartial({
      username: this._id!,
      my_id: "web", // to-do
      my_name: viewerName(),
      password,
      session_id: this._sessionId,
      option: this.getOptionMessage(),
    });
    this._ws?.sendMessage({ login_request });
  }

  getOptionMessage(): message.OptionMessage {
    const msg = message.OptionMessage.fromPartial({});
    const q = this.getImageQualityEnum(this.getImageQuality(), true);
    const yes = message.OptionMessage_BoolOption.Yes;
    if (q != undefined) {
      msg.image_quality = q;
    } else if (this.getImageQuality() == "custom") {
      msg.custom_image_quality = this.customImageQuality() << 8;
      const fps = parseInt(this.getOption("custom-fps"), 10);
      if (fps) msg.custom_fps = fps;
    }
    // As native get_option_message: view-only overrides the toggles it covers.
    const o = this._options;
    const viewOnly = !!o["view-only"];
    const set = (field: string, on: boolean) => {
      if (!on) return;
      (msg as any)[field] = yes;
    };
    set("disable_keyboard", viewOnly);
    set("show_remote_cursor", viewOnly || !!o["show-remote-cursor"]);
    set("show_my_cursor", viewOnly && !!o["show-my-cursor"]);
    set("follow_remote_cursor", !!o["follow-remote-cursor"]);
    set("follow_remote_window", !!o["follow-remote-window"]);
    set("lock_after_session_end", !viewOnly && !!o["lock-after-session-end"]);
    set("enable_file_transfer", !viewOnly && !!o["enable-file-copy-paste"]);
    if (this._options["privacy-mode"]) {
      msg.privacy_mode = yes;
    }
    if (this._options["disable-audio"]) {
      msg.disable_audio = yes;
    }
    set("disable_clipboard", viewOnly || !!o["disable-clipboard"]);
    msg.supported_decoding = this.supportedDecoding();
    return msg;
  }

  /** As native: the device picks the codec (Auto) among those every viewer decodes. _start checks VP9. */
  supportedDecoding(): message.SupportedDecoding {
    return message.SupportedDecoding.fromPartial({
      ability_vp9: 1,
      ability_h264: this._webCodecs.has("h264") ? 1 : 0,
      ability_h265: this._webCodecs.has("h265") ? 1 : 0,
      prefer: message.SupportedDecoding_PreferCodec.Auto,
    });
  }

  logDecodeTime(ms: number) {
    this._videoTestSpeed[1] += ms;
    this._videoTestSpeed[0] += 1;
    if (this._videoTestSpeed[0] >= 30) {
      console.log("video decoder: " + Math.round(this._videoTestSpeed[1] / this._videoTestSpeed[0]));
      this._videoTestSpeed = [0, 0];
    }
  }

  closeWebCodecs() {
    this._wc?.close();
    this._wc = undefined;
  }

  /** Decodes with WebCodecs; false when the browser cannot decode the frame's codec. */
  decodeWebCodecs(vf: message.VideoFrame): boolean {
    const c = codecOf(vf);
    if (!c || !this._webCodecs.has(c[0])) return false;
    const [codec, frames] = c;
    if (this._wc?.codec != codec) {
      this.closeWebCodecs();
      const wc = new WebCodecsDecoder(codec, (f) => {
        if (this._wc !== wc) return f.close();
        this.logDecodeTime(performance.now() - f.timestamp);
        globals.drawVideoFrame(f);
      }, (e) => {
        if (this._wc !== wc) return;
        // Stop using this codec; the device switches to VP9 when told. VP9 has no fallback.
        console.warn("video: WebCodecs " + codec + " failed, not using it again in this session: " + e.message);
        this._webCodecs.delete(codec);
        this.closeWebCodecs();
        if (codec == "vp9") {
          this.msgbox("error", "Error", "web_no_video_decoder_tip");
          return;
        }
        this.sendOption({ supported_decoding: this.supportedDecoding() });
        this.refresh();
      });
      this._wc = wc;
      console.info("video: decoding " + codec + " with WebCodecs");
    }
    if (this._wc.decode(frames.frames)) {
      // As native (VIDEO_QUEUE_SIZE): a viewer that falls behind drops the backlog and
      // starts again at a new key frame.
      if (this._wc.queued > VIDEO_QUEUE_SIZE) {
        console.warn("video: decoder fell behind, dropping " + this._wc.queued + " frames");
        this.closeWebCodecs();
      }
    } else if (!this._wc.askedKey) {
      // A new decoder starts at a key frame; a still screen sends none unless asked.
      this._wc.askedKey = true;
      this.refresh();
    }
    return true;
  }

  handleVideoFrame(vf: message.VideoFrame) {
    if (!this._firstFrame) {
      this.msgbox("", "", "");
      this._firstFrame = true;
    }
    if (this.decodeWebCodecs(vf)) return;
    const codec = codecOf(vf)?.[0] ?? (vf.av1s ? "av1" : vf.vp8s ? "vp8" : "unknown");
    if (!this._unsupportedCodecWarned) {
      console.warn("video: received a codec this browser does not decode: " + codec);
      this._unsupportedCodecWarned = true;
    }
  }

  handlePeerInfo(pi: message.PeerInfo) {
    this._peerInfo = pi;
    if (pi.displays.length == 0) {
      this.msgbox("error", "Remote Error", "No Display");
      return;
    }
    this.msgbox("success", "Successful", "Connected, waiting for image...");
    globals.pushEvent("peer_info", pi);
    this.handleWindowsSessions(pi.windows_sessions);
    const p = this.shouldAutoLogin();
    if (p) this.inputOsPassword(p);
    const username = this.getOption("info")?.username;
    if (username && !pi.username) pi.username = username;
    this.setOption("info", pi);
    if (this.getRemember()) {
      if (this._password?.length) {
        const p = this._password.toString();
        if (p != this.getOption("password")) {
          this.setOption("password", p);
          console.log("remember password of " + this._id);
        }
      }
    } else {
      this.setOption("password", undefined);
    }
    if (!this.lazyTextClipboard() && this._clipboardAllowed && !this._options["disable-clipboard"] && !this._oldDeviceTipShown) {
      this._oldDeviceTipShown = true;
      this.msgbox("custom-nook-nocancel-hasclose", "Clipboard", "clipboard_on_request_old_device_tip");
    }
  }

  shouldAutoLogin(): string {
    const l = this.getOption("lock-after-session-end");
    const a = !!this.getOption("auto-login");
    const p = this.getOption("os-password");
    if (p && l && a) {
      return p;
    }
    return "";
  }

  handleMisc(misc: message.Misc) {
    if (misc.audio_format) {
      globals.initAudio(
        misc.audio_format.channels,
        misc.audio_format.sample_rate
      );
    } else if (misc.chat_message) {
      globals.pushEvent("chat_client_mode", { text: misc.chat_message.text });
    } else if (misc.permission_info) {
      const p = misc.permission_info;
      console.info("Change permission " + p.permission + " -> " + p.enabled);
      let name;
      switch (p.permission) {
        case message.PermissionInfo_Permission.Keyboard:
          name = "keyboard";
          break;
        case message.PermissionInfo_Permission.Clipboard:
          name = "clipboard";
          this._clipboardAllowed = p.enabled;
          break;
        case message.PermissionInfo_Permission.Audio:
          name = "audio";
          break;
        case message.PermissionInfo_Permission.Restart:
          name = "restart";
          break;
        case message.PermissionInfo_Permission.BlockInput:
          name = "block_input";
          break;
        case message.PermissionInfo_Permission.PrivacyMode:
          name = "privacy_mode";
          break;
        default:
          // Not shown on web; returning falsy would end the message loop.
          return true;
      }
      globals.pushEvent("permission", { [name]: p.enabled });
    } else if (misc.back_notification) {
      return this.handleBackNotification(misc.back_notification);
    } else if (misc.follow_current_display !== undefined) {
      globals.pushEvent("follow_current_display", { display_idx: misc.follow_current_display });
    } else if (misc.switch_display) {
      this.closeWebCodecs();
      globals.pushEvent("switch_display", misc.switch_display);
    } else if (misc.close_reason) {
      this.msgbox("error", "Connection Error", misc.close_reason);
      this.close();
      return false;
    }
    return true;
  }

  // As native handle_back_notification. Returns false to end the session.
  handleBackNotification(n: message.BackNotification): boolean {
    const B = message.BackNotification_BlockInputState;
    const P = message.BackNotification_PrivacyModeState;
    const blockInput = (on: boolean) => globals.pushEvent("update_block_input_state", { input_state: on ? "on" : "off" });
    const privacy = (on: boolean) => {
      this.setOption("privacy-mode", on || undefined);
      // As native, devices older than 1.2.4 send no key.
      if (on) this.setOption("privacy-mode-impl-key", n.impl_key || "privacy_mode_impl_mag");
      globals.pushEvent("update_privacy_mode", {});
    };
    const error = (title: string, text: string) => this.msgbox("custom-error", title, text);
    switch (n.block_input_state) {
      case B.BlkOnSucceeded: blockInput(true); break;
      case B.BlkOnFailed: error("Block user input", n.details || "Failed"); blockInput(false); break;
      case B.BlkOffSucceeded: blockInput(false); break;
      case B.BlkOffFailed: error("Unblock user input", n.details || "Failed"); break;
    }
    switch (n.privacy_mode_state) {
      case P.PrvOnByOther:
        this.msgbox("error", "Connecting...", "Someone turns on privacy mode, exit");
        return false;
      case P.PrvNotSupported: error("Privacy mode", "Unsupported"); privacy(false); break;
      case P.PrvOnSucceeded: this.msgbox("custom-nocancel", "Privacy mode", "Enter privacy mode"); privacy(true); break;
      case P.PrvOnFailedDenied: error("Privacy mode", "Peer denied"); privacy(false); break;
      case P.PrvOnFailedPlugin:
      case P.PrvOnFailed: error("Privacy mode", n.details || "Failed"); privacy(false); break;
      case P.PrvOffSucceeded: this.msgbox("custom-nocancel", "Privacy mode", "Exit privacy mode"); privacy(false); break;
      case P.PrvOffByPeer: error("Privacy mode", "Peer exit"); privacy(false); break;
      case P.PrvOffFailed: error("Privacy mode", n.details || "Failed to turn off"); break;
      case P.PrvOffUnknown: error("Privacy mode", "Turned off"); privacy(false); break;
    }
    return true;
  }

  // As native handle_peer_info: with several Windows user sessions, the user picks one once; a
  // reconnect keeps the pick.
  handleWindowsSessions(ws: message.WindowsSessions | undefined) {
    if (!ws?.sessions.length) return;
    if (this._selectedSid === ws.current_sid) {
      this.sendSelectedSid(ws.current_sid);
    } else {
      const sessions = ws.sessions.map((s) => ({ sid: String(s.sid), name: s.name }));
      globals.pushEvent("set_multiple_windows_session", { windows_sessions: JSON.stringify(sessions) });
    }
  }

  sendSelectedSid(sid: number) {
    this._selectedSid = sid;
    this._ws?.sendMessage({ misc: message.Misc.fromPartial({ selected_sid: sid }) });
  }

  toggleVirtualDisplay(display: number, on: boolean) {
    const toggle_virtual_display = message.ToggleVirtualDisplay.fromPartial({ display, on });
    this._ws?.sendMessage({ misc: message.Misc.fromPartial({ toggle_virtual_display }) });
  }

  togglePrivacyMode(impl_key: string, on: boolean) {
    const toggle_privacy_mode = message.TogglePrivacyMode.fromPartial({ impl_key, on });
    this._ws?.sendMessage({ misc: message.Misc.fromPartial({ toggle_privacy_mode }) });
  }

  getRemember(): Boolean {
    return this._options["remember"] || false;
  }

  setRemember(v: Boolean) {
    this.setOption("remember", v);
  }

  getOption(name: string): any {
    return this._options[name];
  }

  setOption(name: string, value: any) {
    if (value == undefined) {
      delete this._options[name];
    } else {
      this._options[name] = value;
    }
    this._options["tm"] = new Date().getTime();
    const peers = globals.getPeers();
    peers[this._id] = this._options;
    localStorage.setItem("peers", JSON.stringify(peers));
  }

  inputKey(
    name: string,
    down: boolean,
    press: boolean,
    alt: Boolean,
    ctrl: Boolean,
    shift: Boolean,
    command: Boolean
  ) {
    const key_event = mapKey(name, globals.isDesktop());
    if (!key_event) return;
    if (alt && (name == "VK_MENU" || name == "RAlt")) {
      alt = false;
    }
    if (ctrl && (name == "VK_CONTROL" || name == "RControl")) {
      ctrl = false;
    }
    if (shift && (name == "VK_SHIFT" || name == "RShift")) {
      shift = false;
    }
    if (command && (name == "Meta" || name == "RWin")) {
      command = false;
    }
    key_event.down = down;
    key_event.press = press;
    key_event.modifiers = this.getMod(alt, ctrl, shift, command);
    this._ws?.sendMessage({ key_event });
  }

  ctrlAltDel() {
    const key_event = message.KeyEvent.fromPartial({ down: true });
    if (this._peerInfo?.platform == "Windows") {
      key_event.control_key = message.ControlKey.CtrlAltDel;
    } else {
      key_event.control_key = message.ControlKey.Delete;
      key_event.modifiers = this.getMod(true, true, false, false);
    }
    this._ws?.sendMessage({ key_event });
  }

  /** Whether the device takes clipboard text on request (`lazy_text_clipboard`). */
  lazyTextClipboard(): boolean {
    try {
      return JSON.parse(this._peerInfo?.platform_additions || "{}").lazy_text_clipboard === true;
    } catch {
      return false;
    }
  }

  showBrowserTip() {
    if (this._browserTipShown) return;
    this._browserTipShown = true;
    this.msgbox("custom-nook-nocancel-hasclose", "Clipboard", "clipboard_on_request_browser_tip");
  }

  /** Offers the browser clipboard's formats when its text is new; the content goes only on request. */
  async offerClipboard(interactive = false) {
    if (!this.lazyTextClipboard()) return;
    if (!this._clipboardAllowed || this._options["disable-clipboard"]) return;
    let local;
    try {
      local = await withTimeout(readLocalClipboard(), LOCAL_READ_TIMEOUT_MS);
    } catch (e) {
      console.debug("Reading the clipboard failed:", e);
      if (interactive) this.showBrowserTip();
      return;
    }
    if (!local.text || local.text == this._lastClipboard) return;
    this._lastClipboard = local.text;
    this._offerSeq += 1;
    const formats = [message.ClipboardFormat.Text];
    if (local.html) formats.push(message.ClipboardFormat.Html);
    const clipboard_offer = message.ClipboardOffer.fromPartial({ seq: this._offerSeq, formats });
    this._ws?.sendMessage({ clipboard_offer });
  }

  async handleClipboardRequest(req: message.ClipboardRequest) {
    let text = "";
    if (req.seq == this._offerSeq && this._clipboardAllowed && !this._options["disable-clipboard"]) {
      try {
        text = await readClipboard(req.format);
      } catch (e) {
        console.debug("Reading the clipboard failed:", e);
        this.showBrowserTip();
      }
    }
    const clipboard = message.Clipboard.fromPartial({
      format: req.format,
      content: new TextEncoder().encode(text),
    });
    this._ws?.sendMessage({ clipboard_reply: message.ClipboardReply.fromPartial({ seq: req.seq, clipboard }) });
  }

  inputString(seq: string) {
    const key_event = message.KeyEvent.fromPartial({ seq });
    this._ws?.sendMessage({ key_event });
  }

  switchDisplay(display: number) {
    const switch_display = message.SwitchDisplay.fromPartial({ display });
    const misc = message.Misc.fromPartial({ switch_display });
    this._ws?.sendMessage({ misc });
    // As native without texture render: capture only the chosen display.
    const capture_displays = message.CaptureDisplays.fromPartial({ set: [display] });
    this._ws?.sendMessage({ misc: message.Misc.fromPartial({ capture_displays }) });
  }

  async inputOsPassword(seq: string) {
    this.inputMouse();
    await sleep(50);
    this.inputMouse(0, 3, 3);
    await sleep(50);
    this.inputMouse(1 | (1 << 3));
    this.inputMouse(2 | (1 << 3));
    await sleep(1200);
    const key_event = message.KeyEvent.fromPartial({ press: true, seq });
    this._ws?.sendMessage({ key_event });
  }

  lockScreen() {
    const key_event = message.KeyEvent.fromPartial({
      down: true,
      control_key: message.ControlKey.LockScreen,
    });
    this._ws?.sendMessage({ key_event });
  }

  getMod(alt: Boolean, ctrl: Boolean, shift: Boolean, command: Boolean) {
    const mod: message.ControlKey[] = [];
    if (alt) mod.push(message.ControlKey.Alt);
    if (ctrl) mod.push(message.ControlKey.Control);
    if (shift) mod.push(message.ControlKey.Shift);
    if (command) mod.push(message.ControlKey.Meta);
    return mod;
  }

  inputMouse(
    mask: number = 0,
    x: number = 0,
    y: number = 0,
    alt: Boolean = false,
    ctrl: Boolean = false,
    shift: Boolean = false,
    command: Boolean = false
  ) {
    const mouse_event = message.MouseEvent.fromPartial({
      mask,
      x,
      y,
      modifiers: this.getMod(alt, ctrl, shift, command),
    });
    this._ws?.sendMessage({ mouse_event });
  }

  // As native toggle_option (src/client.rs): these reach the device; any other name is stored on
  // the session only.
  toggleOption(name: string) {
    const option = message.OptionMessage.fromPartial({});
    const yesNo = (b: boolean) =>
      b ? message.OptionMessage_BoolOption.Yes : message.OptionMessage_BoolOption.No;
    const flip = () => {
      const v = !this._options[name];
      this.setOption(name, v);
      return v;
    };
    switch (name) {
      case "show-remote-cursor":
        option.show_remote_cursor = yesNo(flip());
        break;
      case "follow-remote-cursor":
        option.follow_remote_cursor = yesNo(flip());
        break;
      case "follow-remote-window":
        option.follow_remote_window = yesNo(flip());
        break;
      case "disable-audio":
        option.disable_audio = yesNo(flip());
        break;
      case "disable-clipboard":
        option.disable_clipboard = yesNo(flip());
        break;
      case "lock-after-session-end":
        option.lock_after_session_end = yesNo(flip());
        break;
      case "privacy-mode":
        option.privacy_mode = yesNo(!this._options["privacy-mode"]);
        break;
      case "enable-file-copy-paste":
        option.enable_file_transfer = yesNo(flip());
        break;
      case "block-input":
        option.block_input = message.OptionMessage_BoolOption.Yes;
        break;
      case "unblock-input":
        option.block_input = message.OptionMessage_BoolOption.No;
        break;
      case "show-my-cursor":
        option.show_my_cursor = yesNo(flip());
        break;
      case "view-only": {
        const on = flip();
        option.disable_keyboard = yesNo(on);
        option.disable_clipboard = yesNo(on || !!this._options["disable-clipboard"]);
        option.show_remote_cursor = yesNo(on || !!this._options["show-remote-cursor"]);
        option.enable_file_transfer = yesNo(!on && !!this._options["enable-file-copy-paste"]);
        option.lock_after_session_end = yesNo(!on && !!this._options["lock-after-session-end"]);
        if (!on && this._options["show-my-cursor"]) {
          this.setOption("show-my-cursor", false);
          option.show_my_cursor = message.OptionMessage_BoolOption.No;
        }
        break;
      }
      default:
        flip();
        return;
    }
    const misc = message.Misc.fromPartial({ option });
    this._ws?.sendMessage({ misc });
  }

  getImageQuality() {
    // As native, a session without its own value uses the user's default (Settings).
    return this.getOption("image-quality") || localStorage.getItem("image_quality") || undefined;
  }

  getImageQualityEnum(
    value: string,
    ignoreDefault: Boolean
  ): message.ImageQuality | undefined {
    switch (value) {
      case "low":
        return message.ImageQuality.Low;
      case "best":
        return message.ImageQuality.Best;
      case "balanced":
        return ignoreDefault ? undefined : message.ImageQuality.Balanced;
      default:
        return undefined;
    }
  }

  setImageQuality(value: string) {
    this.setOption("image-quality", value);
    if (value == "custom") {
      this.sendOption({ custom_image_quality: this.customImageQuality() << 8 });
      return;
    }
    const image_quality = this.getImageQualityEnum(value, false);
    if (image_quality == undefined) return;
    this.sendOption({ image_quality });
  }

  // As native: the custom quality (percent, 50 when unset) goes out shifted left by 8 bits.
  customImageQuality(): number {
    return parseInt(this.getOption("custom_image_quality"), 10) || 50;
  }

  setCustomImageQuality(quality: number) {
    this.setOption("custom_image_quality", String(quality));
    this.sendOption({ custom_image_quality: quality << 8 });
  }

  setCustomFps(fps: number) {
    this.setOption("custom-fps", String(fps));
    this.sendOption({ custom_fps: fps });
  }

  sendOption(fields: Partial<message.OptionMessage>) {
    const option = message.OptionMessage.fromPartial(fields);
    this._ws?.sendMessage({ misc: message.Misc.fromPartial({ option }) });
  }

  sendChat(text: string) {
    const chat_message = message.ChatMessage.fromPartial({ text });
    this._ws?.sendMessage({ misc: message.Misc.fromPartial({ chat_message }) });
  }

  restartRemoteDevice() {
    this._ws?.sendMessage({ misc: message.Misc.fromPartial({ restart_remote_device: true }) });
  }

  // As native: older peers take one resolution, newer ones a resolution per display.
  changeResolution(display: number, width: number, height: number) {
    const resolution = message.Resolution.fromPartial({ width, height });
    const misc = getVersionNumber(this._peerInfo?.version || "") >= getVersionNumber("1.2.4")
      ? message.Misc.fromPartial({ change_display_resolution: message.DisplayResolution.fromPartial({ display, resolution }) })
      : message.Misc.fromPartial({ change_resolution: resolution });
    this._ws?.sendMessage({ misc });
  }

  isScreenshotSupported(): boolean {
    return getVersionNumber(this._peerInfo?.version || "") >= getVersionNumber("1.4.0");
  }

  // As native: the device takes the screenshot and replies with a PNG.
  takeScreenshot(display: number) {
    this._ws?.sendMessage({ screenshot_request: message.ScreenshotRequest.fromPartial({ display }) });
  }

  // As native handle_screenshot: "0:<name>" saves (here a browser download), "1" copies, "2" discards.
  handleScreenshot(action: string): string {
    const data = this._screenshot;
    if (!data) return "No cached screenshot";
    this._screenshot = undefined;
    const blob = new Blob([data], { type: "image/png" });
    if (action.startsWith("0:")) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = action.substring(2);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } else if (action == "1") {
      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).catch(console.error);
    }
    return "";
  }

  // As native is_keyboard_mode_supported; the web implements legacy and map mode.
  isKeyboardModeSupported(mode: string): boolean {
    if (mode == "legacy") return true;
    if (mode != "map") return false;
    const pi = this._peerInfo;
    return !!pi && !/android/i.test(pi.platform) && getVersionNumber(pi.version) >= getVersionNumber("1.2.0");
  }

  // Map mode, as native for a USB HID code (rdev::usb_hid_code_to_*, keyboard.rs): the key's code on
  // the peer's platform, and Caps Lock / Num Lock for letter and keypad keys.
  inputMapKey(usbHid: number, lockModes: number, down: boolean) {
    const platform = this._peerInfo?.platform || "";
    const table = /windows/i.test(platform) ? HID_TO_WIN_SCANCODE
      : /mac/i.test(platform) ? (localStorage.getItem("kb_layout_type") == "ISO" ? HID_TO_MACOS_ISO_CODE : HID_TO_MACOS_CODE)
      : /linux/i.test(platform) ? HID_TO_LINUX_CODE
      : undefined;
    const chr = table ? table[usbHid] : usbHid;
    if (chr === undefined) return;
    const modifiers: message.ControlKey[] = [];
    if (LETTER_HIDS.has(usbHid) && lockModes & (1 << 1)) modifiers.push(message.ControlKey.CapsLock);
    if (NUMPAD_HIDS.has(usbHid) && lockModes & (1 << 2)) modifiers.push(message.ControlKey.NumLock);
    const key_event = message.KeyEvent.fromPartial({ mode: message.KeyboardMode.Map, chr, down, modifiers });
    this._ws?.sendMessage({ key_event });
  }

  // The browser has no hardware ID, so "trust this device" is not offered (native sends one).
  send2fa(code: string) {
    this._ws?.sendMessage({ auth_2fa: message.Auth2FA.fromPartial({ code }) });
  }

  // As native send_note: the note for this session goes to the api-server's audit, by session ID.
  sendNote(note: string) {
    this._lastAuditNote = note;
    if (!localStorage.getItem("access_token")) return;
    fetch(`${getApiServer()}/api/audit/conn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: this._id, session_id: this._sessionId, note }),
    }).catch((e) => console.error("send note:", e));
  }
}


function hash(datas: (string | Uint8Array)[]): Uint8Array {
  const hasher = new sha256.Hash();
  datas.forEach((data) => {
    if (typeof data == "string") {
      data = new TextEncoder().encode(data);
    }
    return hasher.update(data);
  });
  return hasher.digest();
}
