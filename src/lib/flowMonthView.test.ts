import { describe, expect, it } from "vitest";
import { FLOW_MONTHS } from "./purchaseValidation";
import { restoredFlowMonth } from "./flowMonthView";

describe("flow month selection", () => {
  it("includes all 14 months even without saved budgets", () => {
    expect(FLOW_MONTHS).toEqual(["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11", "2027-12"]);
  });
  it("restores an unbudgeted month and rejects months outside the window", () => {
    expect(restoredFlowMonth("2027-12")).toBe("2027-12");
    expect(restoredFlowMonth("2028-01")).toBe("2026-12");
  });
});