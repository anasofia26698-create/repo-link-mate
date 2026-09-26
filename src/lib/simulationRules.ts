export type PaymentDate = { date: string; raw: string };

export const WEEKDAY_AVERAGE_SALES = [87000, 124000, 124000, 124000, 123000, 127000, 133000] as const;
export const WEEKDAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"] as const;
export const CRITICAL_PAYMENT_DAYS = [5, 10, 15, 20, 25] as const;
/** Configuração fixa de gestão: não é derivada nem alterada por importações. */
export const PURCHASE_RATIO = 0.549;
export const REDUCED_FLOW_START_DATE = "2026-09-01";
export const REDUCED_FLOW_END_DATE = "2026-10-31";
export const FROZEN_FLOW_START_DATE = "2026-09-01";
export const FROZEN_FLOW_END_DATE = "2026-09-30";
export const OCTOBER_TIGHTENING_FACTOR = 0.1184;
export const OCTOBER_TIGHTENING_THRESHOLD = 10000;

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
  lastExceededDate?: string;
};

/** Calcula a meta efetiva de um dia sem alterar setembro/outubro. */
export function getAutomaticRecoveryForDate(date: string, debitByDateCents: ReadonlyMap<string, number>): DailyRecovery {
  if (date < "2026-11-01") {
    return { limit: getPurchaseLimitForDate(date).limit, applied: false, pct: 0, totalExceededCents: 0 };
  }
  const [yearText, monthText] = date.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let monthlyGoalCents = 0;
  let totalExceededCents = 0;
  let lastExceededDate: string | undefined;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const currentDate = `${yearText}-${monthText}-${String(day).padStart(2, "0")}`;
    const baseGoalCents = Math.round(getPurchaseLimitForDate(currentDate).limit * 100);
    monthlyGoalCents += baseGoalCents;
    const debitCents = debitByDateCents.get(currentDate) ?? 0;
    if (debitCents > baseGoalCents) {
      totalExceededCents += debitCents - baseGoalCents;
      lastExceededDate = currentDate;
    }
  }
  if (!totalExceededCents || !monthlyGoalCents || !lastExceededDate || date <= lastExceededDate || getPurchaseLimitForDate(date).isCritical) {
    const result: DailyRecovery = { limit: getPurchaseLimitForDate(date).limit, applied: false, pct: 0, totalExceededCents };
    return lastExceededDate ? { ...result, lastExceededDate } : result;
  }
  const pct = totalExceededCents / monthlyGoalCents;
  const baseLimit = getPurchaseLimitForDate(date).limit;
  return { limit: Math.max(0, baseLimit * (1 - pct)), applied: true, pct, totalExceededCents, lastExceededDate };
}

export function getAutomaticRecoverySummary(month: string, debitByDateCents: ReadonlyMap<string, number>) {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let last: DailyRecovery | undefined;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${yearText}-${monthText}-${String(day).padStart(2, "0")}`;
    const result = getAutomaticRecoveryForDate(date, debitByDateCents);
    if (result.totalExceededCents > 0) last = result;
  }
  return last && last.lastExceededDate ? last : null;
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
