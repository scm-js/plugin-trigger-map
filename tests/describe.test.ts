import { describe, expect, it } from "vitest";
import { hex, oneLine, playersText } from "../describe";

describe("playersText", () => {
  it("writes runs as ranges", () => {
    expect(playersText([0])).toBe("P1");
    expect(playersText([0, 1, 2, 3, 4, 5, 6, 7])).toBe("P1–P8");
    expect(playersText([0, 1])).toBe("P1, P2");
    expect(playersText([0, 2, 3, 4, 7])).toBe("P1, P3–P5, P8");
    expect(playersText([])).toBe("");
  });
});

describe("oneLine", () => {
  it("drops colour codes and line breaks, and cuts long text", () => {
    expect(oneLine("\u0003Welcome\r\n\u0004to the map")).toBe("Welcome to the map");
    expect(oneLine("a".repeat(100), 10)).toBe(`${"a".repeat(9)}…`);
  });
});

describe("hex", () => {
  it("writes an address as eight digits", () => {
    expect(hex(0x58a364)).toBe("0x0058A364");
    expect(hex(-1)).toBe("0xFFFFFFFF");
  });
});
