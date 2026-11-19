import { describe, expect, it } from "vitest";
import { parseLegacyGoals, sectorGoalBudgetCents } from "./sectorGoalRules";
import { isPurchaseAccessGranted } from "./purchaseRules";

describe("persisted sector goals", () => {
  it("preserves every legacy field", () => {
    const goal = { sector: "Ético", period: "2027-01", sales: 100000, cmv: 60, initialStock: 20000, finalStock: 25000, coverage: 30, turnover: 2 };
    expect(parseLegacyGoals(JSON.stringify([goal]))).toEqual([goal]);
    expect(sectorGoalBudgetCents([goal])).toBe(6500000);
  });
  it("rejects malformed legacy records instead of losing local data", () => {
    expect(() => parseLegacyGoals('[{"sector":"Ético"}]')).toThrow();
  });
  it("accepts only the unchanged access password", () => {
    expect(isPurchaseAccessGranted("2606")).toBe(true);
    expect(isPurchaseAccessGranted("2607")).toBe(false);
    expect(isPurchaseAccessGranted("")).toBe(false);
  });
});