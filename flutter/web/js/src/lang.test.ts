import { describe, it, expect } from "vitest";
import { LANGS } from "./gen_js_from_hbb";

// Translations come from src/lang/*.rs; Rust escapes must become the characters they stand for.
describe("LANGS", () => {
  it("turns \\n in a translation into a line break", () => {
    const tip = (LANGS as any).en.empty_recent_tip as string;
    expect(tip).toBe("Oops, no recent sessions!\nTime to plan a new one.");
  });

  it("turns \\\" into a plain quote", () => {
    const all = Object.values(LANGS as any).flatMap((l: any) => Object.values(l) as string[]);
    expect(all.some((t) => t.includes('"'))).toBe(true);
    expect(all.filter((t) => t.includes('\\"'))).toEqual([]);
  });
});
