import { describe, expect, it } from "vitest";
import { GOAL_MONTHS, goalMonthAmounts, previousGoalMonths } from "./goalMonthRules";

describe("monthly buyer goals", () => {
  const shares = [40.61, 32.54, 26.86];
  it("offers December 2026 through June 2027 in order", () => {
    expect(GOAL_MONTHS).toEqual(["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]);
  });
  it("preserves December at R$ 1.974.368,00 when saved", () => {
    expect(goalMonthAmounts("2026-12", 329061333, shares).budgetCents).toBe(197436800);
    expect(goalMonthAmounts("2026-12", 329061333, shares).allocations).toEqual([80171060, 64239510, 53026220]);
  });
  it("keeps months without sales at zero", () => {
    expect(goalMonthAmounts("2027-06", 0, shares)).toEqual({ budgetCents: 0, allocations: [0, 0, 0] });
  });
  it("closes the three allocations to the 60% total", () => {
    const result = goalMonthAmounts("2027-02", 300000000, shares);
    expect(result.budgetCents).toBe(180000000);
    expect(result.allocations.reduce((a, b) => a + b, 0)).toBe(180000000);
  });
  it("inherits from the closest earlier month, never a later month", () => {
    expect(previousGoalMonths("2027-03")).toEqual(["2027-02", "2027-01", "2026-12"]);
  });
  it("calculating another month cannot change December", () => {
    const december = goalMonthAmounts("2026-12", 329061333, shares);
    goalMonthAmounts("2027-06", 400000000, shares);
    expect(december.budgetCents).toBe(197436800);
    expect(december.allocations.reduce((a, b) => a + b, 0)).toBe(197436800);
  });
});