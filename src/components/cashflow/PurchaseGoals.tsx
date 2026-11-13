import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, BarChart3, Calculator, ChevronLeft, ChevronRight, LockKeyhole, Save } from "lucide-react";
import { isPurchaseAccessGranted } from "@/lib/purchaseRules";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ReferenceDot, XAxis, YAxis } from "recharts";
import { BUYERS, BUYER_BUSINESS_RULES, CRITICAL_DAYS, CRITICAL_FACTOR, WEEKDAY_LABELS, WEEKDAY_WEIGHTS } from "@/lib/buyerRules";
import { getBuyerGoalConfigs, getBuyerMonthlyOverview, repairNovemberDashboardBudgets, saveBuyerGoalMonth } from "@/lib/buyer.functions";
import { listCashFlow, listCashFlowMonthBudgets } from "@/lib/cashflow.functions";
import { allocateBudgetCents } from "@/lib/purchaseValidation";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { money, parseBRL } from "./format";
import { MonthlyPurchasePlan } from "./MonthlyPurchasePlan";
import { Button } from "@/components/ui/button";
import { GOAL_MONTHS, DECEMBER_SALES_CENTS, DEFAULT_GOAL_SHARES, goalMonthAmounts, previousGoalMonths } from "@/lib/goalMonthRules";

export const SECTORS = [
  "Ético",
  "Genérico",
  "Similares/Vitaminas",
  "Perfumaria",
  "Dermocosméticos",
  "Volumosos",
] as const;
export type Sector = (typeof SECTORS)[number];
export type Goal = {
  sector: Sector;
  period: string;
  sales: number;
  cmv: number;
  initialStock: number;
  finalStock: number;
  coverage: number;
  turnover: number;
};

const emptyGoal = (sector: Sector): Goal => ({
  sector,
  period: new Date().toISOString().slice(0, 7),
  sales: 0,
  cmv: 60,
  initialStock: 0,
  finalStock: 0,
  coverage: 0,
  turnover: 0,
});

function PasswordGate({ children, skip = false }: { children: ReactNode; skip?: boolean }) {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  if (skip || unlocked) return <>{children}</>;
  return (
    <section className="card access-card">
      <LockKeyhole size={28} />
      <h2>Área protegida</h2>
      <p>Informe a senha para acessar os dados consolidados de compras.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (isPurchaseAccessGranted(password)) setUnlocked(true);
          else toast.error("Senha incorreta.");
        }}
      >
        <label>
          Senha
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </label>
        <button className="btn btn-dark full">Entrar</button>
      </form>
    </section>
  );
}

type BuyerProfile = { name: string; ips: string; active: boolean };
type MonthlyBuyerConfig = { sales: string; cmv: string; allocation: string; coverage: string; salesPurchases: string };

const emptyMonthlyConfig = (): MonthlyBuyerConfig => ({ sales: "", cmv: "60", allocation: "", coverage: "", salesPurchases: "" });
const monthLabel = (period: string) => { const [year, month] = period.split("-"); return year && month ? `${month}/${year}` : period; };
const MONTHLY_TOTAL_SNAPSHOTS_KEY = "signal-cash-monthly-payable-snapshots-v1";
const SEPTEMBER_MONTHLY_TOTAL = { total: 2723875.38, paid: 2031741.5, open: 692133.88 };
const OCTOBER_MONTHLY_TOTAL = { total: 2265117.99, paid: 329145.14, open: 1935972.85 };
const DECEMBER_ALLOCATION_BASE = { salesCents: 329061333, allocationCents: 197436800 };

function readMonthlySnapshots(): Record<string, number> {
  try {
    if (typeof window === "undefined") return {};
    return JSON.parse(window.localStorage.getItem(MONTHLY_TOTAL_SNAPSHOTS_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

const buyerChartConfig = {
  Marcelo: { label: "Marcelo", color: "var(--chart-marcelo)" },
  Suellen: { label: "Suellen", color: "var(--chart-suellen)" },
  "Maurício": { label: "Maurício", color: "var(--chart-mauricio)" },
} satisfies ChartConfig;
type BuyerChartPoint = { day: string; Marcelo: number; Suellen: number; "Maurício": number };

export function GoalsTab({ requireBuyerAccess = true }: { requireBuyerAccess?: boolean } = {}) {
  return (
    <PasswordGate skip={!requireBuyerAccess}>
      <div className="page-heading page-heading-compact">
        <div>
          <p className="eyebrow">Metas compras</p>
          <h1>Cadastro de Metas</h1>
          <p className="subheading">Configure compradores uma vez e informe somente a venda mensal para gerar a dotação e as metas diárias.</p>
        </div>
      </div>
      <BuyerGoalsForm />
      <MonthlyPurchasePlan />
      <section className="card rules-card">
        <div className="card-heading">
          <div>
            <h2>Regras de dotação orçamentária e meta diária</h2>
            <p>Regras fixas da aba, mantidas visíveis para consulta.</p>
          </div>
        </div>
        <ul className="rules-list">
          {BUYER_BUSINESS_RULES.map((rule) => <li key={rule}>{rule}</li>)}
        </ul>
      </section>
    </PasswordGate>
  );
}

const GOAL_PERIODS = GOAL_MONTHS.map((value) => ({ value, label: new Date(`${value}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(" de ", "/") }));

type GoalDraft = { monthly: Record<string, MonthlyBuyerConfig>; profiles: Record<string, BuyerProfile>; shares: number[] };

function BuyerGoalsForm() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("2026-12");
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [monthSalesInput, setMonthSalesInput] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const plans = useQuery({ queryKey: ["cash-flow-month-budgets"], queryFn: () => listCashFlowMonthBudgets() });
  const configs = useQuery({ queryKey: ["buyer-goal-periods"], queryFn: async () => {
    const rows = await Promise.all(GOAL_MONTHS.map((period) => getBuyerGoalConfigs({ data: { period } })));
    return rows.flat();
  } });
  const savedDraft = useMemo<GoalDraft>(() => {
    const rows = configs.data ?? [];
    const priorMonths = previousGoalMonths(period);
    const currentPlan = plans.data?.find((item) => item.month === period);
    const inheritedPlan = priorMonths.map((month) => plans.data?.find((item) => item.month === month)).find((item) => item?.buyerParticipations);
    const shares = BUYERS.map((buyer, index) => Number((currentPlan?.buyerParticipations ?? inheritedPlan?.buyerParticipations)?.[buyer] ?? DEFAULT_GOAL_SHARES[index] ?? 0));
    const decemberSales = allocateBudgetCents(DECEMBER_SALES_CENTS, shares);
    const currentSales = rows.filter((item) => item.period === period).reduce((sum, item) => sum + item.salesCents, 0);
    return {
      shares,
      monthly: Object.fromEntries(BUYERS.map((buyer, index) => {
        const current = rows.find((item) => item.period === period && item.buyer === buyer);
        const inherited = priorMonths.map((month) => rows.find((item) => item.period === month && item.buyer === buyer)).find(Boolean);
        const salesCents = period === "2026-12" && currentSales !== DECEMBER_SALES_CENTS ? decemberSales[index] ?? 0 : current?.salesCents ?? 0;
        return [buyer, { ...emptyMonthlyConfig(), sales: money(salesCents / 100), cmv: String(current?.cmvPercent ?? inherited?.cmvPercent ?? 60) }];
      })),
      profiles: Object.fromEntries(BUYERS.map((buyer) => {
        const source = rows.find((item) => item.period === period && item.buyer === buyer) ?? priorMonths.map((month) => rows.find((item) => item.period === month && item.buyer === buyer)).find(Boolean);
        return [buyer, { name: buyer, ips: source?.ips.join(", ") ?? "", active: true }];
      })),
    };
  }, [period, configs.data, plans.data]);
  const active = draft ?? savedDraft;
  const salesCents = BUYERS.reduce((sum, buyer) => sum + Math.round(parseBRL(active.monthly[buyer]?.sales ?? "") * 100), 0);
  const amounts = goalMonthAmounts(period, salesCents, active.shares);
  const label = GOAL_PERIODS.find((item) => item.value === period)?.label ?? period;
  const savedSalesCents = (configs.data ?? []).filter((item) => item.period === period).reduce((sum, item) => sum + item.salesCents, 0);
  const pendingSales = period >= "2027-01" && savedSalesCents <= 0;
  const changeMonthSales = (value: string) => {
    setMonthSalesInput(value);
    const allocated = allocateBudgetCents(Math.round(parseBRL(value) * 100), active.shares);
    setDraft({ ...active, monthly: Object.fromEntries(BUYERS.map((buyer, index) => [buyer, { ...(active.monthly[buyer] ?? emptyMonthlyConfig()), sales: money((allocated[index] ?? 0) / 100) }])) });
    setDirty(true);
  };
  const change = (buyer: string, field: "sales" | "cmv", value: string) => {
    if (field === "sales") setMonthSalesInput(null);
    setDraft({ ...active, monthly: { ...active.monthly, [buyer]: { ...(active.monthly[buyer] ?? emptyMonthlyConfig()), [field]: value } } });
    setDirty(true);
  };
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = async () => {
    setSaving(true);
    try {
      await saveBuyerGoalMonth({ data: { password, period, shares: active.shares, configs: BUYERS.map((buyer) => ({
        buyer, salesCents: Math.round(parseBRL(active.monthly[buyer]?.sales ?? "") * 100),
        cmvPercent: Number((active.monthly[buyer]?.cmv ?? "60").replace(",", ".")),
        ips: (active.profiles[buyer]?.ips ?? "").split(/[\s,;]+/).map((ip) => ip.trim().toLowerCase()).filter(Boolean),
      })) } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["buyer-goal-periods"] }),
        queryClient.invalidateQueries({ queryKey: ["buyer-goal-configs", period] }),
        queryClient.invalidateQueries({ queryKey: ["cash-flow-month-budgets"] }),
        queryClient.invalidateQueries({ queryKey: ["buyer-monthly-overview"] }),
      ]);
      setDraft(null); setMonthSalesInput(null); setDirty(false);
      toast.success(`Metas de ${monthLabel(period)} salvas com sucesso.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar as metas."); }
    finally { setSaving(false); }
  };
  return <>
    <div className="card-heading">
      <label>Período<select value={period} disabled={saving} onChange={(event) => {
        if (dirty && !window.confirm("Há alterações não salvas. Deseja descartá-las e trocar de período?")) return;
        setPeriod(event.target.value); setDraft(null); setMonthSalesInput(null); setDirty(false);
      }}>{GOAL_PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Senha de acesso<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <Button className="btn btn-dark" onClick={save} disabled={saving || configs.isLoading || plans.isLoading || configs.isError || plans.isError}><Save size={17} /> {saving ? "Salvando..." : "Salvar"}</Button>
    </div>
    <section className="card december-allocation-note">
      <strong>Dotação oficial de {label}</strong>
      {pendingSales && <small className="red-text">Pendente de venda do mês</small>}
      <label>Venda do mês<input aria-label="Venda do mês" inputMode="decimal" readOnly={period === "2026-12"} value={monthSalesInput ?? money(salesCents / 100)} onChange={(event) => {
        const value = event.target.value.replace(/^R\$\s*/, "");
        if (!value || /^(?:\d+|\d{1,3}(?:\.\d{3})*)(?:,\d{0,2})?$/.test(value)) changeMonthSales(value);
      }} /></label>
      <span>Venda-base cadastrada: {money(salesCents / 100)} · fórmula: 60% · dotação total: {money(amounts.budgetCents / 100)}</span>
      <small>Participações congeladas da base de novembro: {BUYERS.map((buyer, index) => `${buyer} ${(active.shares[index] ?? 0).toFixed(2).replace(".", ",")}%`).join(" · ")}. A soma das dotações dos compradores fecha exatamente o total do mês.</small>
    </section>
    <section className="card goals-card">
      <div className="card-heading"><div><h2>Meta por comprador</h2><p>Venda mensal, CMV informativo e IPs vinculados.</p></div></div>
      <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Comprador</th><th>Venda do mês (R$)</th><th>% CMV alvo</th><th>IPs vinculados</th><th>Dotação mensal (R$)</th><th>Participação</th></tr></thead><tbody>
        {BUYERS.map((buyer, index) => <tr key={buyer}>
          <td><strong>{buyer}</strong></td>
          <td><input aria-label={`Venda do mês de ${buyer}`} inputMode="decimal" value={active.monthly[buyer]?.sales ?? "0,00"} readOnly={period === "2026-12"} onChange={(event) => {
            const value = event.target.value.replace(/^R\$\s*/, "");
            if (!value || /^(?:\d+|\d{1,3}(?:\.\d{3})*)(?:,\d{0,2})?$/.test(value)) change(buyer, "sales", value);
          }} onBlur={() => { if (dirty) change(buyer, "sales", money(parseBRL(active.monthly[buyer]?.sales ?? ""))); }} /></td>
          <td><input inputMode="decimal" value={active.monthly[buyer]?.cmv ?? "60"} onChange={(event) => change(buyer, "cmv", event.target.value.replace(/[^\d,]/g, ""))} />%</td>
          <td><input value={active.profiles[buyer]?.ips ?? ""} placeholder="IPs" onChange={(event) => {
            setDraft({ ...active, profiles: { ...active.profiles, [buyer]: { ...(active.profiles[buyer] ?? { name: buyer, active: true }), ips: event.target.value } } }); setDirty(true);
          }} /></td>
          <td><input className="editable-allocation" aria-label={`Dotação mensal de ${buyer}`} readOnly value={money((amounts.allocations[index] ?? 0) / 100)} /></td>
          <td><strong>{(active.shares[index] ?? 0).toFixed(2).replace(".", ",")} %</strong></td>
        </tr>)}
      </tbody></table></div>
    </section>
      <section className="card goals-card">
        <div className="card-heading"><div><h2><Calculator size={20} /> 3. Parâmetros fixos</h2><p>Configurados uma vez e usados nos cálculos automáticos.</p></div></div>
        <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Parâmetro</th><th>Valor</th><th>Descrição</th></tr></thead><tbody>
          <tr><td><strong>Percentual de dotação sobre a venda</strong></td><td>60%</td><td>Meta de compras mensal.</td></tr>
          <tr><td><strong>Dias críticos de pagamento</strong></td><td>{CRITICAL_DAYS.join(", ")}</td><td>Folha, contas, impostos e adiantamentos.</td></tr>
          <tr><td><strong>Redutor do dia crítico</strong></td><td>{CRITICAL_FACTOR * 100}%</td><td>Aplicado sobre a meta normal.</td></tr>
          <tr><td><strong>Folga recuperável / compensação</strong></td><td>Desativada</td><td>Cada dia tem teto independente.</td></tr>
        </tbody></table></div>
        <div className="card-heading"><div><h3>Pesos por dia da semana</h3></div></div>
        <div className="goals-table-wrap"><table className="goals-table"><thead><tr>{WEEKDAY_LABELS.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody><tr>{WEEKDAY_WEIGHTS.map((weight) => <td key={weight}>{(weight * 100).toFixed(2).replace(".", ",")} %</td>)}</tr></tbody></table></div>
      </section>
    </>;
}


export function PurchasesDashboardTab() {
  const queryClient = useQueryClient();
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useState(currentPeriod);
  const [selectedBuyer, setSelectedBuyer] = useState<(typeof BUYERS)[number] | null>(null);
  const [novemberReductionAttempted, setNovemberReductionAttempted] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<string, number>>(readMonthlySnapshots);
  const overview = useQuery({
    queryKey: ["buyer-monthly-overview"],
    queryFn: () => getBuyerMonthlyOverview(),
    refetchInterval: 300_000,
    refetchIntervalInBackground: true,
  });
  const sharedFlow = useQuery({
    queryKey: ["cash-flow-entries"],
    queryFn: () => listCashFlow(),
    refetchInterval: 300_000,
    refetchIntervalInBackground: true,
  });
  const periods = useMemo(() => {
    const fixed = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];
    const imported = (overview.data?.payments ?? []).map((item) => item.date.slice(0, 7));
    const cashFlowMonths = (sharedFlow.data ?? []).filter((item) => item.source === "imported").map((item) => item.date.slice(0, 7));
    const configured = (overview.data?.budgets ?? []).map((item) => item.period);
    return [...new Set([...fixed, currentPeriod, ...imported, ...cashFlowMonths, ...configured])]
      .filter((item) => item >= "2026-09")
      .sort();
  }, [currentPeriod, overview.data, sharedFlow.data]);
  const rows = useMemo(() => {
    const budgets = overview.data?.budgets ?? [];
    const payments = overview.data?.payments ?? [];
    return BUYERS.map((buyer) => {
      const budget = (budgets.find((item) => item.period === period && item.buyer === buyer)?.monthlyCents ?? 0) / 100;
      const bought = payments
        .filter((item) => item.source === "imported" && item.buyer === buyer && item.date.slice(0, 7) === period)
        .reduce((sum, item) => sum + item.amountCents, 0) / 100;
      const pct = budget > 0 ? bought / budget * 100 : bought > 0 ? 100 : 0;
      return { buyer, budget, bought, available: budget - bought, pct };
    });
  }, [overview.data, period]);
  const totalBudget = rows.reduce((total, row) => total + row.budget, 0);
  const observedPayable = (sharedFlow.data ?? [])
    .filter((item) => item.source === "imported" && item.date.slice(0, 7) === period)
    .reduce((total, item) => total + item.debitCents, 0) / 100;
  const totalPayable = period === "2026-09"
    ? SEPTEMBER_MONTHLY_TOTAL.total
    : period === "2026-10"
      ? Math.max(OCTOBER_MONTHLY_TOTAL.total, observedPayable, snapshots[period] ?? 0)
      : Math.max(observedPayable, snapshots[period] ?? 0);
  const paid = period === "2026-09"
    ? SEPTEMBER_MONTHLY_TOTAL.paid
    : period === "2026-10"
      ? Math.max(OCTOBER_MONTHLY_TOTAL.paid, (overview.data?.payments ?? [])
          .filter((item) => item.source === "confirmed" && item.date.slice(0, 7) === period)
          .reduce((total, item) => total + item.amountCents, 0) / 100)
    : (overview.data?.payments ?? [])
        .filter((item) => item.source === "confirmed" && item.date.slice(0, 7) === period)
        .reduce((total, item) => total + item.amountCents, 0) / 100;
  const open = period === "2026-09" ? SEPTEMBER_MONTHLY_TOTAL.open : Math.max(0, totalPayable - paid);
  const balance = totalBudget - totalPayable;
  const consumption = totalBudget > 0 ? totalPayable / totalBudget * 100 : totalPayable > 0 ? 100 : 0;
  useEffect(() => {
    if (period === "2026-09" || !sharedFlow.data || observedPayable <= (snapshots[period] ?? 0)) return;
    setSnapshots((current) => ({ ...current, [period]: observedPayable }));
  }, [observedPayable, period, sharedFlow.data, snapshots]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(MONTHLY_TOTAL_SNAPSHOTS_KEY, JSON.stringify(snapshots));
  }, [snapshots]);
  useEffect(() => {
    if (period !== "2026-11" || overview.isLoading || novemberReductionAttempted || !(overview.data?.budgets ?? []).some((budget) => budget.period === "2026-11")) return;
    setNovemberReductionAttempted(true);
    repairNovemberDashboardBudgets().then(() => {
      queryClient.invalidateQueries({ queryKey: ["buyer-monthly-overview"] });
    }).catch(() => {
      setNovemberReductionAttempted(false);
    });
  }, [novemberReductionAttempted, overview.data?.budgets, overview.isLoading, period, queryClient]);
  const chartData = useMemo(() => {
    const [year = "", month = ""] = period.split("-");
    const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
    const points: BuyerChartPoint[] = Array.from({ length: daysInMonth }, (_, index) => ({
      day: String(index + 1).padStart(2, "0"),
      Marcelo: 0,
      Suellen: 0,
      "Maurício": 0,
    }));
    for (const payment of overview.data?.payments ?? []) {
      if (payment.source !== "imported" || payment.date.slice(0, 7) !== period) continue;
      const point = points[Number(payment.date.slice(8, 10)) - 1];
      if (!point || !BUYERS.includes(payment.buyer as (typeof BUYERS)[number])) continue;
      point[payment.buyer as (typeof BUYERS)[number]] += payment.amountCents / 100;
    }
    return points;
  }, [overview.data?.payments, period]);
  return (
    <>
      <div className="page-heading page-heading-compact purchase-dashboard-heading">
        <div>
          <p className="eyebrow">Metas compras</p>
          <h1>Dashboard de Compras</h1>
          <p className="subheading">Acompanhamento consolidado de Marcelo, Suellen e Maurício.</p>
        </div>
        <label className="dashboard-month-select">
          Mês de referência
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            {periods.map((item) => <option key={item} value={item}>{formatMonth(item)}</option>)}
          </select>
        </label>
      </div>
      {selectedBuyer ? (
        <BuyerDetailView
          buyer={selectedBuyer}
          period={period}
          rows={rows}
          chartData={chartData}
          onBack={() => setSelectedBuyer(null)}
          onChangeBuyer={setSelectedBuyer}
        />
      ) : (
        <>
      <div className="purchase-kpis">
        <div className="summary-card">
          <span>Dotação total</span>
          <strong>{money(totalBudget)}</strong>
        </div>
        <div className="summary-card">
          <span>A pagar total mês</span>
          <strong>{money(totalPayable)}</strong>
          <small>Pago: {money(paid)} | Em aberto: {money(open)}</small>
        </div>
        <div className="summary-card">
          <span>Saldo disponível</span>
          <strong className={balance < 0 ? "red-text" : "green-text"}>{money(balance)}</strong>
        </div>
        <div className="summary-card">
          <span>Consumo geral</span>
          <strong className={consumption > 100 ? "red-text" : "green-text"}>{formatPercent(consumption)}</strong>
        </div>
      </div>
      <BuyerMonthlyPanel rows={rows} period={period} loading={overview.isLoading} onBuyerSelect={setSelectedBuyer} />
      <BuyerDaysChart data={chartData} period={period} loading={overview.isLoading} />
        </>
      )}
    </>
  );
}

function formatMonth(period: string) {
  const [year = "", month = ""] = period.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (!year || !month || Number.isNaN(date.getTime())) return period;
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatPercent(value: number) {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

type BuyerMonthlyRow = { buyer: (typeof BUYERS)[number]; budget: number; bought: number; available: number; pct: number };

function BuyerMonthlyPanel({ rows, period, loading, onBuyerSelect }: { rows: BuyerMonthlyRow[]; period: string; loading: boolean; onBuyerSelect: (buyer: (typeof BUYERS)[number]) => void }) {
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h2>Atingimento mensal por comprador</h2>
          <p>{formatMonth(period)} · metas cadastradas e compras da planilha importada no módulo Comprador.</p>
        </div>
        <BarChart3 size={21} />
      </div>
      <div className="buyer-month-list">
        {loading && <div className="empty">Carregando dotação por comprador...</div>}
        {!loading &&
          rows.map((row) => (
            <div className="buyer-month-row" key={row.buyer}>
              <div className="buyer-month-head">
                <button type="button" onClick={() => onBuyerSelect(row.buyer)} style={{ border: 0, background: "transparent", padding: 0, color: "#155e75", cursor: "pointer", font: "inherit", fontWeight: 700, textAlign: "left", textDecoration: "underline" }} aria-label={`Abrir tela individual de ${row.buyer}`}>
                  {row.buyer}
                </button>
                <span>
                  {formatMonth(period)} · {formatPercent(row.pct)}
                </span>
              </div>
              <div className="buyer-month-metrics">
                <div>
                  <span>Dotação do mês</span>
                  <strong>{money(row.budget)}</strong>
                </div>
                <div>
                  <span>Comprado no mês</span>
                  <strong>{money(row.bought)}</strong>
                </div>
                <div>
                  <span>Disponível no mês</span>
                  <strong className={row.available < 0 ? "red-text" : "green-text"}>{money(row.available)}</strong>
                </div>
              </div>
              <div className="buyer-month-track">
                <div
                   className={"buyer-month-fill " + (row.pct > 100 ? "over" : row.pct >= 80 ? "warn" : "")}
                  style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }}
                />
              </div>
              {row.pct > 100 ? (
                <div className="buyer-month-warning">Dotação mensal ultrapassada ({formatPercent(row.pct)}).</div>
              ) : row.pct >= 80 ? (
                <div className="buyer-month-warning">Atenção: acima de 80% da dotação mensal.</div>
              ) : null}
            </div>
          ))}
      </div>
    </section>
  );
}

type BuyerDetailPoint = { day: string; value: number };

function BuyerDetailView({
  buyer,
  period,
  rows,
  chartData,
  onBack,
  onChangeBuyer,
}: {
  buyer: (typeof BUYERS)[number];
  period: string;
  rows: BuyerMonthlyRow[];
  chartData: BuyerChartPoint[];
  onBack: () => void;
  onChangeBuyer: (buyer: (typeof BUYERS)[number]) => void;
}) {
  const row = rows.find((item) => item.buyer === buyer) ?? { buyer, budget: 0, bought: 0, available: 0, pct: 0 };
  const detailData: BuyerDetailPoint[] = chartData.map((point) => ({ day: point.day, value: point[buyer] }));
  const peak = detailData.reduce((best, point) => point.value > best.value ? point : best, detailData[0] ?? { day: "01", value: 0 });
  const buyerIndex = BUYERS.indexOf(buyer);
  const detailConfig = { [buyer]: buyerChartConfig[buyer] } satisfies ChartConfig;

  return (
    <section className="buyer-detail-view">
      <div className="card buyer-detail-header">
        <div className="buyer-detail-title">
          <button type="button" className="btn btn-light" onClick={onBack}><ArrowLeft size={17} /> Voltar</button>
          <div>
            <p className="eyebrow">Tela individual do comprador</p>
            <h2>{buyer}</h2>
            <p>{formatMonth(period)} · dados da importação de compras.</p>
          </div>
        </div>
        <div className="buyer-detail-navigation">
          <button type="button" className="btn btn-light" disabled={buyerIndex <= 0} onClick={() => onChangeBuyer(BUYERS[buyerIndex - 1]!)}><ChevronLeft size={16} /> Anterior</button>
          <button type="button" className="btn btn-light" disabled={buyerIndex >= BUYERS.length - 1} onClick={() => onChangeBuyer(BUYERS[buyerIndex + 1]!)}>Próximo <ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="purchase-kpis buyer-detail-kpis">
        <div className="summary-card"><span>Mês</span><strong>{formatMonth(period)}</strong></div>
        <div className="summary-card"><span>Dotação do mês</span><strong>{money(row.budget)}</strong></div>
        <div className="summary-card"><span>Comprado no mês</span><strong>{money(row.bought)}</strong></div>
        <div className="summary-card"><span>Disponível no mês</span><strong className={row.available < 0 ? "red-text" : "green-text"}>{money(row.available)}</strong></div>
      </div>
      <section className="card buyer-detail-chart-card">
        <div className="card-heading">
          <div>
            <h2>Dias de compra — {buyer}</h2>
            <p>Consumo: <strong className={row.pct > 100 ? "red-text" : "green-text"}>{formatPercent(row.pct)}</strong> · maior volume: dia {peak.day} ({money(peak.value)}).</p>
          </div>
          <BarChart3 size={21} />
        </div>
        {row.bought > 0 ? (
          <div className="buyer-evolution-chart">
            <ChartContainer config={detailConfig} className="buyer-chart-container">
              <LineChart data={detailData} margin={{ top: 12, right: 18, left: 12, bottom: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} interval={0} minTickGap={14} />
                <YAxis tickLine={false} axisLine={false} width={86} tickFormatter={(value) => money(Number(value)).replace(",00", "")} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => `Dia ${String(label).padStart(2, "0")}`} formatter={(value) => <strong>{money(Number(value))}</strong>} />} />
                <Line type="monotone" dataKey="value" name={buyer} stroke={`var(--color-${buyer})`} strokeWidth={2.8} dot={false} activeDot={{ r: 5 }} />
                {peak.value > 0 && <ReferenceDot x={peak.day} y={peak.value} r={7} fill={buyerChartConfig[buyer].color} stroke="#fff" strokeWidth={2} />}
              </LineChart>
            </ChartContainer>
          </div>
        ) : (
          <div className="empty">Nenhuma compra importada para {buyer} neste mês.</div>
        )}
      </section>
    </section>
  );
}

function BuyerDaysChart({ data, period, loading }: { data: BuyerChartPoint[]; period: string; loading: boolean }) {
  const peaks = BUYERS.map((buyer) => {
    const point = data.reduce((best, current) => current[buyer] > best[buyer] ? current : best, data[0] ?? { day: "01", Marcelo: 0, Suellen: 0, "Maurício": 0 });
    return { buyer, day: point.day, value: point[buyer], color: buyerChartConfig[buyer].color };
  });
  const hasPayments = data.some((point) => BUYERS.some((buyer) => point[buyer] > 0));
  return (
    <section className="card buyer-evolution-card">
      <div className="card-heading">
        <div>
          <h2>Dias de compra por comprador</h2>
          <p>{formatMonth(period)} · volume diário de contas a pagar por comprador.</p>
        </div>
        <BarChart3 size={21} />
      </div>
      {loading ? (
        <div className="empty">Carregando gráfico...</div>
      ) : !hasPayments ? (
        <div className="empty">Nenhum pagamento por comprador neste mês.</div>
      ) : (
        <div className="buyer-evolution-chart">
          <ChartContainer config={buyerChartConfig} className="buyer-chart-container">
            <LineChart data={data} margin={{ top: 12, right: 18, left: 12, bottom: 4 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} interval={0} minTickGap={14} />
              <YAxis tickLine={false} axisLine={false} width={86} tickFormatter={(value) => money(Number(value)).replace(",00", "")} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => `Dia ${String(label).padStart(2, "0")}`}
                    formatter={(value, name) => (
                      <div className="buyer-chart-tooltip-row">
                        <span>{buyerChartConfig[String(name) as keyof typeof buyerChartConfig]?.label ?? String(name)}</span>
                        <strong>{money(Number(value))}</strong>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} />
              {BUYERS.map((buyer) => (
                <Line key={buyer} type="monotone" dataKey={buyer} stroke={`var(--color-${buyer})`} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              ))}
              {peaks.filter((peak) => peak.value > 0).map((peak) => (
                <ReferenceDot key={peak.buyer} x={peak.day} y={peak.value} r={6} fill={peak.color} stroke="#fff" strokeWidth={2} />
              ))}
            </LineChart>
          </ChartContainer>
        </div>
      )}
    </section>
  );
}

// AlertTriangle is part of the original imports; referenced here to keep parity.
export const PurchaseWarningIcon = AlertTriangle;
