import { describe, expect, it } from "vitest";
import { allocateBudgetCents, FLOW_MONTHS, paymentDateError, purchaseRejection, splitInstallmentCents, termError } from "./purchaseValidation";
import { getMonthlyPurchaseDay, getPurchaseLimitForDate } from "./simulationRules";

describe("payment window", () => {
  it("lists the seven months December through June", () => expect([...FLOW_MONTHS]).toEqual(["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06"]));
  it("accepts November 13", () => expect(paymentDateError("2026-11-13", "2026-11-12")).toBeNull());
  it("accepts June 30", () => expect(paymentDateError("2027-06-30", "2026-11-12")).toBeNull());
  it("rejects July 1", () => expect(paymentDateError("2027-07-01", "2026-11-12")).toBe("Simulação disponível somente até 30/06/2027"));
  it("rejects dates before today", () => expect(paymentDateError("2026-11-13", "2026-11-14")).toBe("Datas anteriores à data de hoje não são permitidas"));
});
describe("values and terms", () => {
  it("rejects sub-cent installments for one cent in three parts", () => expect(splitInstallmentCents(1, 3)).toEqual([1, 0, 0]));
  it("preserves the purchase total to the cent", () => expect(splitInstallmentCents(100, 3)).toEqual([34, 33, 33]));
  it("rejects a zero total", () => expect(splitInstallmentCents(0, 3)).toEqual([]));
  it("allows integer terms 1 through 230", () => expect(termError([1, 230])).toBeNull());
  it.each([0, 231, 1.5])("rejects invalid term %s", (term) => expect(termError([term])).not.toBeNull());
  it("closes allocations with the remainder assigned to the largest share", () => expect(allocateBudgetCents(100, [40.61, 32.54, 26.86])).toEqual([40, 33, 27]));
});
describe("monthly availability", () => {
  const budgets = new Map([["2026-12", 197436800], ["2027-02", 10000000], ["2027-06", 10000000]]);
  it("keeps the December budget and sixty percent daily goal", () => {
    const day = getMonthlyPurchaseDay("2026-12-01", new Map(), budgets);
    expect(day.budgetCents).toBe(197436800);
    expect(day.goalCents).toBe(7440000);
  });
  it("keeps the critical day cap at 50000", () => expect(getPurchaseLimitForDate("2027-02-10").limit).toBe(50000));
  it("blocks March with no registered budget", () => expect(purchaseRejection("2027-03-12", 1, new Map(), budgets, "2026-11-12")).toBe("Orçamento de março de 2027 não cadastrado"));
  it("accepts June 30 with a budget", () => expect(purchaseRejection("2027-06-30", 1, new Map(), budgets, "2026-11-12")).toBeNull());
  it("applies February 10 debits only to February", () => {
    const before = getMonthlyPurchaseDay("2026-12-01", new Map(), budgets);
    const debits = new Map([["2027-02-10", 10000]]);
    expect(getMonthlyPurchaseDay("2027-02-10", debits, budgets).remainingBudgetCents).toBe(9990000);
    expect(getMonthlyPurchaseDay("2026-12-01", debits, budgets)).toEqual(before);
  });
  it("refuses amounts above the monthly balance", () => expect(purchaseRejection("2027-02-10", 10000001, new Map(), budgets, "2026-11-12")).toBe("NÃO PODE COMPRAR: saldo do mês insuficiente"));
  it("refuses amounts above daily free availability", () => expect(purchaseRejection("2027-02-10", 5000001, new Map(), new Map([["2027-02", 200000000]]), "2026-11-12")).toBe("NÃO PODE COMPRAR: limite do dia insuficiente"));
  it("redistributes only within available goals and monthly remainder", () => {
    const debits = new Map([["2027-02-10", 6000000]]);
    const days = Array.from({ length: 28 }, (_, i) => getMonthlyPurchaseDay(`2027-02-${String(i + 1).padStart(2, "0")}`, debits, budgets));
    expect(days.reduce((sum, day) => sum + day.freeCents, 0)).toBe(4000000);
    expect(days[9]?.freeCents).toBe(0);
  });
});