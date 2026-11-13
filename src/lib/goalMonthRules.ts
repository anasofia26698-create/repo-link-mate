import { allocateBudgetCents, FLOW_MONTHS } from "./purchaseValidation";

export const GOAL_MONTHS = FLOW_MONTHS;
export const DECEMBER_SALES_CENTS = 329061333;
export const DECEMBER_BUDGET_CENTS = 197436800;
export const DEFAULT_GOAL_SHARES = [40.61, 32.54, 26.86] as const;

export function goalMonthAmounts(month: string, salesCents: number, shares: readonly number[]) {
  const budgetCents = month === "2026-12" ? DECEMBER_BUDGET_CENTS : Math.round(salesCents * 0.6);
  return { budgetCents, allocations: allocateBudgetCents(budgetCents, shares) };
}

export function previousGoalMonths(month: string) {
  return GOAL_MONTHS.filter((item) => item < month).slice().reverse();
}