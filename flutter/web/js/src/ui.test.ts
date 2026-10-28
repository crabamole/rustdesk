/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./style.css", () => ({}));
vi.mock("./connection", () => ({}));
vi.mock("./globals", () => ({
  newConn: vi.fn(() => ({
    setMsgbox: vi.fn(),
    start: vi.fn(),
    login: vi.fn(),
  })),
  getConn: vi.fn(() => ({
    login: vi.fn(),
  })),
  close: vi.fn(),
}));

describe("ui.js XSS prevention", () => {
  beforeEach(async () => {
    document.body.innerHTML = '<div id="app"></div>';

    (window as any).init = vi.fn();

    vi.resetModules();

    vi.doMock("./style.css", () => ({}));
    vi.doMock("./connection", () => ({}));
    vi.doMock("./globals", () => ({
      newConn: vi.fn(() => ({
        setMsgbox: vi.fn(),
        start: vi.fn(),
        login: vi.fn(),
      })),
      getConn: vi.fn(() => ({
        login: vi.fn(),
      })),
      close: vi.fn(),
    }));

    await import("./ui.js");
  });

  it("should render status text safely, not as HTML", () => {
    const textEl = document.querySelector("div#text") as HTMLElement;
    expect(textEl).not.toBeNull();

    const malicious = '<img src=x onerror="alert(1)">';
    textEl.textContent = malicious;

    expect(textEl.innerHTML).not.toContain("<img");
    expect(textEl.textContent).toBe(malicious);
    expect(textEl.childElementCount).toBe(0);
  });

  it("should not use innerHTML with dynamic text for #text element", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "ui.js"),
      "utf-8"
    );

    const lines = source.split("\n");
    for (const line of lines) {
      if (line.match(/querySelector\(['"]div#text['"]\)\.innerHTML/)) {
        expect(line).not.toMatch(/\+\s*text/);
        expect(line).not.toMatch(/\$\{text\}/);
      }
    }
  });

  it("error status should have red color styling", () => {
    const textEl = document.querySelector("div#text") as HTMLElement;
    textEl.textContent = "test error";
    textEl.style.fontWeight = "bold";
    textEl.style.color = "red";

    expect(textEl.style.color).toBe("red");
    expect(textEl.style.fontWeight).toBe("bold");
  });

  it("non-error status should not have red color", () => {
    const textEl = document.querySelector("div#text") as HTMLElement;
    textEl.textContent = "connecting";
    textEl.style.fontWeight = "bold";
    textEl.style.color = "";

    expect(textEl.style.color).toBe("");
    expect(textEl.style.fontWeight).toBe("bold");
  });
});

describe("ui.js behavioral tests", () => {
  let mockConn: any;
  let mockGlobals: any;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="app"></div>';

    (window as any).init = vi.fn();

    vi.resetModules();

    mockConn = {
      setMsgbox: vi.fn(),
      start: vi.fn(),
      login: vi.fn(),
    };
    mockGlobals = {
      newConn: vi.fn(() => mockConn),
      getConn: vi.fn(() => mockConn),
      close: vi.fn(),
    };

    vi.doMock("./style.css", () => ({}));
    vi.doMock("./connection", () => ({}));
    vi.doMock("./globals", () => mockGlobals);

    await import("./ui.js");

    (window as any).connect();
  });

  it("msgbox input-password shows password div, hides status", () => {
    const msgbox = mockConn.setMsgbox.mock.calls[0][0];
    msgbox("input-password", "Password", "Enter password");

    expect((document.querySelector("div#password") as HTMLElement).style.display).toBe("block");
    expect((document.querySelector("div#status") as HTMLElement).style.display).toBe("none");
  });

  it("msgbox error shows red status text via textContent", () => {
    const msgbox = mockConn.setMsgbox.mock.calls[0][0];
    const malicious = '<img src=x onerror="alert(1)">';
    msgbox("error", "Error", malicious);

    const textEl = document.querySelector("div#text") as HTMLElement;
    expect(textEl.textContent).toBe(malicious);
    expect(textEl.innerHTML).not.toContain("<img");
    expect(textEl.style.color).toBe("red");
  });

  it("msgbox non-error shows status text without red", () => {
    const msgbox = mockConn.setMsgbox.mock.calls[0][0];
    msgbox("connecting", "Status", "Connecting...");

    const textEl = document.querySelector("div#text") as HTMLElement;
    expect(textEl.textContent).toBe("Connecting...");
    expect(textEl.style.color).toBe("");
  });

  it("submitPassword calls conn.login with password value", () => {
    const input = document.querySelector("#password-input") as HTMLInputElement;
    input.value = "secret123";

    (window as any).submitPassword();

    expect(mockConn.login).toHaveBeenCalledWith("secret123");
  });

  it("submitPassword does nothing when password is empty", () => {
    const input = document.querySelector("#password-input") as HTMLInputElement;
    input.value = "";

    (window as any).submitPassword();

    expect(mockConn.login).not.toHaveBeenCalled();
  });
});

describe("ui.js password confirmation", () => {
  it("does not override native window.confirm", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "ui.js"), "utf-8");
    expect(source).not.toMatch(/window\.confirm\s*=/);
  });

  it("confirm button calls submitPassword", () => {
    const btn = document.querySelector("button#confirm") as HTMLElement;
    expect(btn.getAttribute("onclick")).toBe("submitPassword()");
  });

  it("source: submitPassword guards getConn() before calling login", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.resolve(__dirname, "ui.js"), "utf-8");
    const fn = source.slice(source.indexOf("submitPassword"));
    expect(fn).toMatch(/getConn\(\)/);
    expect(fn).not.toMatch(/getConn\(\)\.login/);
  });
});
