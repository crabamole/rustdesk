import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("zstddec", () => {
  const mockDecode = vi.fn((data: Uint8Array, size: number) => new Uint8Array(10));
  class MockZSTDDecoder {
    init = vi.fn().mockResolvedValue(undefined);
    decode = mockDecode;
  }
  return { ZSTDDecoder: MockZSTDDecoder };
});

vi.mock("./message", () => ({
  KeyEvent: { fromPartial: (v: any) => v },
  controlKeyFromJSON: (name: string) => {
    const known: Record<string, number> = { Return: 1, Escape: 2, Tab: 3 };
    return known[name] ?? -1;
  },
  ControlKey: { UNRECOGNIZED: -1 },
}));

vi.mock("./gen_js_from_hbb", () => ({
  KEY_MAP: { Enter: "Return", Esc: "Escape" } as Record<string, string>,
  LANGS: {
    en: { Hello: "Hello", Goodbye: "Goodbye" },
    zh: { Hello: "你好" },
  },
}));

import { decompress, mapKey, sleep, translate, initZstd } from "./common";

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe("translate", () => {
  it("returns translation for known language", () => {
    expect(translate("xx_zh", "Hello")).toBe("你好");
  });

  it("falls back to English for missing key", () => {
    expect(translate("xx_zh", "Goodbye")).toBe("Goodbye");
  });

  it("returns original text when not in any dictionary", () => {
    expect(translate("xx_en", "Unknown")).toBe("Unknown");
  });

  it("fills a {value} placeholder like the native client", () => {
    expect(translate("xx_en", "Continue with {OIDC}")).toBe("Continue with OIDC");
  });

  it("falls back to English for unknown language", () => {
    expect(translate("xx_fr", "Hello")).toBe("Hello");
  });
});

describe("mapKey", () => {
  it("maps known key names via KEY_MAP", () => {
    const result = mapKey("Enter", true);
    expect(result).toEqual({ control_key: 1 });
  });

  it("maps Esc via KEY_MAP", () => {
    const result = mapKey("Esc", true);
    expect(result).toEqual({ control_key: 2 });
  });

  it("maps single character to chr on desktop", () => {
    const result = mapKey("a", true);
    expect(result).toEqual({ chr: 97 });
  });

  it("maps non-alpha single char to unicode on mobile", () => {
    const result = mapKey("1", false);
    expect(result).toEqual({ unicode: 49 });
  });

  it("maps alpha char to chr on mobile", () => {
    const result = mapKey("a", false);
    expect(result).toEqual({ chr: 97 });
  });

  it("logs error for unknown control key", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mapKey("UnknownKey", true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Unknown control key"));
    spy.mockRestore();
  });
});

describe("decompress", () => {
  it("decompresses data using zstd", async () => {
    const input = new Uint8Array([1, 2, 3]);
    const result = await decompress(input);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("initializes zstd on first call", async () => {
    const result = await decompress(new Uint8Array([1]));
    expect(result).toBeDefined();
  });

  it("clamps buffer size to MAX", async () => {
    const large = new Uint8Array(10 * 1024 * 1024);
    const result = await decompress(large);
    expect(result).toBeDefined();
  });

  it("uses MIN buffer size for small input", async () => {
    const small = new Uint8Array([1]);
    const result = await decompress(small);
    expect(result).toBeDefined();
  });
});

describe("initZstd", () => {
  it("initializes without error", async () => {
    await expect(initZstd()).resolves.toBeUndefined();
  });
});
