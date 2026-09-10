import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, Calculator, LockKeyhole, Save } from "lucide-react";
import {
  calculateConsumption,
  calculatePurchaseBudget,
  consumptionStatus,
  isPurchaseAccessGranted,
} from "@/lib/purchaseRules";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUYERS, BUYER_BUSINESS_RULES, CRITICAL_DAYS, CRITICAL_FACTOR, WEEKDAY_LABELS, WEEKDAY_WEIGHTS } from "@/lib/buyerRules";
import { getBuyerGoalConfigs, getBuyerMonthlyOverview, getLineGoals, saveBuyerGoalBudget, saveBuyerGoalConfig, saveLineGoals } from "@/lib/buyer.functions";
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
type Purchase = { id: string; date: string; sector: Sector; supplier: string; value: number; invoice: string };

const GOALS_KEY = "signal-cash-purchase-goals-v1";
const PURCHASES_KEY = "signal-cash-purchases-v1";

function read<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

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

function PasswordGate({ children }: { children: ReactNode }) {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  if (unlocked) return <>{children}</>;
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
type LineGoalForm = { id?: number; lineName: string; sales: string };

const emptyMonthlyConfig = (): MonthlyBuyerConfig => ({ sales: "", cmv: "60", coverage: "", salesPurchases: "" });
const monthLabel = (period: string) => { const [year, month] = period.split("-"); return year && month ? `${month}/${year}` : period; };

export function GoalsTab() {
  return (
    <PasswordGate>
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
  const [lineGoals, setLineGoals] = useState<LineGoalForm[]>(() => SECTORS.map((lineName) => ({ lineName, sales: "" })));
  const [saving, setSaving] = useState(false);
  const goalConfigs = useQuery({ queryKey: ["buyer-goal-configs", period], queryFn: () => getBuyerGoalConfigs({ data: { period } }) });
  const storedLineGoals = useQuery({ queryKey: ["line-goals", period], queryFn: () => getLineGoals({ data: { period } }) });
  const currentMonthly = BUYERS.reduce<Record<string, MonthlyBuyerConfig>>((result, buyer) => {
    result[buyer] = monthly[`${period}:${buyer}`] ?? emptyMonthlyConfig();
    return result;
  }, {});

  useEffect(() => {
    if (goalConfigs.isLoading || storedLineGoals.isLoading) return;
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
    const savedLines = storedLineGoals.data ?? [];
    setLineGoals(SECTORS.map((lineName) => {
      const saved = savedLines.find((line) => line.lineName === lineName);
      return { id: saved?.id, lineName, sales: saved ? money(saved.salesCents / 100) : "" };
    }));
  }, [period, goalConfigs.data, goalConfigs.isLoading, storedLineGoals.data, storedLineGoals.isLoading]);

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
        const config = currentMonthly[buyer];
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
      const linePayload = lineGoals.map((line) => {
        const rawSales = line.sales.replace(/^R\$\s*/, "");
        const validBRL = /^(?:\d+|\d{1,3}(?:\.\d{3})*)(?:,\d{0,2})?$/;
        if (rawSales && !validBRL.test(rawSales)) throw new Error(`Use o formato brasileiro para a venda da linha ${line.lineName}.`);
        return { id: line.id, lineName: line.lineName, salesCents: Math.round(parseBRL(line.sales) * 100) };
      });
      if (linePayload.some((line) => !Number.isFinite(line.salesCents) || line.salesCents < 0)) throw new Error("Informe valores válidos para as metas por linha.");
      await saveLineGoals({ data: { period, goals: linePayload } });
      setMonthly(normalizedMonthly);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["buyer-goal-configs", period] }),
        queryClient.invalidateQueries({ queryKey: ["line-goals", period] }),
      ]);
      toast.success(`Metas de ${monthLabel(period)} salvas com sucesso.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar as metas.");
    } finally {
      setSaving(false);
    }
  };

  const totalSales = BUYERS.reduce((total, buyer) => total + parseBRL(currentMonthly[buyer].sales), 0);
  return (
    <>
      <div className="card-heading" style={{ marginBottom: "1rem" }}>
        <label>Período<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        <button className="btn btn-dark" onClick={save} disabled={saving || goalConfigs.isLoading || storedLineGoals.isLoading}><Save size={17} /> {saving ? "Salvando..." : "Salvar"}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1.25rem", alignItems: "start" }}>
        <section className="card goals-card">
          <div className="card-heading"><div><h2>Metas por linha</h2><p>Preencha a venda prevista para cada linha.</p></div></div>
          <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Linha</th><th>Venda prevista (R$)</th></tr></thead><tbody>
            {lineGoals.map((line, index) => <tr key={line.lineName}><td><strong>{line.lineName}</strong></td><td><input inputMode="decimal" value={line.sales} placeholder="0,00" onChange={(event) => updateMoney(event.target.value, (value) => setLineGoals((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, sales: value } : item)))} onBlur={() => setLineGoals((current) => current.map((item, itemIndex) => itemIndex === index && item.sales ? { ...item, sales: money(parseBRL(item.sales)) } : item))} /></td></tr>)}
          </tbody></table></div>
        </section>
        <section className="card goals-card">
          <div className="card-heading"><div><h2>Meta por comprador</h2><p>Venda mensal, CMV informativo e IPs vinculados.</p></div></div>
          <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Comprador</th><th>Venda do mês (R$)</th><th>% CMV alvo</th><th>IPs vinculados</th><th>Dotação mensal</th><th>Participação</th></tr></thead><tbody>
            {BUYERS.map((buyer) => { const config = currentMonthly[buyer]; const sales = parseBRL(config.sales); const allocation = sales * 0.6; const participation = totalSales > 0 ? allocation / (totalSales * 0.6) * 100 : 0; return <tr key={buyer}><td><strong>{buyer}</strong></td><td><input inputMode="decimal" value={config.sales} placeholder="0,00" onChange={(event) => updateMoney(event.target.value, (value) => setMonthly((current) => ({ ...current, [`${period}:${buyer}`]: { ...config, sales: value } })))} onBlur={() => setMonthly((current) => ({ ...current, [`${period}:${buyer}`]: { ...config, sales: config.sales ? money(parseBRL(config.sales)) : "" } }))} /></td><td><input inputMode="decimal" value={config.cmv} placeholder="60" onChange={(event) => setMonthly((current) => ({ ...current, [`${period}:${buyer}`]: { ...config, cmv: event.target.value.replace(/[^\d,]/g, "") } }))} />%</td><td><input value={profiles[buyer]?.ips ?? ""} placeholder="IPs" onChange={(event) => setProfiles((current) => ({ ...current, [buyer]: { ...(current[buyer] ?? { name: buyer, active: true }), ips: event.target.value } }))} /></td><td><strong>{money(allocation)}</strong></td><td><strong>{participation.toFixed(2).replace(".", ",")} %</strong></td></tr>; })}
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

export function PurchasesDashboardTab() {
  const [goals] = useState<Goal[]>(() => read(GOALS_KEY, SECTORS.map(emptyGoal)));
  const [purchases] = useState<Purchase[]>(() => read(PURCHASES_KEY, []));
  const rows = goals.map((goal) => {
    const budget = calculatePurchaseBudget(goal.sales, goal.cmv, goal.initialStock, goal.finalStock);
    const bought = purchases.filter((item) => item.sector === goal.sector).reduce((sum, item) => sum + item.value, 0);
    const consumption = calculateConsumption(budget, bought);
    return { ...goal, budget, bought, balance: budget - bought, consumption };
  });
  const totals = rows.reduce(
    (acc, row) => ({ budget: acc.budget + row.budget, bought: acc.bought + row.bought, balance: acc.balance + row.balance }),
    { budget: 0, bought: 0, balance: 0 },
  );
  return (
    <PasswordGate>
      <div className="page-heading page-heading-compact">
        <div>
          <p className="eyebrow">Metas compras</p>
          <h1>Dashboard de Compras</h1>
          <p className="subheading">Acompanhamento consolidado da dotação das 14 lojas.</p>
        </div>
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
          <strong className={totals.balance < 0 ? "red-text" : "green-text"}>{money(totals.balance)}</strong>
        </div>
        <div className="summary-card">
          <span>Consumo geral</span>
          <strong>{totals.budget > 0 ? (totals.bought / totals.budget * 100).toFixed(1) : "0,0"}%</strong>
        </div>
      </div>
      <section className="card purchase-dashboard-card">
        <div className="card-heading">
          <div>
            <h2>Dotação por setor</h2>
            <p>CMV orçado = venda prevista × CMV alvo. Dotação = CMV + variação de estoque.</p>
          </div>
          <BarChart3 size={21} />
        </div>
        <div className="sector-list">
          {rows.map((row) => (
            <div className="sector-row" key={row.sector}>
              <div className="sector-row-title">
                <strong>{row.sector}</strong>
                <span>
                  {consumptionStatus(row.consumption) === "danger"
                    ? "Acima da dotação"
                    : consumptionStatus(row.consumption) === "warning"
                      ? "Atenção"
                      : "Dentro do planejado"}
                </span>
              </div>
              <div className="sector-metrics">
                <span>
                  Dotação <b>{money(row.budget)}</b>
                </span>
                <span>
                  Comprado <b>{money(row.bought)}</b>
                </span>
                <span>
                  Saldo <b className={row.balance < 0 ? "red-text" : "green-text"}>{money(row.balance)}</b>
                </span>
                <span>
                  Consumo <b>{row.consumption.toFixed(1)}%</b>
                </span>
              </div>
              <div className="progress-track">
                <div
                  className={
                    consumptionStatus(row.consumption) === "danger"
                      ? "progress-fill progress-danger"
                      : consumptionStatus(row.consumption) === "warning"
                        ? "progress-fill progress-warning"
                        : "progress-fill"
                  }
                  style={{ width: `${Math.min(100, row.consumption)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      <BuyerMonthlyPanel />
    </PasswordGate>
  );
}

function BuyerMonthlyPanel() {
  const period = new Date().toISOString().slice(0, 7);
  const overview = useQuery({ queryKey: ["buyer-monthly-overview"], queryFn: () => getBuyerMonthlyOverview() });
  const budgets = overview.data?.budgets ?? [];
  const payments = overview.data?.payments ?? [];
  const rows = BUYERS.map((buyer: (typeof BUYERS)[number]) => {
    const found = budgets.find((item) => item.period === period && item.buyer === buyer) ?? budgets.find((item) => item.buyer === buyer);
    const budget = (found?.monthlyCents ?? 0) / 100;
    const usedPeriod = found?.period ?? period;
    const bought =
      payments
        .filter((item) => item.buyer === buyer && item.date.slice(0, 7) === usedPeriod)
        .reduce((sum, item) => sum + item.amountCents, 0) / 100;
    const pct = budget > 0 ? (bought / budget) * 100 : 0;
    return { buyer, budget, bought, available: budget - bought, pct, period: usedPeriod };
  });
  return (
    <section className="card">
      <div className="card-heading">
        <div>
          <h2>Atingimento mensal por comprador</h2>
          <p>Dotação orçamentária do módulo Comprador (Marcelo, Suellen e Maurício).</p>
        </div>
        <BarChart3 size={21} />
      </div>
      <div className="buyer-month-list">
        {overview.isLoading && <div className="empty">Carregando dotação por comprador...</div>}
        {!overview.isLoading &&
          rows.map((row) => (
            <div className="buyer-month-row" key={row.buyer}>
              <div className="buyer-month-head">
                <strong>{row.buyer}</strong>
                <span>
                  {row.period} · {row.pct.toFixed(1).replace(".", ",")}%
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
                  className={"buyer-month-fill " + (row.pct >= 100 ? "over" : row.pct >= 80 ? "warn" : "")}
                  style={{ width: `${Math.min(100, Math.max(0, row.pct))}%` }}
                />
              </div>
              {row.pct >= 100 ? (
                <div className="buyer-month-warning">Dotação mensal ultrapassada ({row.pct.toFixed(1).replace(".", ",")}%).</div>
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
