export type PaymentDate = { date: string; raw: string };

export const WEEKDAY_AVERAGE_SALES = [87000, 124000, 124000, 124000, 123000, 127000, 133000] as const;
export const WEEKDAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"] as const;
export const CRITICAL_PAYMENT_DAYS = [5, 10, 15, 20, 25] as const;
const PURCHASE_RATIO = 0.6;

export function getPurchaseLimitForDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  const weekday = parsed.getDay();
  const averageSales = WEEKDAY_AVERAGE_SALES[weekday];
  const weekdayLimit = averageSales * PURCHASE_RATIO;
  const isCritical = CRITICAL_PAYMENT_DAYS.includes(parsed.getDate() as typeof CRITICAL_PAYMENT_DAYS[number]);
  return {
    weekday: WEEKDAY_NAMES[weekday],
    averageSales,
    weekdayLimit,
    isCritical,
    limit: isCritical ? Math.min(50000, weekdayLimit) : weekdayLimit,
  };
}

export function canPurchaseOnDate(date: string, existingDebits: number, purchaseValue: number): boolean {
  return existingDebits + purchaseValue <= getPurchaseLimitForDate(date).limit;
}

export function parsePaymentDates(value: string): PaymentDate[] {
  return value
    .split(/[;,]+/)
    .map(raw => raw.trim())
    .filter(Boolean)
    .map(raw => {
      const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) return null;
      const [, day, month, year] = match;
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
