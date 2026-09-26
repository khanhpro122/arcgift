import { describe, expect, it } from "vitest";
import { errorMessage } from "./ui";

const viemError = (shortMessage: string, extra: object = {}) =>
  Object.assign(new Error(`${shortMessage}\n\nDetails: raw rpc text`), { shortMessage, ...extra });

describe("errorMessage", () => {
  it("wallet rejection reads as a cancelled transaction", () => {
    expect(errorMessage(viemError("User rejected the request."))).toBe("Transaction cancelled. No changes were made.");
  });

  it("maps known contract reverts to plain sentences", () => {
    expect(errorMessage(viemError("reverted", { cause: { data: { errorName: "SoldOut" } } }))).toBe(
      "Every gift in this link has already been opened.",
    );
  });

  it("never shows raw RPC/contract text", () => {
    expect(errorMessage(viemError('The contract function "approve" reverted with the following reason:'))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(errorMessage(viemError("HTTP request failed."))).toBe(
      "Couldn't reach the network. Check your connection and try again.",
    );
  });

  it("keeps the app's own user-facing messages", () => {
    expect(errorMessage(new Error("Couldn't open the gift. Please try again."))).toBe(
      "Couldn't open the gift. Please try again.",
    );
  });
});
