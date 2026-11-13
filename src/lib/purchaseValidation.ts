import { getMonthlyPurchaseDay } from "./simulationRules";

export const FLOW_MONTHS = ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11", "2027-12"] as const;
export const PAYMENT_START = "2026-11-13";
export const PAYMENT_END = "2027-12-31";
export const monthLabel = (month: string) => new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
export const missingBudgetMessage = (month: string) => `Orçamento de ${monthLabel(month)} não cadastrado`;
export function businessToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value ?? "").join("-");
}
export function paymentDateError(date: string, today = businessToday()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return "Data prevista inválida";
  if (date > PAYMENT_END) return "Simulação disponível somente até 31/12/2027";
  if (date < today) return "Datas anteriores à data de hoje não são permitidas";
  if (date < PAYMENT_START) return "Simulação disponível a partir de 13/11/2026";
  return null;
}
export function parsePurchaseTerms(value: string): number[] {
  return value.split(/[\s,;]+/).filter(Boolean).map(Number);
}
export function termError(terms: readonly number[]): string | null {
  return !terms.length || terms.some((term) => !Number.isInteger(term) || term < 1 || term > 230) ? "Prazo em dias deve ser um número inteiro entre 1 e 230" : null;
}
export function splitInstallmentCents(totalCents: number, count: number): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 1 || count < 1) return [];
  const base = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, index) => base + (index < totalCents % count ? 1 : 0));
}
export function allocateBudgetCents(budgetCents: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0 || weights.some((weight) => !Number.isFinite(weight) || weight < 0)) throw new Error("Informe participações válidas para os compradores");
  const amounts = weights.map((weight) => Math.round(budgetCents * weight / total));
  const largest = weights.indexOf(Math.max(...weights));
  amounts[largest] = (amounts[largest] ?? 0) + budgetCents - amounts.reduce((sum, amount) => sum + amount, 0);
  return amounts;
}
export function purchaseRejection(date: string, cents: number, debits: ReadonlyMap<string, number>, budgets: ReadonlyMap<string, number>, today = businessToday()): string | null {
  const dateError = paymentDateError(date, today);
  if (dateError) return dateError;
  if (!Number.isSafeInteger(cents) || cents < 1) return "Valor da parcela muito baixo: informe um valor total maior";
  const day = getMonthlyPurchaseDay(date, debits, budgets);
  if (!day.budgetConfigured || day.budgetCents <= 0) return missingBudgetMessage(date.slice(0, 7));
  if (day.monthBlocked || cents > day.remainingBudgetCents) return "NÃO PODE COMPRAR: saldo do mês insuficiente";
  if (cents > day.freeCents) return "NÃO PODE COMPRAR: limite do dia insuficiente";
  return null;
}