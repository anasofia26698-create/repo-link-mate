import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BUYERS } from "@/lib/buyerRules";
import { listCashFlowMonthBudgets, savePurchaseMonthPlan } from "@/lib/cashflow.functions";
import { allocateBudgetCents, FLOW_MONTHS, monthLabel } from "@/lib/purchaseValidation";
import { money, parseBRL } from "./format";

export function MonthlyPurchasePlan() {
  const client = useQueryClient();
  const plans = useQuery({ queryKey: ["cash-flow-month-budgets"], queryFn: () => listCashFlowMonthBudgets() });
  const [month, setMonth] = useState<string>("2027-01");
  const [drafts, setDrafts] = useState<Record<string, { budget: string; shares: string[] }>>({});
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const plan = plans.data?.find((item) => item.month === month);
  const draft = drafts[month] ?? { budget: plan ? money(plan.budgetCents / 100) : "", shares: BUYERS.map((buyer) => String(plan?.buyerParticipations?.[buyer] ?? "")) };
  const shares = draft.shares.map((value) => Number(value.replace(",", ".")));
  let amounts: number[] = [];
  try { amounts = allocateBudgetCents(Math.round(parseBRL(draft.budget) * 100), shares); } catch { /* Incomplete form. */ }
  const update = (next: Partial<typeof draft>) => setDrafts((current) => ({ ...current, [month]: { ...draft, ...next } }));
  const save = async () => {
    setSaving(true);
    try {
      await savePurchaseMonthPlan({ data: { password, month: month as (typeof FLOW_MONTHS)[number], budgetCents: Math.round(parseBRL(draft.budget) * 100), shares } });
      await client.invalidateQueries();
      toast.success(`Orçamento de ${monthLabel(month)} salvo`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar o orçamento"); }
    finally { setSaving(false); }
  };
  return <section className="card goals-card">
    <div className="card-heading"><h2>Orçamento mensal do fluxo</h2></div>
    <div className="form-stack">
      <label>Mês do orçamento<select value={month} onChange={(event) => setMonth(event.target.value)}>{FLOW_MONTHS.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>)}</select></label>
      {month === "2026-11" || month === "2026-12" ? <p>{month === "2026-11" ? "Novembro" : "Dezembro"} preservado: orçamento {money(month === "2026-11" ? 1891469 : 1974368)} e dotações atuais dos compradores mantidas.</p> : <>
        <label>Orçamento de compra do mês<input inputMode="decimal" value={draft.budget} onChange={(event) => update({ budget: event.target.value })} placeholder="0,00" /></label>
        {BUYERS.map((buyer, index) => <label key={buyer}>Participação — {buyer} (%)<input inputMode="decimal" value={draft.shares[index] ?? ""} onChange={(event) => update({ shares: draft.shares.map((value, i) => i === index ? event.target.value : value) })} /><small>Dotação: {money((amounts[index] ?? 0) / 100)}</small></label>)}
        <label>Senha de acesso<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <Button onClick={save} disabled={saving || plans.isLoading}><Save />{saving ? "Salvando..." : "Salvar orçamento do mês"}</Button>
      </>}
    </div>
  </section>;
}