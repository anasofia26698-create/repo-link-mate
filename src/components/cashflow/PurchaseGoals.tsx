import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CalendarDays, Calculator, LockKeyhole, Save, Users } from "lucide-react";
import {
  calculateConsumption,
  calculatePurchaseBudget,
  consumptionStatus,
  isPurchaseAccessGranted,
} from "@/lib/purchaseRules";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUYERS, BUYER_BUSINESS_RULES, CRITICAL_DAYS, CRITICAL_FACTOR, WEEKDAY_LABELS, WEEKDAY_WEIGHTS } from "@/lib/buyerRules";
import { getBuyerMonthlyOverview, saveBuyerGoalBudget } from "@/lib/buyer.functions";
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

const BUYER_PROFILES_KEY = "signal-cash-buyer-profiles-v1";
const BUYER_MONTHLY_CONFIG_KEY = "signal-cash-buyer-monthly-config-v1";
const BUYER_PARAMETERS_KEY = "signal-cash-buyer-parameters-v1";
const DEFAULT_PROFILES: Record<string, BuyerProfile> = Object.fromEntries(
  BUYERS.map((name) => [name, { name, ips: "", active: true }]),
);
const DEFAULT_PARAMETERS = {
  allocationPercent: "60",
  criticalDays: CRITICAL_DAYS.join(", "),
  criticalFactor: "85",
  compensation: false,
};

const emptyMonthlyConfig = (): MonthlyBuyerConfig => ({ sales: "", cmv: "60", coverage: "", salesPurchases: "" });
const monthLabel = (period: string) => {
  const [year, month] = period.split("-");
  return year && month ? `${month}/${year}` : period;
};
const numericValue = (value: string) => Number(value.replace(/\./g, "").replace(",", ".")) || 0;
const formatInput = (value: number) => value.toFixed(2).replace(".", ",");
const moneyFromCents = (cents: number) => money(cents / 100);

type BuyerProfile = { name: string; ips: string; active: boolean };
type MonthlyBuyerConfig = { sales: string; cmv: string; coverage: string; salesPurchases: string };

const BUYER_PROFILES_KEY = "signal-cash-buyer-profiles-v1";
const BUYER_MONTHLY_CONFIG_KEY = "signal-cash-buyer-monthly-config-v1";
const BUYER_PARAMETERS_KEY = "signal-cash-buyer-parameters-v1";
const DEFAULT_PROFILES: Record<string, BuyerProfile> = Object.fromEntries(
  BUYERS.map((name) => [name, { name, ips: "", active: true }]),
);
const DEFAULT_PARAMETERS = {
  allocationPercent: "60",
  criticalDays: CRITICAL_DAYS.join(", "),
  criticalFactor: "85",
  compensation: false,
};

const emptyMonthlyConfig = (): MonthlyBuyerConfig => ({ sales: "", cmv: "60", coverage: "", salesPurchases: "" });
const monthLabel = (period: string) => {
  const [year, month] = period.split("-");
  return year && month ? `${month}/${year}` : period;
};
const numericValue = (value: string) => Number(value.replace(/\./g, "").replace(",", ".")) || 0;
const formatInput = (value: number) => value.toFixed(2).replace(".", ",");
const moneyFromCents = (cents: number) => money(cents / 100);

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
  const [profiles, setProfiles] = useState<Record<string, BuyerProfile>>(() => read(BUYER_PROFILES_KEY, DEFAULT_PROFILES));
  const [monthly, setMonthly] = useState<Record<string, MonthlyBuyerConfig>>(() => read(BUYER_MONTHLY_CONFIG_KEY, {}));
  const [parameters, setParameters] = useState(() => read(BUYER_PARAMETERS_KEY, DEFAULT_PARAMETERS));
  const [saving, setSaving] = useState(false);
  const overview = useQuery({ queryKey: ["buyer-monthly-overview"], queryFn: () => getBuyerMonthlyOverview() });
  const budgets = overview.data?.budgets ?? [];
  const currentMonthly = BUYERS.reduce<Record<string, MonthlyBuyerConfig>>((result, buyer) => {
    result[buyer] = monthly[`${period}:${buyer}`] ?? emptyMonthlyConfig();
    return result;
  }, {});

  useEffect(() => {
    const next = { ...monthly };
    for (const buyer of BUYERS) {
      const key = `${period}:${buyer}`;
      if (!next[key]) {
        const found = budgets.find((item) => item.period === period && item.buyer === buyer);
        next[key] = found ? { ...emptyMonthlyConfig(), sales: formatInput(found.monthlyCents / 100 / 0.6) } : emptyMonthlyConfig();
      }
    }
    setMonthly(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, overview.dataUpdatedAt]);

  const updateMonthly = (buyer: string, field: keyof MonthlyBuyerConfig, value: string) => {
    const key = `${period}:${buyer}`;
    setMonthly((current) => ({ ...current, [key]: { ...(current[key] ?? emptyMonthlyConfig()), [field]: value } }));
  };
  const updateProfile = (buyer: string, field: keyof BuyerProfile, value: string | boolean) => {
    setProfiles((current) => ({ ...current, [buyer]: { ...(current[buyer] ?? DEFAULT_PROFILES[buyer]), [field]: value } }));
  };
  const save = async () => {
    setSaving(true);
    try {
      localStorage.setItem(BUYER_PROFILES_KEY, JSON.stringify(profiles));
      localStorage.setItem(BUYER_MONTHLY_CONFIG_KEY, JSON.stringify(monthly));
      localStorage.setItem(BUYER_PARAMETERS_KEY, JSON.stringify(parameters));
      for (const buyer of BUYERS) {
        const monthlyConfig = currentMonthly[buyer];
        const monthlyCents = Math.round(numericValue(monthlyConfig.sales) * (numericValue(parameters.allocationPercent) / 100) * 100);
        await saveBuyerGoalBudget({ data: { period, buyer, monthlyCents } });
      }
      await queryClient.invalidateQueries({ queryKey: ["buyer-monthly-overview"] });
      toast.success("Cadastro de metas salvo e cálculos atualizados.");
    } catch {
      toast.error("Não foi possível salvar o cadastro de metas.");
    } finally {
      setSaving(false);
    }
  };

  const allocationPercent = numericValue(parameters.allocationPercent) / 100;
  return (
    <>
      <section className="card goals-card">
        <div className="card-heading">
          <div><h2><Users size={20} /> 1. Cadastro dos compradores</h2><p>Configure uma vez. Cada IP deve pertencer a um único comprador.</p></div>
        </div>
        <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Nome do comprador</th><th>IPs vinculados</th><th>Status</th></tr></thead><tbody>
          {BUYERS.map((buyer) => { const profile = profiles[buyer] ?? DEFAULT_PROFILES[buyer]; return <tr key={buyer}>
            <td><strong>{buyer}</strong></td>
            <td><input value={profile.ips} placeholder="Ex.: 192.168.0.10, 192.168.0.11" onChange={(event) => updateProfile(buyer, "ips", event.target.value)} /></td>
            <td><label><input type="checkbox" checked={profile.active} onChange={(event) => updateProfile(buyer, "active", event.target.checked)} /> Ativo</label></td>
          </tr>; })}
        </tbody></table></div>
      </section>

      <section className="card goals-card">
        <div className="card-heading">
          <div><h2><CalendarDays size={20} /> 2. Configuração mensal</h2><p>Informe a venda do mês; os demais valores são informativos e a dotação é calculada automaticamente.</p></div>
          <label>Período<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>
        </div>
        <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Comprador</th><th>Venda do mês (R$)</th><th>% CMV alvo</th><th>Cobertura (dias)</th><th>Venda × Compras</th><th>Dotação calculada</th></tr></thead><tbody>
          {BUYERS.map((buyer) => { const config = currentMonthly[buyer]; const allocation = numericValue(config.sales) * allocationPercent; return <tr key={buyer}>
            <td><strong>{buyer}</strong></td>
            <td><input inputMode="decimal" value={config.sales} placeholder="0,00" onChange={(event) => updateMonthly(buyer, "sales", event.target.value)} /></td>
            <td><input inputMode="decimal" value={config.cmv} placeholder="60" onChange={(event) => updateMonthly(buyer, "cmv", event.target.value)} /></td>
            <td><input inputMode="decimal" value={config.coverage} placeholder="—" onChange={(event) => updateMonthly(buyer, "coverage", event.target.value)} /></td>
            <td><input inputMode="decimal" value={config.salesPurchases} placeholder="—" onChange={(event) => updateMonthly(buyer, "salesPurchases", event.target.value)} /></td>
            <td><strong>{money(allocation)}</strong><small> venda × {parameters.allocationPercent}%</small></td>
          </tr>; })}
        </tbody></table></div>
      </section>

      <section className="card goals-card">
        <div className="card-heading"><div><h2><Calculator size={20} /> 3. Parâmetros fixos</h2><p>Configurados uma vez e usados nos cálculos automáticos.</p></div></div>
        <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Parâmetro</th><th>Valor</th><th>Descrição</th></tr></thead><tbody>
          <tr><td><strong>Percentual de dotação sobre a venda</strong></td><td><input inputMode="decimal" value={parameters.allocationPercent} onChange={(event) => setParameters((current) => ({ ...current, allocationPercent: event.target.value }))} />%</td><td>Meta de compras mensal.</td></tr>
          <tr><td><strong>Dias críticos de pagamento</strong></td><td><input value={parameters.criticalDays} onChange={(event) => setParameters((current) => ({ ...current, criticalDays: event.target.value }))} /></td><td>Folha, contas, impostos e adiantamentos.</td></tr>
          <tr><td><strong>Redutor do dia crítico</strong></td><td><input inputMode="decimal" value={parameters.criticalFactor} onChange={(event) => setParameters((current) => ({ ...current, criticalFactor: event.target.value }))} />%</td><td>Aplicado sobre a meta normal.</td></tr>
          <tr><td><strong>Folga recuperável / compensação</strong></td><td><label><input type="checkbox" checked={parameters.compensation} onChange={(event) => setParameters((current) => ({ ...current, compensation: event.target.checked }))} /> Ativada</label></td><td>Desativada: cada dia tem teto independente.</td></tr>
        </tbody></table></div>
        <div className="card-heading"><div><h3>Pesos por dia da semana</h3><p>Distribuição da dotação mensal. Os pesos podem ser ajustados em <code>buyerRules</code> quando houver validação do negócio.</p></div></div>
        <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Domingo</th><th>Segunda</th><th>Terça</th><th>Quarta</th><th>Quinta</th><th>Sexta</th><th>Sábado</th></tr></thead><tbody><tr>{WEEKDAY_LABELS.map((label, index) => <td key={label}><strong>{label}</strong><br />{(WEEKDAY_WEIGHTS[index] * 100).toFixed(2).replace(".", ",")}%</td>)}</tr></tbody></table></div>
      </section>

      <section className="card goals-card">
        <div className="card-heading"><div><h2>Prévia dos cálculos automáticos — {monthLabel(period)}</h2><p>Meta normal = dotação × peso do dia. No dia crítico, aplica-se {parameters.criticalFactor}%.</p></div><button className="btn btn-dark" onClick={save} disabled={saving}><Save size={17} /> {saving ? "Salvando..." : "Salvar cadastro"}</button></div>
        <div className="goals-table-wrap"><table className="goals-table"><thead><tr><th>Comprador</th><th>Venda</th><th>Dotação mensal</th><th>Meta domingo</th><th>Meta segunda</th><th>Meta dia crítico</th></tr></thead><tbody>{BUYERS.map((buyer) => { const sales = numericValue(currentMonthly[buyer].sales); const allocation = sales * allocationPercent; return <tr key={buyer}><td><strong>{buyer}</strong></td><td>{money(sales)}</td><td>{money(allocation)}</td><td>{money(allocation * WEEKDAY_WEIGHTS[0])}</td><td>{money(allocation * WEEKDAY_WEIGHTS[1])}</td><td>{money(allocation * WEEKDAY_WEIGHTS[1] * (numericValue(parameters.criticalFactor) / 100))}</td></tr>; })}</tbody></table></div>
        <p className="muted">Os valores salvos alimentam o Dashboard de Compras e a comparação diária do Fluxo de Caixa por Comprador.</p>
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
  const rows = BUYERS.map((buyer) => {
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
