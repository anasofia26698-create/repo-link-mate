import { describe, expect, it } from "vitest";
import { isTemporaryEntryActive, replaceImportedEntries } from "./flowRules";

describe("permanent confirmations", () => {
  it("keeps a confirmed flow entry after seven days", () => {
    expect(isTemporaryEntryActive({ source: "manual", createdAt: 1 }, 8 * 24 * 60 * 60 * 1000)).toBe(true);
  });
  it("preserves old confirmations when replacing imported entries", () => {
    const confirmed = { source: "manual" as const, createdAt: 1 };
    expect(replaceImportedEntries([confirmed], [{ source: "imported" as const }], 1000000000)).toEqual([confirmed, { source: "imported" }]);
  });
});