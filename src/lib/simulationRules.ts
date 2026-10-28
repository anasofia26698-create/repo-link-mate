export type PaymentDate = { date: string; raw: string };

export const WEEKDAY_AVERAGE_SALES = [87000, 124000, 124000, 124000, 123000, 127000, 133000] as const;
export const WEEKDAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"] as const;
export const CRITICAL_PAYMENT_DAYS = [5, 10, 15, 20, 25] as const;
/** Configuração fixa de gestão: não é derivada nem alterada por importações. */
export const PURCHASE_RATIO = 0.60;
export const REDUCED_FLOW_START_DATE = "2026-09-01";
export const REDUCED_FLOW_END_DATE = "2026-10-31";
export const FROZEN_FLOW_START_DATE = "2026-09-01";
export const FROZEN_FLOW_END_DATE = "2026-09-30";
export const OCTOBER_TIGHTENING_FACTOR = 0.1184;
export const OCTOBER_TIGHTENING_THRESHOLD = 10000;
export const OCTOBER_BASE_BUDGET_CENTS = 198260300;
export const MONTHLY_PURCHASE_BUDGETS_CENTS: Readonly<Record<string, number>> = {
  "2026-09": 190684100,
  "2026-10": 198260300,
  "2026-11": 189146900,
  "2026-12": 197436800,
  "2027-01": 196558400,
  "2027-02": 175261300,
};

export function getMonthlyPurchaseBudgetCents(month: string): number {
  const configured = MONTHLY_PURCHASE_BUDGETS_CENTS[month];
  if (configured !== undefined) return configured;
  const [yearText = "0", monthText = "0"] = month.split("-");
  const daysInMonth = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    return Math.round(getPurchaseLimitForDate(date).limit * 100);
  }).reduce((total, value) => total + value, 0);
}

export type MonthlyPurchaseDay = {
  date: string;
  debitCents: number;
  goalCents: number;
  freeCents: number;
  limitCents: number;
  totalDebitCents: number;
  budgetCents: number;
  remainingBudgetCents: number;
  goalFreeCents: number;
  monthBlocked: boolean;
  frozen: boolean;
};

export function getMonthlyPurchaseDay(date: string, debitByDateCents: ReadonlyMap<string, number>): MonthlyPurchaseDay {
  const month = date.slice(0, 7);
  const budgetCents = getMonthlyPurchaseBudgetCents(month);
  const [yearText = "0", monthText = "0"] = month.split("-");
  const daysInMonth = new Date(Date.UTC(Number(yearText), Number(monthText), 0)).getUTCDate();
  let totalDebitCents = 0;
  let goalFreeCents = 0;
  const goals = new Map<string, number>();
  const targetFreeByDate = new Map<string, number>();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const currentDate = `${month}-${String(day).padStart(2, "0")}`;
    const goalCents = Math.round(getPurchaseLimitForDate(currentDate).limit * 100);
    const debitCents = debitByDateCents.get(currentDate) ?? 0;
    goals.set(currentDate, goalCents);
    totalDebitCents += debitCents;
    const targetFreeCents = Math.max(0, goalCents - debitCents);
    targetFreeByDate.set(currentDate, targetFreeCents);
    goalFreeCents += targetFreeCents;
  }
  const remainingBudgetCents = Math.max(0, budgetCents - totalDebitCents);
  const scale = goalFreeCents > 0 ? Math.min(1, remainingBudgetCents / goalFreeCents) : 0;
  const targetDateGoalCents = goals.get(date) ?? Math.round(getPurchaseLimitForDate(date).limit * 100);
  const targetDebitCents = debitByDateCents.get(date) ?? 0;
  const monthBlocked = month === "2026-09" || (month === "2026-10" && totalDebitCents > budgetCents);
  const allocationTargetCents = monthBlocked ? 0 : Math.min(remainingBudgetCents, goalFreeCents);
  const allocatedFreeByDate = new Map<string, number>();
  let allocatedCents = 0;
  const fractionalDays: { date: string; fraction: number }[] = [];
  for (const [currentDate, targetFreeCents] of targetFreeByDate) {
    const exact = targetFreeCents * scale;
    const floored = Math.min(targetFreeCents, Math.floor(exact));
    allocatedFreeByDate.set(currentDate, floored);
    allocatedCents += floored;
    fractionalDays.push({ date: currentDate, fraction: exact - Math.floor(exact) });
  }
  let remainderCents = allocationTargetCents - allocatedCents;
  fractionalDays.sort((a, b) => b.fraction - a.fraction);
  for (const item of fractionalDays) {
    if (remainderCents <= 0) break;
    const current = allocatedFreeByDate.get(item.date) ?? 0;
    const cap = targetFreeByDate.get(item.date) ?? 0;
    if (current < cap) {
      allocatedFreeByDate.set(item.date, current + 1);
      remainderCents -= 1;
    }
  }
  const freeCents = allocatedFreeByDate.get(date) ?? 0;
  return {
    date,
    debitCents: targetDebitCents,
    goalCents: targetDateGoalCents,
    freeCents,
    limitCents: targetDebitCents + freeCents,
    totalDebitCents,
    budgetCents,
    remainingBudgetCents,
    goalFreeCents,
    monthBlocked,
    frozen: isFrozenFlowDate(date),
  };
}

export function getOctoberBudgetExceededCents(debitByDateCents: ReadonlyMap<string, number>): number {
  const totalDebitCents = Array.from(debitByDateCents.entries())
    .reduce((total, [date, debitCents]) => total + (date.startsWith("2026-10") ? debitCents : 0), 0);
  return Math.max(0, totalDebitCents - OCTOBER_BASE_BUDGET_CENTS);
}

export function isFrozenFlowDate(date: string): boolean {
  return date >= FROZEN_FLOW_START_DATE && date <= FROZEN_FLOW_END_DATE;
}

export function getPurchaseRatioForDate(date: string): number {
  // Setembro/outubro permanecem na configuração reduzida mesmo após novas planilhas.
  return PURCHASE_RATIO;
}

export function getPurchaseLimitForDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  const weekday = parsed.getDay();
  const averageSales = WEEKDAY_AVERAGE_SALES[weekday] ?? 0;
  const weekdayLimit = averageSales * getPurchaseRatioForDate(date);
  const isCritical = CRITICAL_PAYMENT_DAYS.includes(parsed.getDate() as typeof CRITICAL_PAYMENT_DAYS[number]);
  return {
    weekday: WEEKDAY_NAMES[weekday] ?? "",
    averageSales,
    weekdayLimit,
    isCritical,
    isFrozen: isFrozenFlowDate(date),
    limit: isCritical ? Math.min(50000, weekdayLimit) : weekdayLimit,
  };
}

export function canPurchaseOnDate(date: string, existingDebits: number, purchaseValue: number): boolean {
  return !isFrozenFlowDate(date) && existingDebits + purchaseValue <= getPurchaseLimitForDate(date).limit;
}

export type DailyRecovery = {
  limit: number;
  applied: boolean;
  pct: number;
  totalExceededCents: number;
  budgetCents: number;
};

/** A partir de novembro, reduz a folga de todos os dias livres do mês. */
export function getAutomaticRecoveryForDate(date: string, debitByDateCents: ReadonlyMap<string, number>): DailyRecovery {
  const baseLimit = getPurchaseLimitForDate(date).limit;
  if (date < "2026-11-01") {
    return { limit: baseLimit, applied: false, pct: 0, totalExceededCents: 0, budgetCents: 0 };
  }
  const [yearText, monthText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let budgetCents = 0;
  let totalExceededCents = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const currentDate = `${yearText}-${monthText}-${String(day).padStart(2, "0")}`;
    const dailyGoalCents = Math.round(getPurchaseLimitForDate(currentDate).limit * 100);
    budgetCents += dailyGoalCents;
    const debitCents = debitByDateCents.get(currentDate) ?? 0;
    if (debitCents > dailyGoalCents) totalExceededCents += debitCents - dailyGoalCents;
  }
  if (!totalExceededCents || !budgetCents) {
    return { limit: baseLimit, applied: false, pct: 0, totalExceededCents, budgetCents };
  }
  const pct = totalExceededCents / budgetCents;
  const parsed = new Date(`${date}T12:00:00`);
  const isCritical = CRITICAL_PAYMENT_DAYS.includes(parsed.getDate() as typeof CRITICAL_PAYMENT_DAYS[number]);
  const debitCents = debitByDateCents.get(date) ?? 0;
  const baseLimitCents = Math.round(baseLimit * 100);
  if (isCritical || debitCents >= baseLimitCents) {
    return { limit: baseLimit, applied: false, pct, totalExceededCents, budgetCents };
  }
  const originalFreeCents = Math.max(0, baseLimitCents - debitCents);
  const reducedFreeCents = Math.max(0, Math.round(originalFreeCents * (1 - pct)));
  return { limit: (debitCents + reducedFreeCents) / 100, applied: true, pct, totalExceededCents, budgetCents };
}

export function getAutomaticRecoverySummary(month: string, debitByDateCents: ReadonlyMap<string, number>) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${yearText}-${monthText}-${String(day).padStart(2, "0")}`;
    const result = getAutomaticRecoveryForDate(date, debitByDateCents);
    if (result.totalExceededCents > 0) return result;
  }
  return null;
}

export function parsePaymentDates(value: string): PaymentDate[] {
  return value
    .split(/[;,]+/)
    .map(raw => raw.trim())
    .filter(Boolean)
    .map(raw => {
      const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) return null;
      const day = match[1]!;
      const month = match[2]!;
      const year = match[3]!;
      const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      const parsed = new Date(`${date}T12:00:00`);
      const validCalendarDate = parsed.getFullYear() === Number(year)
        && parsed.getMonth() + 1 === Number(month)
        && parsed.getDate() === Number(day);
      return validCalendarDate ? { date, raw } : null;
    })
    .filter((item): item is PaymentDate => Boolean(item));
}

export function calculateDaysFromReference(reference: string, date: string): number {
  return Math.max(0, Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${reference}T12:00:00`).getTime()) / 86400000));
}

export function splitPurchase(total: number, installmentCount: number): number {
  return installmentCount > 0 ? total / installmentCount : 0;
}

export function buildManualPaymentScenarios(reference: string, dates: string[], total: number) {
  const installment = splitPurchase(total, dates.length);
  return dates.map(date => ({ date, term: calculateDaysFromReference(reference, date), installment }));
}

export function buildTermPaymentScenarios(reference: string, terms: number[], total: number) {
  const installment = splitPurchase(total, terms.length);
  return terms.map(term => {
    const date = new Date(`${reference}T12:00:00`);
    date.setDate(date.getDate() + term);
    return { date: date.toISOString().slice(0, 10), term, installment };
  });
}

export type { PaymentDate as ParsedPaymentDate };
