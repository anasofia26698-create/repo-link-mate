export const PURCHASE_ACCESS_PASSWORD = "2606";

export function isPurchaseAccessGranted(password: string): boolean {
  return password === PURCHASE_ACCESS_PASSWORD;
}

export function calculatePurchaseBudget(sales: number, cmv: number, initialStock: number, finalStock: number): number {
  return sales * (cmv / 100) + (finalStock - initialStock);
}

export function calculateConsumption(budget: number, bought: number): number {
  return budget > 0 ? (bought / budget) * 100 : 0;
}

export function consumptionStatus(consumption: number): "ok" | "warning" | "danger" {
  return consumption > 100 ? "danger" : consumption > 80 ? "warning" : "ok";
}
