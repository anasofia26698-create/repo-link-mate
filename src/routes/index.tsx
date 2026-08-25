import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AlertTriangle, Menu, X } from "lucide-react";
import { isTemporaryEntryActive } from "@/lib/flowRules";
import {
  calculateDaysFromReference,
  canPurchaseOnDate,
  getPurchaseLimitForDate,
  parsePaymentDates,
} from "@/lib/simulationRules";
import { confirmPurchases, listCashFlow, recordAccess, recordSimulation, replaceImport } from "@/lib/cashflow.functions";
import { AuditTab } from "@/components/cashflow/AuditTab";
import { GoalsTab, PurchasesDashboardTab } from "@/components/cashflow/PurchaseGoals";
import { ImportTab } from "@/components/cashflow/ImportTab";
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
      {
        property: "og:description",
        content: "Simulação de compras, importação de planilhas, metas por setor e auditoria de acessos.",
      },
    ],
  }),
  component: HomePage,
});

type Entry = { id: string; date: string; debit: number; source: "imported" | "manual"; createdAt?: number };
type Tab = "fluxo" | "importar" | "metas" | "dashboard" | "auditoria";

const AUDIT_ACCESS_SESSION_KEY = "signal-cash-audit-access-recorded";

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
  const [tab, setTab] = useState<Tab>("fluxo");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [today, setToday] = useState(iso(new Date()));
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

  const sharedFlow = useQuery({
    queryKey: ["cash-flow-entries"],
    queryFn: () => listCashFlow(),
    refetchInterval: 300_000,
    refetchIntervalInBackground: true,
  });

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
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(AUDIT_ACCESS_SESSION_KEY)) return;
    sessionStorage.setItem(AUDIT_ACCESS_SESSION_KEY, "1");
    recordAccess().catch(() => sessionStorage.removeItem(AUDIT_ACCESS_SESSION_KEY));
  }, []);

  const activeEntries = useMemo(() => entries.filter((entry) => isTemporaryEntryActive(entry, Date.now())), [entries]);

  const grouped = useMemo(() => {
    const groups = new Map<string, number>();
    activeEntries.forEach((entry) => groups.set(entry.date, (groups.get(entry.date) || 0) + Number(entry.debit || 0)));
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, debit]) => {
        const target = getPurchaseLimitForDate(date);
        return {
          date,
          debit,
          limit: target.limit,
          exceeded: debit > target.limit,
          critical: criticalLabel(date),
          weekday: target.weekday,
          isCritical: target.isCritical,
        };
      });
  }, [activeEntries]);

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
      const target = getPurchaseLimitForDate(date);
      const canBuy = canPurchaseOnDate(date, existing, installment);
      return { term, date, existing, installment, limit: target.limit, weekday: target.weekday, isCritical: target.isCritical, canBuy };
    });
  }, [simulationMode, paymentDates, terms, purchase, today, grouped]);

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
            onSuccess: (shared) => {
              setEntries(shared.map(toEntry));
              setImportSummary({ count: imported.length, start: dates[0]!, end: dates[dates.length - 1]!, total: totalDebitCents / 100 });
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
          {nav("metas", "Cadastro de Metas")}
          {nav("dashboard", "Dashboard de Compras")}
          {nav("auditoria", "Auditoria")}
        </nav>
      </header>
      <main className="simple-main">
        {tab === "auditoria" ? (
          <AuditTab />
        ) : tab === "fluxo" ? (
          <>
            <div className="page-heading page-heading-compact">
              <div>
                <p className="eyebrow">Contas a pagar</p>
                <h1>Fluxo de Caixa</h1>
                <p className="subheading">Simule compras futuras com os débitos importados.</p>
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
                          {scenario.existing <= scenario.limit && (
                            <div>
                              <span>Disponível para compra no dia</span>
                              <strong className="green-text">{money(scenario.limit - scenario.existing)}</strong>
                            </div>
                          )}
                        </div>
                        {scenario.existing > scenario.limit ? (
                          <div className="scenario-alert">
                            <div className="scenario-alert-main">
                              Valor ultrapassado da meta diária
                              <strong>{money(scenario.existing - scenario.limit)}</strong>
                            </div>
                            <div className="scenario-alert-support">Débitos existentes + parcela ultrapassam o limite.</div>
                          </div>
                        ) : (
                          <p>Débitos existentes + parcela ficam dentro do limite.</p>
                        )}
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
                    const date = nextCriticalDate(item.day, today);
                    const target = getPurchaseLimitForDate(date);
                    const flow = grouped.find((row) => row.date === date);
                    const exceeded = flow ? flow.debit > target.limit : false;
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
                            {target.weekday} · limite de {money(target.limit)}
                          </span>
                        </div>
                        <div className="critical-amount">
                          <b className={exceeded ? "red-text" : "green-text"}>{money(flow?.debit ?? 0)}</b>
                          <small>{flow ? (exceeded ? "limite ultrapassado" : `${money(target.limit - flow.debit)} livres`) : "sem débitos"}</small>
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
                  {grouped.map((row) => (
                    <div className="timeline-row" key={row.date}>
                      <div className="timeline-label">
                        <strong>{dateBR(row.date)}</strong>
                        <span>{row.critical || row.weekday}</span>
                      </div>
                      <div className="timeline-track">
                        <div
                          className={"timeline-fill " + (row.exceeded ? "fill-risk" : "")}
                          style={{ width: String(Math.min(100, row.debit / row.limit * 100)) + "%" }}
                        />
                      </div>
                      <div className="timeline-value">
                        <strong className={row.exceeded ? "red-text" : "green-text"}>{money(row.debit)}</strong>
                        <span>{row.exceeded ? "Limite ultrapassado" : `${money(row.limit - row.debit)} livres`}</span>
                      </div>
                    </div>
                  ))}
                  {!grouped.length && (
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

