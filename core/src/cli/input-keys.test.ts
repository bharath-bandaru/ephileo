import { describe, expect, it } from "vitest";
import {
  getArrowDirection,
  isBackspace,
  isCtrlC,
  isCtrlD,
  isPlainEnter,
  isShiftEnter,
  isUnhandledEscape,
} from "./input-keys.js";

describe("isShiftEnter", () => {
  it("recognizes kitty keyboard protocol sequence", () => {
    expect(isShiftEnter(Buffer.from("\x1b[13;2u"))).toBe(true);
  });

  it("recognizes ESC + carriage return", () => {
    expect(isShiftEnter(Buffer.from([0x1b, 0x0d]))).toBe(true);
  });

  it("recognizes ESC + newline", () => {
    expect(isShiftEnter(Buffer.from([0x1b, 0x0a]))).toBe(true);
  });

  it("rejects plain Enter", () => {
    expect(isShiftEnter(Buffer.from([0x0d]))).toBe(false);
  });

  it("rejects arrow key sequences", () => {
    expect(isShiftEnter(Buffer.from("\x1b[A"))).toBe(false);
  });
});

describe("isPlainEnter", () => {
  it("recognizes carriage return", () => {
    expect(isPlainEnter(Buffer.from([0x0d]))).toBe(true);
  });

  it("recognizes newline", () => {
    expect(isPlainEnter(Buffer.from([0x0a]))).toBe(true);
  });

  it("rejects multi-byte sequences", () => {
    expect(isPlainEnter(Buffer.from([0x0d, 0x0a]))).toBe(false);
  });
});

describe("isBackspace", () => {
  it("recognizes DEL byte (127)", () => {
    expect(isBackspace(Buffer.from([0x7f]))).toBe(true);
  });

  it("rejects regular characters", () => {
    expect(isBackspace(Buffer.from("a"))).toBe(false);
  });
});

describe("isCtrlC", () => {
  it("recognizes byte 3", () => {
    expect(isCtrlC(Buffer.from([0x03]))).toBe(true);
  });

  it("rejects other control bytes", () => {
    expect(isCtrlC(Buffer.from([0x04]))).toBe(false);
  });
});

describe("isCtrlD", () => {
  it("recognizes byte 4", () => {
    expect(isCtrlD(Buffer.from([0x04]))).toBe(true);
  });

  it("rejects byte 3", () => {
    expect(isCtrlD(Buffer.from([0x03]))).toBe(false);
  });
});

describe("getArrowDirection", () => {
  it("recognizes up arrow", () => {
    expect(getArrowDirection(Buffer.from("\x1b[A"))).toBe("up");
  });

  it("recognizes down arrow", () => {
    expect(getArrowDirection(Buffer.from("\x1b[B"))).toBe("down");
  });

  it("recognizes right arrow", () => {
    expect(getArrowDirection(Buffer.from("\x1b[C"))).toBe("right");
  });

  it("recognizes left arrow", () => {
    expect(getArrowDirection(Buffer.from("\x1b[D"))).toBe("left");
  });

  it("returns null for non-arrow sequences", () => {
    expect(getArrowDirection(Buffer.from("\x1b[H"))).toBeNull();
  });

  it("returns null for single bytes", () => {
    expect(getArrowDirection(Buffer.from([0x1b]))).toBeNull();
  });

  it("returns null for longer sequences", () => {
    expect(getArrowDirection(Buffer.from("\x1b[13;2u"))).toBeNull();
  });
});

describe("isUnhandledEscape", () => {
  it("returns true for F-key sequences", () => {
    expect(isUnhandledEscape(Buffer.from("\x1bOP"))).toBe(true);
  });

  it("returns false for arrow keys", () => {
    expect(isUnhandledEscape(Buffer.from("\x1b[A"))).toBe(false);
  });

  it("returns false for Shift+Enter", () => {
    expect(isUnhandledEscape(Buffer.from("\x1b[13;2u"))).toBe(false);
  });

  it("returns false for single ESC byte", () => {
    expect(isUnhandledEscape(Buffer.from([0x1b]))).toBe(false);
  });

  it("returns false for regular characters", () => {
    expect(isUnhandledEscape(Buffer.from("a"))).toBe(false);
  });
});
