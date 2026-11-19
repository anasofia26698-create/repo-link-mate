import { z } from "zod";
import { calculatePurchaseBudget } from "./purchaseRules";

export const LEGACY_GOALS_KEY = "signal-cash-purchase-goals-v1";
export const sectorGoalSchema = z.object({
  sector: z.string().trim().min(1).max(100),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  sales: z.number().finite().nonnegative(),
  cmv: z.number().finite().min(0).max(100),
  initialStock: z.number().finite().nonnegative(),
  finalStock: z.number().finite().nonnegative(),
  coverage: z.number().finite().nonnegative(),
  turnover: z.number().finite().nonnegative(),
});
export type SectorGoal = z.infer<typeof sectorGoalSchema>;
export function parseLegacyGoals(raw: string): SectorGoal[] {
  const value: unknown = JSON.parse(raw);
  return z.array(sectorGoalSchema).max(1000).parse(value);
}
export function sectorGoalBudgetCents(goals: readonly SectorGoal[]): number {
  return Math.max(0, Math.round(goals.reduce((sum, goal) => sum + calculatePurchaseBudget(goal.sales, goal.cmv, goal.initialStock, goal.finalStock), 0) * 100));
}