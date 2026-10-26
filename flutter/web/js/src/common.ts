import * as zstd from "zstddec";
import { KeyEvent, controlKeyFromJSON, ControlKey } from "./message";
import { KEY_MAP, LANGS } from "./gen_js_from_hbb";

let decompressor: zstd.ZSTDDecoder;

export async function initZstd() {
  const tmp = new zstd.ZSTDDecoder();
  await tmp.init();
  console.log("zstd ready");
  decompressor = tmp;
}

export async function decompress(compressedArray: Uint8Array) {
  const MAX = 1024 * 1024 * 64;
  const MIN = 1024 * 1024;
  let n = 30 * compressedArray.length;
  if (n > MAX) {
    n = MAX;
  }
  if (n < MIN) {
    n = MIN;
  }
  try {
    if (!decompressor) {
      await initZstd();
    }
    return decompressor.decode(compressedArray, n);
  } catch (e) {
    console.error("decompress failed: " + e);
    return undefined;
  }
}

const LANG = getLang();

export function translate(locale: string, text: string): string {
  const lang = LANG || locale.substring(locale.length - 2).toLowerCase();
  let en = LANGS.en as any;
  let dict = (LANGS as any)[lang];
  if (!dict) dict = en;
  // Same convention as the native client: "{value}" in the text, "{}" in the dictionaries.
  const m = /\{(.*?)\}/.exec(text);
  const key = m ? text.replace(m[0], "{}") : text;
  let res = dict[key];
  if (!res && lang != "en") res = en[key];
  res = res || key;
  return m ? res.replace("{}", m[1]) : res;
}

const zCode = "z".charCodeAt(0);
const aCode = "a".charCodeAt(0);

// As hbb_common::get_version_number: 1.2.3 -> 1002030, 1.2.3-4 -> 1002034.
export function getVersionNumber(v: string): number {
  const [main, patch] = (v || "").split("-");
  let n = 0;
  let last = 0;
  for (const x of (main || "").split(".")) {
    last = parseInt(x, 10) || 0;
    n = n * 1000 + last;
  }
  n += last * 9;
  return n + (parseInt(patch, 10) || 0);
}

export function mapKey(name: string, isDesktop: Boolean) {
  const tmp = KEY_MAP[name] || name;
  if (tmp.length == 1) {
    const chr = tmp.charCodeAt(0);
    if (!isDesktop && (chr > zCode || chr < aCode))
      return KeyEvent.fromPartial({ unicode: chr });
    else return KeyEvent.fromPartial({ chr });
  }
  const control_key = controlKeyFromJSON(tmp);
  if (control_key == ControlKey.UNRECOGNIZED) {
    console.error("Unknown control key " + tmp);
  }
  return KeyEvent.fromPartial({ control_key });
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function getLang(): string {
  try {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);
    return urlParams.get("lang") || "";
  } catch (e) {
    return "";
  }
}

// As native pk_to_fingerprint: the device key in hex, a space every 4 digits.
export function pkToFingerprint(pk: Uint8Array): string {
  const hex = Array.from(pk, (b) => b.toString(16).padStart(2, "0")).join("");
  return hex.replace(/(.{4})(?=.)/g, "$1 ");
}
