import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AlertTriangle, Menu, X } from "lucide-react";
import { isTemporaryEntryActive } from "@/lib/flowRules";
import {
  calculateDaysFromReference,
  getAutomaticRecoveryForDate,
  getOctoberBudgetExceededCents,
  getPurchaseLimitForDate,
  getMonthlyPurchaseDay,
  isFrozenFlowDate,
  parsePaymentDates,
  OCTOBER_TIGHTENING_FACTOR,
  OCTOBER_TIGHTENING_THRESHOLD,
} from "@/lib/simulationRules";
import { confirmPurchases, listAuditPurchaseBudgets, listCashFlow, recordAccess, recordSimulation, replaceImport } from "@/lib/cashflow.functions";
import { AuditTab } from "@/components/cashflow/AuditTab";
import { GoalsTab, PurchasesDashboardTab } from "@/components/cashflow/PurchaseGoals";
import { ImportTab } from "@/components/cashflow/ImportTab";
import { BuyerModule } from "@/components/buyer/BuyerModule";
import { criticalLabel, dateBR, dayMonthBR, iso, money, parseBRL, parseTerms } from "@/components/cashflow/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fluxo de Caixa — Contas a pagar" },
      {
        name: "description",
        content:
          "Simule compras futuras, importe a planilha de débitos e acompanhe metas e auditoria do fluxo de caixa das 14 lojas.",
      },
      { property: "og:title", content: "Fluxo de Caixa — Contas a pagar" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        property: "og:description",
        content: "Simulação de compras, importação de planilhas, metas por setor e auditoria de acessos.",
      },
    ],
  }),
  component: HomePage,
});

type Entry = { id: string; date: string; debit: number; source: "imported" | "manual"; createdAt?: number };
type Tab = "fluxo" | "importar" | "metas" | "dashboard" | "auditoria" | "comprador";

const AUDIT_ACCESS_SESSION_KEY = "signal-cash-audit-access-recorded";
const FLOW_MONTHS = ["2026-11", "2026-12", "2027-01", "2027-02"] as const;
const FLOW_MONTH_LABELS: Record<string, string> = { "2026-11": "Novembro/2026", "2026-12": "Dezembro/2026", "2027-01": "Janeiro/2027", "2027-02": "Fevereiro/2027" };
function getTightenedFlowLimit(date: string, debit: number, factor: number) {
  const target = getPurchaseLimitForDate(date);
  if (!date.startsWith("2026-10") || target.isCritical || debit > target.limit) return target;
  const currentFree = target.limit - debit;
  const newFree = currentFree <= OCTOBER_TIGHTENING_THRESHOLD ? 0 : currentFree * factor;
  return { ...target, limit: debit + newFree };
}

const CRITICAL_DAYS_INFO = [
  { day: 5, label: "Folha de pagamento" },
  { day: 10, label: "Custos altos (aluguel, luz, água...)" },
  { day: 15, label: "Impostos" },
  { day: 20, label: "Adiantamento + impostos" },
  { day: 25, label: "Impostos" },
] as const;

function nextCriticalDate(day: number, from: string) {
  const base = new Date(`${from}T12:00:00`);
  let candidate = new Date(base.getFullYear(), base.getMonth(), day, 12);
  if (candidate.getTime() < base.getTime()) candidate = new Date(base.getFullYear(), base.getMonth() + 1, day, 12);
  return iso(candidate);
}

function HomePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("fluxo");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [today, setToday] = useState(iso(new Date()));
  const [selectedFlowMonth, setSelectedFlowMonth] = useState("2026-11");
  const [displayToday, setDisplayToday] = useState(() => iso(new Date()));
  const [purchaseInput, setPurchaseInput] = useState("48.000,00");
  const [termsInput, setTermsInput] = useState("30, 60, 90");
  const [simulationMode, setSimulationMode] = useState<"terms" | "dates">("terms");
  const [paymentDatesInput, setPaymentDatesInput] = useState("");
  const [simulated, setSimulated] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedTerms, setSelectedTerms] = useState<number[]>([]);
  const [actorName, setActorName] = useState("");
  const [importSummary, setImportSummary] = useState<{ count: number; start: string; end: string; total: number } | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const octoberTighteningFactor = OCTOBER_TIGHTENING_FACTOR;

  const sharedFlow = useQuery({
    queryKey: ["cash-flow-entries"],
    queryFn: () => listCashFlow(),
    refetchInterval: 300_000,
    refetchIntervalInBackground: true,
  });
  const auditBudgets = useQuery({ queryKey: ["audit-purchase-budgets"], queryFn: () => listAuditPurchaseBudgets() });

  const toEntry = (entry: { id: number; date: string; debitCents: number; source: "imported" | "manual"; createdAt: string }): Entry => ({
    id: String(entry.id),
    date: entry.date,
    debit: entry.debitCents / 100,
    source: entry.source,
    createdAt: new Date(entry.createdAt).getTime(),
  });

  useEffect(() => {
    if (sharedFlow.data) setEntries(sharedFlow.data.map(toEntry));
  }, [sharedFlow.data]);


  useEffect(() => {
    const refreshDisplayDate = () => setDisplayToday(iso(new Date()));
    const timer = window.setInterval(refreshDisplayDate, 60_000);
    refreshDisplayDate();
    return () => window.clearInterval(timer);
  }, []);


  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(AUDIT_ACCESS_SESSION_KEY)) return;
    sessionStorage.setItem(AUDIT_ACCESS_SESSION_KEY, "1");
    recordAccess().catch(() => sessionStorage.removeItem(AUDIT_ACCESS_SESSION_KEY));
  }, []);

  const activeEntries = useMemo(() => entries.filter((entry) => isTemporaryEntryActive(entry, Date.now())), [entries]);
  const configuredBudgetMap = useMemo(() => new Map((auditBudgets.data ?? []).map((item) => [item.month, item.budgetCents])), [auditBudgets.data]);

  const octoberBudgetExceededCents = useMemo(() => {
    const groups = new Map<string, number>();
    activeEntries.forEach((entry) =>
      groups.set(entry.date, (groups.get(entry.date) || 0) + Math.round(Number(entry.debit || 0) * 100)),
    );
    return getOctoberBudgetExceededCents(groups);
  }, [activeEntries]);
  const octoberBudgetBlocked = octoberBudgetExceededCents > 0;

  const grouped = useMemo(() => {
    const groups = new Map<string, number>();
    activeEntries.forEach((entry) => groups.set(entry.date, (groups.get(entry.date) || 0) + Number(entry.debit || 0)));
    const debitByDateCents = new Map(Array.from(groups.entries()).map(([date, debit]) => [date, Math.round(debit * 100)]));
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, debit]) => {
        const monthlyDay = getMonthlyPurchaseDay(date, debitByDateCents, configuredBudgetMap);
        const target = getPurchaseLimitForDate(date);
        const recovery = getAutomaticRecoveryForDate(date, debitByDateCents);
        return {
          date,
          debit,
          limit: monthlyDay.limitCents / 100,
          exceeded: Math.round(debit * 100) > monthlyDay.goalCents,
          critical: criticalLabel(date),
          weekday: target.weekday,
          isCritical: target.isCritical,
          isFrozen: monthlyDay.frozen,
          budgetBlocked: monthlyDay.monthBlocked,
          budgetConfigured: monthlyDay.budgetConfigured,
          budgetExceededCents: Math.max(0, monthlyDay.totalDebitCents - monthlyDay.budgetCents),
          monthlyDay,
          recovery,
        };
      });
  }, [activeEntries, configuredBudgetMap, octoberTighteningFactor, octoberBudgetBlocked, octoberBudgetExceededCents]);
  const selectedGrouped = useMemo(() => grouped.filter((row) => row.date.startsWith(selectedFlowMonth)), [grouped, selectedFlowMonth]);
  const visibleGrouped = useMemo(() => selectedGrouped.filter((row) => row.date >= displayToday || selectedFlowMonth !== displayToday.slice(0, 7)), [displayToday, selectedFlowMonth, selectedGrouped]);
  const monthlyBudgetSummary = useMemo(() => {
    const debitByDateCents = new Map<string, number>();
    activeEntries.forEach((entry) => debitByDateCents.set(entry.date, (debitByDateCents.get(entry.date) ?? 0) + Math.round(entry.debit * 100)));
    return getMonthlyPurchaseDay(`${selectedFlowMonth}-01`, debitByDateCents, configuredBudgetMap);
  }, [activeEntries, configuredBudgetMap, selectedFlowMonth]);

  const purchase = parseBRL(purchaseInput);
  const terms = parseTerms(termsInput);
  const paymentDates = parsePaymentDates(paymentDatesInput);

  const dueDates = useMemo(() => {
    const parsed =
      simulationMode === "dates"
        ? paymentDates.map((item) => ({ date: item.date, term: calculateDaysFromReference(today, item.date) }))
        : (terms.length ? terms : [30]).map((term) => {
            const date = new Date(`${today}T12:00:00`);
            date.setDate(date.getDate() + term);
            return { term, date: iso(date) };
          });
    const installment = parsed.length ? purchase / parsed.length : 0;
    return parsed.map(({ term, date }) => {
      const existing = grouped.find((row) => row.date === date)?.debit || 0;
      const debitByDateCents = new Map(grouped.map((row) => [row.date, Math.round(row.debit * 100)]));
      const target = getTightenedFlowLimit(date, existing, octoberTighteningFactor);
      const monthlyDay = getMonthlyPurchaseDay(date, debitByDateCents, configuredBudgetMap);
      const canBuy = !monthlyDay.frozen && !monthlyDay.monthBlocked && installment <= monthlyDay.freeCents / 100 && installment <= monthlyDay.remainingBudgetCents / 100;
      return { term, date, existing, installment, limit: monthlyDay.limitCents / 100, weekday: target.weekday, isCritical: target.isCritical, isFrozen: monthlyDay.frozen, budgetBlocked: monthlyDay.monthBlocked, canBuy };
    });
  }, [simulationMode, paymentDates, terms, purchase, today, grouped, configuredBudgetMap, octoberTighteningFactor, octoberBudgetBlocked]);

  const confirmMutation = useMutation({ mutationFn: confirmPurchases });
  const importMutation = useMutation({ mutationFn: replaceImport });

  const confirmPurchase = () => {
    const selected = dueDates.filter((scenario) => selectedTerms.includes(scenario.term));
    const responsible = actorName.trim();
    if (!selected.length) {
      toast.error("Selecione pelo menos um prazo para confirmar a compra.");
      return;
    }
    if (!responsible) {
      toast.error("Informe seu nome para confirmar a compra.");
      return;
    }
    if (selected.some((scenario) => scenario.isFrozen)) {
      toast.error("Compra bloqueada: o fluxo de setembro de 2026 está congelado.");
      return;
    }
    const unavailableDay = selected.find((scenario) => !scenario.canBuy);
    if (unavailableDay) {
      toast.error(`NÃO PODE COMPRAR: a parcela de ${dateBR(unavailableDay.date)} excede o limite do dia ou o saldo do mês.`);
      return;
    }
    const installmentsByMonth = new Map<string, number>();
    selected.forEach((scenario) => installmentsByMonth.set(scenario.date.slice(0, 7), (installmentsByMonth.get(scenario.date.slice(0, 7)) ?? 0) + scenario.installment));
    for (const [month, amount] of installmentsByMonth) {
      const debitByDateCents = new Map(grouped.map((row) => [row.date, Math.round(row.debit * 100)]));
      const monthDay = getMonthlyPurchaseDay(`${month}-01`, debitByDateCents, configuredBudgetMap);
      if (amount > monthDay.remainingBudgetCents / 100) {
        toast.error(`NÃO PODE COMPRAR: a compra excede o saldo mensal de ${month}.`);
        return;
      }
    }
    confirmMutation.mutate(
      {
        data: {
          entries: selected.map((scenario) => ({ date: scenario.date, debitCents: Math.round(scenario.installment * 100), termDays: scenario.term })),
          actorName: responsible,
        },
      },
      {
        onSuccess: (rows) => {
          setEntries(rows.map(toEntry));
          setShowConfirm(false);
          setSelectedTerms([]);
          setActorName("");
          setSimulated(false);
          toast.success("Compra confirmada. O fluxo compartilhado foi atualizado.");
        },
        onError: () => toast.error("Não foi possível confirmar a compra."),
      },
    );
  };

  const simulate = () => {
    if (simulationMode === "dates" && !paymentDates.length) {
      toast.error("Informe pelo menos uma data no formato DD/MM/AAAA.");
      return;
    }
    if (simulationMode === "terms" && !terms.length) {
      toast.error("Informe pelo menos um prazo em dias.");
      return;
    }
    setSimulated(true);
    recordSimulation({
      data: {
        referenceDate: today,
        purchaseCents: Math.round(purchase * 100),
        actorName: actorName.trim() || undefined,
        scenarios: dueDates.map((scenario) => ({
          termDays: scenario.term,
          paymentDate: scenario.date,
          existingDebitCents: Math.round(scenario.existing * 100),
          installmentCents: Math.round(scenario.installment * 100),
          limitCents: Math.round(scenario.limit * 100),
          canBuy: scenario.canBuy,
        })),
      },
    }).catch(() => undefined);
    toast.success("Cenários de compra simulados e registrados na Auditoria.");
  };

  const downloadTemplate = () => {
    const sheet = XLSX.utils.aoa_to_sheet([["Data de Operação", "Crédito", "Débito", "Saldo"], [today, 0, 0, 0]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Fluxo de Caixa");
    XLSX.writeFile(wb, "modelo-fluxo-de-caixa.xlsx");
  };

  const importFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arrayBuffer = reader.result as ArrayBuffer;
        const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]!]!;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
        const headerLabels = (rows[0] || []).map((header) => String(header));
        const headers = headerLabels.map((header) =>
          header.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""),
        );
        const dateIndex = Math.max(0, headers.findIndex((header) => header.includes("data")));
        const debitIndex = headers.findIndex((header) => header.includes("debito"));
        const creditIndex = headers.findIndex((header) => header.includes("credito"));
        const balanceIndex = headers.findIndex((header) => header.includes("saldo"));
        if (debitIndex < 0) throw new Error("Coluna Débito não encontrada");
        const parseDate = (value: unknown) =>
          value instanceof Date ? iso(value) : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : "";
        const imported = rows
          .slice(1)
          .map((row) => ({
            date: parseDate(row[dateIndex]),
            debit: typeof row[debitIndex] === "number" ? (row[debitIndex] as number) : parseBRL(String(row[debitIndex] || "")),
          }))
          .filter((entry) => entry.date && entry.debit > 0);
        if (!imported.length) throw new Error("Nenhum débito válido encontrado");
        const dates = imported.map((entry) => entry.date).sort();
        const totalDebitCents = imported.reduce((sum, entry) => sum + Math.round(entry.debit * 100), 0);
        const importMeta = {
          fileName: file.name,
          mappedColumns: {
            operationDate: headerLabels[dateIndex] || "Data de Operação",
            credit: headerLabels[creditIndex] || "Crédito",
            debit: headerLabels[debitIndex] || "Débito",
            balance: headerLabels[balanceIndex] || "Saldo",
          },
          periodStart: dates[0]!,
          periodEnd: dates[dates.length - 1]!,
          totalDebitCents,
        };
        importMutation.mutate(
          {
            data: {
              entries: imported.map((entry) => ({ date: entry.date, debitCents: Math.round(entry.debit * 100) })),
              actorName: actorName.trim() || undefined,
              importMeta,
            },
          },
          {
            onSuccess: async (shared) => {
              setEntries(shared.map(toEntry));
              setImportSummary({ count: imported.length, start: dates[0]!, end: dates[dates.length - 1]!, total: totalDebitCents / 100 });
              await queryClient.invalidateQueries({ queryKey: ["cash-flow-entries"] });
              toast.success(`${imported.length} lançamentos importados e compartilhados. A planilha agora é a fonte central do fluxo.`);
            },
            onError: () => toast.error("Não foi possível atualizar o fluxo compartilhado."),
          },
        );
      } catch {
        toast.error("Não foi possível processar a planilha. Confira a coluna Débito.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const nav = (target: Tab, label: string) => (
    <button
      className={tab === target ? "active" : ""}
      onClick={() => {
        setTab(target);
        setMobileMenu(false);
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="simple-app">
      <header className="simple-header">
        <div className="brand">
          <div className="brand-mark">FC</div>
          <div>
            <strong>Fluxo de Caixa</strong>
            <span>Contas a pagar</span>
          </div>
        </div>
        <button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Abrir menu">
          <Menu size={20} />
        </button>
        <nav className={mobileMenu ? "open" : ""}>
          {nav("fluxo", "Fluxo de Caixa")}
          {nav("importar", "Importar Planilha")}
          {nav("dashboard", "Dashboard de Compras")}
          {nav("auditoria", "Auditoria")}
          {nav("comprador", "Comprador")}
        </nav>
      </header>
      <main className="simple-main">
        {tab === "auditoria" ? (
          <AuditTab />
        ) : tab === "comprador" ? (
          <BuyerModule />
        ) : tab === "fluxo" ? (
          <>
            <div className="page-heading page-heading-compact">
              <div>
                <p className="eyebrow">Contas a pagar</p>
                <h1>Fluxo de Caixa</h1>
                <p className="subheading">Simule compras futuras com os débitos importados.</p>
              </div>
              <div className="period-control">
                <label>
                  Mês do fluxo
                  <select value={selectedFlowMonth} onChange={(event) => setSelectedFlowMonth(event.target.value)}>
                    {FLOW_MONTHS.map((month) => <option key={month} value={month}>{FLOW_MONTH_LABELS[month]}</option>)}
                  </select>
                </label>
              </div>
            </div>
            <div className={simulated ? "sim-layout has-simulation" : "sim-layout"}>
              <aside className="card simulator simulator-large">
                <div className="card-heading">
                  <div>
                    <h2>Simulador de compra</h2>
                    <p>Escolha prazos em dias ou informe diretamente as datas de pagamento. O valor será dividido entre as parcelas.</p>
                  </div>
                  <span className="sim-badge">SIMULAR</span>
                </div>
                <div className="form-stack">
                  <label>
                    Data de hoje
                    <input type="date" value={today} onChange={(event) => setToday(event.target.value)} />
                  </label>
                  <label>
                    Valor total da compra
                    <input
                      type="text"
                      inputMode="decimal"
                      value={purchaseInput}
                      onChange={(event) => setPurchaseInput(event.target.value)}
                      onBlur={() => {
                        const value = parseBRL(purchaseInput);
                        setPurchaseInput(value ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
                      }}
                      placeholder="40.000,00"
                    />
                  </label>
                  <div className="simulation-mode">
                    <span>Insira o prazo da compra em dias ou a data prevista do pagamento</span>
                    <div className="mode-options">
                      <label>
                        <input type="radio" name="simulation-mode" checked={simulationMode === "terms"} onChange={() => setSimulationMode("terms")} /> Prazo em
                        dias
                      </label>
                      <label>
                        <input type="radio" name="simulation-mode" checked={simulationMode === "dates"} onChange={() => setSimulationMode("dates")} /> Data de
                        pagamento
                      </label>
                    </div>
                  </div>
                  {simulationMode === "terms" ? (
                    <label>
                      Prazo da compra em dias
                      <input type="text" value={termsInput} onChange={(event) => setTermsInput(event.target.value)} placeholder="30, 60, 90" />
                      <small className="field-hint">Exemplo: 30, 60, 90 divide o valor em 3 parcelas.</small>
                    </label>
                  ) : (
                    <label>
                      Datas previstas de pagamento
                      <input
                        type="text"
                        value={paymentDatesInput}
                        onChange={(event) => setPaymentDatesInput(event.target.value)}
                        placeholder="11/09/2026, 11/10/2026, 11/11/2026"
                      />
                      <small className="field-hint">Informe uma ou mais datas separadas por vírgula. O valor será dividido igualmente.</small>
                    </label>
                  )}
                </div>
                <button className="btn btn-primary full" onClick={simulate}>
                  Simular compra
                </button>
              </aside>
              {simulated && (
                <section className="card simulation-panel">
                  <div className="card-heading">
                    <div>
                      <h2>Simulação da compra</h2>
                      <p>Confira cada parcela, impacto e meta calculada para a data prevista.</p>
                    </div>
                  </div>
                  <div className="scenario-list">
                    {dueDates.map((scenario) => (
                      <div className={"scenario " + (scenario.canBuy ? "scenario-ok" : "scenario-risk")} key={scenario.term}>
                        <div className="scenario-title">
                          <strong>{scenario.canBuy ? "PODE COMPRAR" : "NÃO PODE COMPRAR"}</strong>
                          <span>{simulationMode === "dates" ? "Data informada" : `${scenario.term} dias`}</span>
                        </div>
                        <div className="scenario-grid">
                          <div>
                            <span>Data prevista</span>
                            <strong>{dateBR(scenario.date)}</strong>
                          </div>
                          <div>
                            <span>Prazo</span>
                            <strong>Hoje + {scenario.term} dias</strong>
                          </div>
                          <div>
                            <span>Dia da semana</span>
                            <strong>{scenario.weekday}</strong>
                          </div>
                          <div>
                            <span>Valor já existente</span>
                            <strong>{money(scenario.existing)}</strong>
                          </div>
                          <div>
                            <span>Valor da compra</span>
                            <strong>{money(scenario.installment)}</strong>
                          </div>
                          <div>
                            <span>{scenario.isCritical ? "Limite crítico" : "Meta do dia"}</span>
                            <strong>{money(scenario.limit)}</strong>
                          </div>
                        </div>
                        <div className="scenario-alert">
                          <div className="scenario-alert-main">
                            {scenario.isFrozen
                              ? "BLOQUEADO — Fluxo congelado em setembro"
                              : scenario.existing <= scenario.limit
                              ? "Saldo Disponível para compra no dia"
                              : "Valor ultrapassado da meta diária"}
                            <strong className={scenario.isFrozen ? "red-text" : scenario.existing <= scenario.limit ? "green-text" : "red-text"}>
                              {scenario.isFrozen ? money(0) : money(Math.abs(scenario.limit - scenario.existing))}
                            </strong>
                          </div>
                          <div className="scenario-alert-support">
                            {scenario.isFrozen
                              ? "Nenhuma compra pode ter vencimento em setembro de 2026."
                              : scenario.existing <= scenario.limit
                              ? "Débitos existentes + parcela ficam dentro do limite."
                              : "Débitos existentes + parcela ultrapassam o limite."}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn btn-dark full confirm-purchase-btn"
                    onClick={() => {
                      setSelectedTerms(dueDates.map((scenario) => scenario.term));
                      setShowConfirm(true);
                    }}
                  >
                    Confirmar compra nessas parcelas
                  </button>
                </section>
              )}
            </div>
            <section className="card monthly-budget-summary">
              <div className="card-heading">
                <div>
                  <h2>Orçamento de compra — {FLOW_MONTH_LABELS[selectedFlowMonth]}</h2>
                  <p>A folga diária é redistribuída proporcionalmente sem ultrapassar o saldo mensal.</p>
                </div>
              </div>
              <div className="purchase-kpis">
                <div className="summary-card"><span>Orçamento de compra</span><strong>{money(monthlyBudgetSummary.budgetCents / 100)}</strong></div>
                <div className="summary-card"><span>Total de débitos importados</span><strong>{money(monthlyBudgetSummary.totalDebitCents / 100)}</strong></div>
                <div className="summary-card"><span>Saldo do orçamento</span><strong className={monthlyBudgetSummary.remainingBudgetCents > 0 ? "green-text" : "red-text"}>{money(monthlyBudgetSummary.remainingBudgetCents / 100)}</strong></div>
              </div>
              {!monthlyBudgetSummary.budgetConfigured ? <p className="muted"><strong>Orçamento do mês não encontrado na Auditoria de Compras.</strong> Nenhum livre é calculado.</p> : monthlyBudgetSummary.totalDebitCents > monthlyBudgetSummary.budgetCents && <p className="red-text"><strong>Orçamento do mês ultrapassado em {money((monthlyBudgetSummary.totalDebitCents - monthlyBudgetSummary.budgetCents) / 100)}.</strong> Todos os livres foram zerados.</p>}
              <p className="muted">Conferência: folga diária total {money(grouped.filter((row) => row.date.startsWith(monthlyBudgetSummary.date.slice(0, 7))).reduce((sum, row) => sum + row.monthlyDay.freeCents, 0) / 100)} de um máximo mensal de {money(Math.min(monthlyBudgetSummary.remainingBudgetCents, monthlyBudgetSummary.goalFreeCents) / 100)}.</p>
            </section>
            <div className="flow-columns">
              <section className="card critical-card critical-below">
                <div className="card-heading">
                  <div>
                    <h2>Dias críticos e datas de pagamento</h2>
                    <p>Os cinco dias críticos do mês, com a próxima data de pagamento e a meta aplicada.</p>
                  </div>
                  <AlertTriangle size={20} />
                </div>
                <div className="critical-list">
                  {CRITICAL_DAYS_INFO.map((item) => {
                    const date = `${selectedFlowMonth}-${String(item.day).padStart(2, "0")}`;
                    const flow = grouped.find((row) => row.date === date);
                    const target = getPurchaseLimitForDate(date);
                    const debitByDateCents = new Map(grouped.map((row) => [row.date, Math.round(row.debit * 100)]));
                    const monthlyDay = getMonthlyPurchaseDay(date, debitByDateCents, configuredBudgetMap);
                    const budgetBlocked = monthlyDay.monthBlocked;
                    const frozen = monthlyDay.frozen;
                    const exceeded = !frozen && flow ? Math.round(flow.debit * 100) > monthlyDay.goalCents : false;
                    return (
                      <div className={"critical-item " + (exceeded ? "critical-risk" : "")} key={item.day}>
                        <div className="critical-event">
                          <strong>
                            Dia {String(item.day).padStart(2, "0")} — {item.label}
                          </strong>
                          <span>Dia crítico de pagamento</span>
                        </div>
                        <div className="critical-date">
                          <strong>{dayMonthBR(date)}</strong>
                          <span>
                            {target.weekday} · limite de {money(monthlyDay.limitCents / 100)}
                          </span>
                        </div>
                        <div className="critical-amount">
                          <b className={frozen || budgetBlocked ? "muted" : exceeded ? "red-text" : "green-text"}>{money(flow?.debit ?? 0)}</b>
                          <small>{frozen ? `BLOQUEADO — Fluxo congelado em setembro · ${money(0)} livres` : !monthlyDay.budgetConfigured ? "Orçamento do mês não encontrado na Auditoria de Compras" : budgetBlocked ? `BLOQUEADO — Sem orçamento no mês${monthlyDay.totalDebitCents > monthlyDay.budgetCents ? ` em ${money((monthlyDay.totalDebitCents - monthlyDay.budgetCents) / 100)}` : ""}` : flow ? (exceeded ? "Limite do dia ultrapassado" : `${money(monthlyDay.freeCents / 100)} livres`) : "sem débitos"}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="card timeline-card">
                <div className="card-heading">
                  <div>
                    <h2>Débitos por dia</h2>
                    <p>Todos os débitos importados, organizados por data e comparados com a meta do dia.</p>
                  </div>
                </div>
                <div className="timeline-list">
                  {visibleGrouped.map((row) => (
                    <div className="timeline-row" key={row.date}>
                      <div className="timeline-label">
                        <strong>{dateBR(row.date)}{row.date === displayToday ? " · HOJE" : ""}</strong>
                        <span>{row.critical || row.weekday}</span>
                      </div>
                      <div className="timeline-track">
                        <div
                          className={"timeline-fill " + (row.exceeded ? "fill-risk" : row.budgetConfigured ? "" : "fill-muted")}
                          style={{ width: String(Math.min(100, row.debit / row.limit * 100)) + "%" }}
                        />
                      </div>
                      <div className="timeline-value">
                        <strong className={row.isFrozen || !row.budgetConfigured ? "muted" : row.exceeded ? "red-text" : "green-text"}>{money(row.debit)}</strong>
                          <span>{row.isFrozen ? "BLOQUEADO — Fluxo congelado em setembro" : !row.budgetConfigured ? "Orçamento do mês não encontrado na Auditoria de Compras" : row.budgetBlocked ? `BLOQUEADO — Orçamento do mês ultrapassado em ${money(row.budgetExceededCents / 100)}` : row.exceeded ? "Limite do dia ultrapassado" : `${money(row.limit - row.debit)} livres`}</span>
                      </div>
                    </div>
                  ))}
                  {!visibleGrouped.length && (
                    <div className="empty">Nenhum débito importado. Acesse “Importar Planilha” para começar.</div>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : tab === "importar" ? (
          <ImportTab onFile={importFile} onDownload={downloadTemplate} summary={importSummary} />
        ) : tab === "metas" ? (
          <GoalsTab />
        ) : (
          <PurchasesDashboardTab />
        )}
      </main>
      {showConfirm && (
        <div className="modal-backdrop">
          <div className="modal-light confirmation-modal">
            <div className="modal-title">
              <div>
                <p className="eyebrow">Reprocessar fluxo</p>
                <h2>Confirmar compra</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowConfirm(false)} aria-label="Fechar">
                <X size={18} />
              </button>
            </div>
            <p className="modal-description">
              Selecione as parcelas que foram confirmadas. As parcelas escolhidas entram no fluxo nas datas previstas e ficam temporárias por 7 dias.
            </p>
            <label className="audit-name-field">
              Seu nome
              <input value={actorName} onChange={(event) => setActorName(event.target.value)} placeholder="Quem está confirmando esta compra?" />
            </label>
            <div className="confirmation-terms">
              {dueDates.map((scenario) => (
                <label className="confirmation-term" key={scenario.term}>
                  <input
                    type="checkbox"
                    checked={selectedTerms.includes(scenario.term)}
                    onChange={(event) =>
                      setSelectedTerms((current) =>
                        event.target.checked ? [...current, scenario.term] : current.filter((term) => term !== scenario.term),
                      )
                    }
                  />
                  <span>
                    <strong>{simulationMode === "dates" ? dateBR(scenario.date) : `${scenario.term} dias`}</strong>
                    <small>
                      {dateBR(scenario.date)} · {money(scenario.installment)}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-light" onClick={() => setShowConfirm(false)}>
                Cancelar
              </button>
              <button className="btn btn-dark" onClick={confirmPurchase}>
                Confirmar e atualizar fluxo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
