import { FLOW_MONTHS } from "./purchaseValidation";

export const FLOW_MONTH_STORAGE_KEY = "cash-flow-selected-month";
export function restoredFlowMonth(value: string | null, fallback = "2026-12"): string {
  return FLOW_MONTHS.some((month) => month === value) ? value ?? fallback : fallback;
}
export function flowReferenceDate(month: string, referenceDate: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year ?? 0, monthNumber ?? 0, 0)).getUTCDate();
  const day = Math.max(month === "2026-11" ? 13 : 1, Math.min(Number(referenceDate.slice(-2)) || 1, lastDay));
  return `${month}-${String(day).padStart(2, "0")}`;
}
export function scenariosForFlowMonth<T extends { date: string }>(scenarios: readonly T[], month: string): T[] {
  return scenarios.filter((scenario) => scenario.date.slice(0, 7) === month);
}