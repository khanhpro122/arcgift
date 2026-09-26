import { describe, expect, it } from "vitest";
import { hasMessage } from "./GiftMessage";

describe("hasMessage", () => {
  it("hides the note when the sender wrote nothing", () => {
    for (const empty of [null, undefined, "", " ", "\n\n", " \t\n "]) expect(hasMessage(empty)).toBe(false);
  });

  it("shows any real note", () => {
    expect(hasMessage("gm")).toBe(true);
    expect(hasMessage("Chào bạn 👋\n\nMình gửi tặng bạn một món quà nhỏ.")).toBe(true);
  });
});
