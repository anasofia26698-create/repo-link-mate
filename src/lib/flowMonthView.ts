import { FLOW_MONTHS } from "./purchaseValidation";

export const FLOW_MONTH_STORAGE_KEY = "cash-flow-selected-month";
export function restoredFlowMonth(value: string | null, fallback = "2026-12"): string {
  return FLOW_MONTHS.some((month) => month === value) ? value ?? fallback : fallback;
}