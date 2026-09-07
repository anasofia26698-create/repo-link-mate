import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, LockKeyhole, Save } from "lucide-react";
import {
  calculateConsumption,
  calculatePurchaseBudget,
  consumptionStatus,
  isPurchaseAccessGranted,
} from "@/lib/purchaseRules";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BUYERS, BUYER_BUSINESS_RULES } from "@/lib/buyerRules";
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

export function GoalsTab() {
  const [goals, setGoals] = useState<Goal[]>(() => read(GOALS_KEY, SECTORS.map(emptyGoal)));
  const update = (index: number, field: keyof Goal, value: string) =>
    setGoals((current) =>
      current.map((goal, i) =>
        i === index
          ? ({
              ...goal,
              [field]: ["sector", "period"].includes(field) ? value : Number(value.replace(",", ".")),
            } as Goal)
          : goal,
      ),
    );
  const save = () => {
    localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
    toast.success("Metas salvas e disponíveis no dashboard.");
  };
  return (
    <PasswordGate>
      <div className="page-heading page-heading-compact">
        <div>
          <p className="eyebrow">Metas compras</p>
          <h1>Cadastro de Metas</h1>
          <p className="subheading">Defina a dotação mensal consolidada das 14 lojas por setor.</p>
        </div>
      </div>
      <section className="card goals-card">
        <div className="card-heading">
          <div>
            <h2>Metas por setor</h2>
            <p>Os valores são consolidados, sem abertura por filial.</p>
          </div>
          <button className="btn btn-dark" onClick={save}>
            <Save size={17} /> Salvar Metas
          </button>
        </div>
        <div className="goals-table-wrap">
          <table className="goals-table">
            <thead>
              <tr>
                <th>Setor</th>
                <th>Período</th>
                <th>Venda prevista</th>
                <th>% CMV alvo</th>
                <th>Estoque inicial</th>
                <th>Estoque final desejado</th>
                <th>Cobertura (dias)</th>
                <th>Giro desejado</th>
              </tr>
            </thead>
            <tbody>
              {goals.map((goal, index) => (
                <tr key={goal.sector}>
                  <td>
                    <strong>{goal.sector}</strong>
                  </td>
                  <td>
                    <input type="month" value={goal.period} onChange={(event) => update(index, "period", event.target.value)} />
                  </td>
                  <td>
                    <input inputMode="decimal" value={goal.sales || ""} placeholder="0,00" onChange={(event) => update(index, "sales", event.target.value)} />
                  </td>
                  <td>
                    <input inputMode="decimal" value={goal.cmv || ""} placeholder="60" onChange={(event) => update(index, "cmv", event.target.value)} />
                  </td>
                  <td>
                    <input inputMode="decimal" value={goal.initialStock || ""} placeholder="0,00" onChange={(event) => update(index, "initialStock", event.target.value)} />
                  </td>
                  <td>
                    <input inputMode="decimal" value={goal.finalStock || ""} placeholder="0,00" onChange={(event) => update(index, "finalStock", event.target.value)} />
                  </td>
                  <td>
                    <input inputMode="decimal" value={goal.coverage || ""} placeholder="0" onChange={(event) => update(index, "coverage", event.target.value)} />
                  </td>
                  <td>
                    <input inputMode="decimal" value={goal.turnover || ""} placeholder="0" onChange={(event) => update(index, "turnover", event.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card rules-card">
        <div className="card-heading">
          <div>
            <h2>Regras de dotação orçamentária e meta diária</h2>
            <p>Base de cálculo do módulo Comprador — mantida visível para consulta.</p>
          </div>
        </div>
        <ul className="rules-list">
          {BUYER_BUSINESS_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </PasswordGate>
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
