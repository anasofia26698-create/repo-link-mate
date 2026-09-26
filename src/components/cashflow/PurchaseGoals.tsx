import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, Calculator, LockKeyhole, Save } from "lucide-react";
import { isPurchaseAccessGranted } from "@/lib/purchaseRules";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUYERS, BUYER_BUSINESS_RULES, CRITICAL_DAYS, CRITICAL_FACTOR, WEEKDAY_LABELS, WEEKDAY_WEIGHTS } from "@/lib/buyerRules";
import { getBuyerGoalConfigs, getBuyerMonthlyOverview, saveBuyerGoalBudget, saveBuyerGoalConfig } from "@/lib/buyer.functions";
import { money, parseBRL } from "./format";

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
type MonthlyBuyerConfig = { sales: string; cmv: string; coverage: string; salesPurchases: string };

const emptyMonthlyConfig = (): MonthlyBuyerConfig => ({ sales: "", cmv: "60", coverage: "", salesPurchases: "" });
const monthLabel = (period: string) => { const [year, month] = period.split("-"); return year && month ? `${month}/${year}` : period; };

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

function BuyerGoalsForm() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [monthly, setMonthly] = useState<Record<string, MonthlyBuyerConfig>>({});
  const [profiles, setProfiles] = useState<Record<string, BuyerProfile>>({});
  const [saving, setSaving] = useState(false);
  const goalConfigs = useQuery({ queryKey: ["buyer-goal-configs", period], queryFn: () => getBuyerGoalConfigs({ data: { period } }) });
  const currentMonthly = BUYERS.reduce<Record<string, MonthlyBuyerConfig>>((result, buyer) => {
    result[buyer] = monthly[`${period}:${buyer}`] ?? emptyMonthlyConfig();
    return result;
  }, {});

  useEffect(() => {
    if (goalConfigs.isLoading) return;
    const nextMonthly: Record<string, MonthlyBuyerConfig> = {};
    for (const buyer of BUYERS) {
      const config = goalConfigs.data?.find((item) => item.buyer === buyer);
      nextMonthly[`${period}:${buyer}`] = config
        ? { sales: money(config.salesCents / 100), cmv: String(config.cmvPercent), coverage: "", salesPurchases: "" }
        : emptyMonthlyConfig();
    }
    setMonthly(nextMonthly);
    setProfiles(Object.fromEntries(BUYERS.map((buyer) => {
      const config = goalConfigs.data?.find((item) => item.buyer === buyer);
      return [buyer, { name: buyer, ips: config?.ips.join(", ") ?? "", active: true }];
    })));
  }, [period, goalConfigs.data, goalConfigs.isLoading]);

  const updateMoney = (value: string, onChange: (value: string) => void) => {
    const next = value.replace(/^R\$\s*/, "");
    const validBRL = /^(?:\d+|\d{1,3}(?:\.\d{3})*)(?:,\d{0,2})?$/;
    if (!next || validBRL.test(next)) onChange(next);
  };
  const save = async () => {
    setSaving(true);
    try {
      const normalizedMonthly: Record<string, MonthlyBuyerConfig> = {};
      for (const buyer of BUYERS) {
        const config = currentMonthly[buyer] ?? emptyMonthlyConfig();
        const rawSales = config.sales.replace(/^R\$\s*/, "");
        const validBRL = /^(?:\d+|\d{1,3}(?:\.\d{3})*)(?:,\d{0,2})?$/;
        if (rawSales && !validBRL.test(rawSales)) throw new Error(`Use o formato brasileiro para a venda de ${buyer} (ex.: 1.400.000,00).`);
        const sales = parseBRL(config.sales);
        const cmv = Number(config.cmv.replace(",", "."));
        const ips = (profiles[buyer]?.ips ?? "").split(/[\s,;]+/).map((ip) => ip.trim().toLowerCase()).filter(Boolean);
        if (!Number.isFinite(sales) || sales < 0 || !Number.isFinite(cmv) || cmv < 0) throw new Error(`Venda e CMV inválidos para ${buyer}.`);
        if (ips.some((ip) => !/^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(ip) && !/^[0-9a-f:]+$/i.test(ip))) throw new Error(`Informe IPs válidos para ${buyer}.`);
        const formattedSales = sales === 0 ? "R$ 0,00" : money(sales);
        normalizedMonthly[`${period}:${buyer}`] = { ...config, sales: formattedSales, cmv: String(cmv) };
        await saveBuyerGoalConfig({ data: { period, buyer, salesCents: Math.round(sales * 100), cmvPercent: cmv, ips } });
        await saveBuyerGoalBudget({ data: { period, buyer, monthlyCents: Math.round(sales * 0.6 * 100) } });
      }
      setMonthly(normalizedMonthly);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["buyer-goal-configs", period] }),
      ]);
      toast.success(`Metas de ${monthLabel(period)} salvas com sucesso.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar as metas.");
    } finally {
      setSaving(false);
    }
  };

  const totalSales = BUYERS.reduce((total, buyer) => total + parseBRL((currentMonthly[buyer] ?? emptyMonthlyConfig()).sales), 0);
  return (
    <>
      <div className="card-heading" style={{ marginBottom: "1rem" }}>
        <label>Período<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button className="btn btn-dark" onClick={save} disabled={saving || goalConfigs.isLoading}><Save size={17} /> {saving ? "Salvando..." : "Salvar"}</button>
      </div>
      <div style={{ display: "block" }}>
        <section className="card goals-card">
          <div className="card-heading"><div><h2>Meta por comprador</h2><p>Venda mensal, CMV informativo e IPs vinculados.</p></div></div>
          <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Comprador</th><th>Venda do mês (R$)</th><th>% CMV alvo</th><th>IPs vinculados</th><th>Dotação mensal</th><th>Participação</th></tr></thead><tbody>
            {BUYERS.map((buyer) => { const config = currentMonthly[buyer] ?? emptyMonthlyConfig(); const sales = parseBRL(config.sales); const allocation = sales * 0.6; const participation = totalSales > 0 ? allocation / (totalSales * 0.6) * 100 : 0; return <tr key={buyer}><td><strong>{buyer}</strong></td><td><input inputMode="decimal" value={config.sales} placeholder="0,00" onChange={(event) => updateMoney(event.target.value, (value) => setMonthly((current) => ({ ...current, [`${period}:${buyer}`]: { ...config, sales: value } })))} onBlur={() => setMonthly((current) => ({ ...current, [`${period}:${buyer}`]: { ...config, sales: config.sales ? money(parseBRL(config.sales)) : "" } }))} /></td><td><input inputMode="decimal" value={config.cmv} placeholder="60" onChange={(event) => setMonthly((current) => ({ ...current, [`${period}:${buyer}`]: { ...config, cmv: event.target.value.replace(/[^\d,]/g, "") } }))} />%</td><td><input value={profiles[buyer]?.ips ?? ""} placeholder="IPs" onChange={(event) => setProfiles((current) => ({ ...current, [buyer]: { ...(current[buyer] ?? { name: buyer, active: true }), ips: event.target.value } }))} /></td><td><strong>{money(allocation)}</strong></td><td><strong>{participation.toFixed(2).replace(".", ",")} %</strong></td></tr>; })}
          </tbody></table></div>
        </section>
      </div>
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
    </>
  );
}

export function PurchasesDashboardTab({ requireBuyerAccess = true }: { requireBuyerAccess?: boolean } = {}) {
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const [period, setPeriod] = useState(currentPeriod);
  const overview = useQuery({
    queryKey: ["buyer-monthly-overview"],
    queryFn: () => getBuyerMonthlyOverview(),
    refetchInterval: 300_000,
    refetchIntervalInBackground: true,
  });
  const periods = useMemo(() => {
    const fixed = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"];
    const imported = (overview.data?.payments ?? []).map((item) => item.date.slice(0, 7));
    const configured = (overview.data?.budgets ?? []).map((item) => item.period);
    return [...new Set([...fixed, currentPeriod, ...imported, ...configured])]
      .filter((item) => item >= "2026-09")
      .sort();
  }, [currentPeriod, overview.data]);
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
  const totals = rows.reduce(
    (total, row) => ({ budget: total.budget + row.budget, bought: total.bought + row.bought }),
    { budget: 0, bought: 0 },
  );
  const balance = totals.budget - totals.bought;
  const consumption = totals.budget > 0 ? totals.bought / totals.budget * 100 : totals.bought > 0 ? 100 : 0;
  const consumptionTone = consumption > 100 ? "progress-danger" : consumption >= 80 ? "progress-warning" : "";
  return (
    <PasswordGate skip={!requireBuyerAccess}>
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
      <div className="purchase-kpis">
        <div className="summary-card">
          <span>Dotação total</span>
          <strong>{money(totals.budget)}</strong>
        </div>
        <div className="summary-card">
          <span>Comprado total</span>
          <strong>{money(totals.bought)}</strong>
        </div>
        <div className="summary-card">
          <span>Saldo disponível</span>
          <strong className={balance < 0 ? "red-text" : "green-text"}>{money(balance)}</strong>
        </div>
        <div className="summary-card consumption-card">
          <span>Consumo geral</span>
          <strong>{formatPercent(consumption)}</strong>
          <div className="general-progress-track" aria-label={`Consumo geral de ${formatPercent(consumption)}`}>
            <div className={`general-progress-fill ${consumptionTone}`} style={{ width: `${Math.min(100, Math.max(0, consumption))}%` }} />
          </div>
        </div>
      </div>
      <BuyerMonthlyPanel rows={rows} period={period} loading={overview.isLoading} />
    </PasswordGate>
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

function BuyerMonthlyPanel({ rows, period, loading }: { rows: BuyerMonthlyRow[]; period: string; loading: boolean }) {
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
                <strong>{row.buyer}</strong>
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

// AlertTriangle is part of the original imports; referenced here to keep parity.
export const PurchaseWarningIcon = AlertTriangle;
