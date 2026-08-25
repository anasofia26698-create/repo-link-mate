import { useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, BarChart3, LockKeyhole, Save, Trash2, Upload } from "lucide-react";
import {
  calculateConsumption,
  calculatePurchaseBudget,
  consumptionStatus,
  isPurchaseAccessGranted,
} from "@/lib/purchaseRules";
import { toast } from "sonner";
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
    </PasswordGate>
  );
}

export function PurchasesDashboardTab() {
  const [goals] = useState<Goal[]>(() => read(GOALS_KEY, SECTORS.map(emptyGoal)));
  const [purchases, setPurchases] = useState<Purchase[]>(() => read(PURCHASES_KEY, []));
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    sector: SECTORS[0] as Sector,
    supplier: "",
    value: "",
    invoice: "",
  });
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
  const savePurchase = () => {
    const value = parseBRL(form.value);
    if (!form.date || !form.supplier || value <= 0) return toast.error("Informe data, fornecedor e valor válido.");
    const next = [...purchases, { id: crypto.randomUUID(), date: form.date, sector: form.sector, supplier: form.supplier, value, invoice: form.invoice }];
    setPurchases(next);
    localStorage.setItem(PURCHASES_KEY, JSON.stringify(next));
    setForm({ ...form, supplier: "", value: "", invoice: "" });
    toast.success("Compra registrada.");
  };
  const removePurchase = (id: string) => {
    const next = purchases.filter((item) => item.id !== id);
    setPurchases(next);
    localStorage.setItem(PURCHASES_KEY, JSON.stringify(next));
  };
  const importPurchases = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result, { type: "array", cellDates: true });
        const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
        const headers = (sheetRows[0] || []).map((header) =>
          String(header).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
        );
        const idx = {
          date: headers.findIndex((header) => header.includes("data")),
          sector: headers.findIndex((header) => header.includes("setor")),
          supplier: headers.findIndex((header) => header.includes("fornecedor")),
          value: headers.findIndex((header) => header.includes("valor")),
          invoice: headers.findIndex((header) => header.includes("nota")),
        };
        const valid = sheetRows
          .slice(1)
          .map((row) => {
            const date = row[idx.date] instanceof Date ? (row[idx.date] as Date).toISOString().slice(0, 10) : String(row[idx.date] || "");
            const sector = SECTORS.find((item) => item.toLowerCase() === String(row[idx.sector] || "").toLowerCase()) || SECTORS[0];
            const value = typeof row[idx.value] === "number" ? (row[idx.value] as number) : parseBRL(String(row[idx.value] || ""));
            return date && value > 0
              ? {
                  id: crypto.randomUUID(),
                  date,
                  sector,
                  supplier: String(row[idx.supplier] || "Não informado"),
                  value,
                  invoice: String(row[idx.invoice] || ""),
                }
              : null;
          })
          .filter(Boolean) as Purchase[];
        const next = [...purchases, ...valid];
        setPurchases(next);
        localStorage.setItem(PURCHASES_KEY, JSON.stringify(next));
        toast.success(`${valid.length} compra(s) importada(s).`);
      } catch {
        toast.error("Não foi possível ler o arquivo de compras.");
      }
    };
    reader.readAsArrayBuffer(file);
  };
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
      <section className="card purchase-entry-card">
        <div className="card-heading">
          <div>
            <h2>Registrar compras realizadas</h2>
            <p>Importe ou registre as compras do mês para alimentar o dashboard.</p>
          </div>
          <label className="upload-small">
            <Upload size={16} /> Importar
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => importPurchases(event.target.files?.[0])} />
          </label>
        </div>
        <div className="purchase-form">
          <label>
            Data
            <input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </label>
          <label>
            Setor
            <select value={form.sector} onChange={(event) => setForm({ ...form, sector: event.target.value as Sector })}>
              {SECTORS.map((sector) => (
                <option key={sector}>{sector}</option>
              ))}
            </select>
          </label>
          <label>
            Fornecedor
            <input value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} />
          </label>
          <label>
            Valor (R$)
            <input inputMode="decimal" placeholder="0,00" value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
          </label>
          <label>
            Nº da Nota
            <input value={form.invoice} onChange={(event) => setForm({ ...form, invoice: event.target.value })} />
          </label>
          <button className="btn btn-dark" onClick={savePurchase}>
            Registrar
          </button>
        </div>
        <div className="purchase-list">
          {purchases.map((item) => (
            <div className="purchase-item" key={item.id}>
              <span>
                <strong>{item.sector}</strong> · {item.supplier}
                <small>
                  {item.date} · NF {item.invoice || "—"}
                </small>
              </span>
              <b>{money(item.value)}</b>
              <button className="icon-btn" onClick={() => removePurchase(item.id)} aria-label="Excluir compra">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {!purchases.length && <div className="empty">Nenhuma compra registrada neste navegador.</div>}
        </div>
      </section>
    </PasswordGate>
  );
}

// AlertTriangle is part of the original imports; referenced here to keep parity.
export const PurchaseWarningIcon = AlertTriangle;
