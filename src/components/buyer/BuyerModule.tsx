import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { LockKeyhole, ShieldAlert, Upload } from "lucide-react";
import {
  BUYERS,
  BUYER_BUSINESS_RULES,
  dailyGoal,
  isBuyerModuleAccessGranted,
  matchBuyer,
  type Buyer,
} from "@/lib/buyerRules";
import {
  deleteBuyerIpAddress,
  getBuyerContext,
  importBuyerPayments,
  saveBuyerIpAddress,
} from "@/lib/buyer.functions";
import { dateBR, iso, money, parseBRL, parseTerms } from "@/components/cashflow/format";

type BuyerArea = "fluxo" | "importar";

function BuyerPasswordGate({ area, onUnlock }: { area: BuyerArea; onUnlock: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return (
    <section className="card access-card">
      <LockKeyhole size={28} />
      <h2>Área protegida</h2>
      <p>Informe a senha para acessar {area === "fluxo" ? "o Fluxo de Caixa por comprador" : "a Importação de Planilha"}.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (isBuyerModuleAccessGranted(password)) onUnlock(password.trim());
          else toast.error("Senha incorreta.");
        }}
      >
        <label>
          Senha
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        </label>
        <button className="btn btn-dark full">Entrar</button>
      </form>
    </section>
  );
}

export function BuyerModule() {
  const [area, setArea] = useState<BuyerArea>("fluxo");
  const [password, setPassword] = useState("");

  const changeArea = (next: BuyerArea) => {
    setArea(next);
    setPassword("");
  };

  return (
    <>
      <div className="page-heading page-heading-compact">
        <div>
          <p className="eyebrow">Controle por comprador</p>
          <h1>Comprador</h1>
          <p className="subheading">Orçamento diário de compras de Marcelo, Suellen e Maurício.</p>
        </div>
      </div>
      <div className="buyer-subnav">
        <button className={area === "fluxo" ? "active" : ""} onClick={() => changeArea("fluxo")}>
          Fluxo de Caixa
        </button>
        <button className={area === "importar" ? "active" : ""} onClick={() => changeArea("importar")}>
          Importação Planilha
        </button>
      </div>
      {!password ? (
        <BuyerPasswordGate area={area} onUnlock={setPassword} />
      ) : area === "fluxo" ? (
        <BuyerFlowArea password={password} />
      ) : (
        <BuyerImportArea password={password} />
      )}
    </>
  );
}

function useBuyerContext(password: string) {
  return useQuery({
    queryKey: ["buyer-context", password],
    queryFn: () => getBuyerContext({ data: { password } }),
  });
}

function BuyerFlowArea({ password }: { password: string }) {
  const context = useBuyerContext(password);
  const [today, setToday] = useState(iso(new Date()));
  const [purchaseInput, setPurchaseInput] = useState("48.000,00");
  const [termsInput, setTermsInput] = useState("30, 60, 90");
  const [manualBuyer, setManualBuyer] = useState<Buyer | "">("");
  const [newIpBuyer, setNewIpBuyer] = useState<Buyer>(BUYERS[0]);
  const [simulated, setSimulated] = useState(false);

  const ips = context.data?.ips ?? [];
  const detected = (context.data?.buyer ?? null) as Buyer | null;
  const ipAddress = context.data?.ipAddress ?? null;
  const buyer: Buyer | null = manualBuyer || detected;

  const saveIp = useMutation({ mutationFn: saveBuyerIpAddress });
  const removeIp = useMutation({ mutationFn: deleteBuyerIpAddress });

  const period = today.slice(0, 7);
  const monthlyBudget = useMemo(() => {
    const found = (context.data?.budgets ?? []).find((item) => item.period === period && item.buyer === buyer);
    const fallback = (context.data?.budgets ?? []).find((item) => item.buyer === buyer);
    return ((found ?? fallback)?.monthlyCents ?? 0) / 100;
  }, [context.data, period, buyer]);

  const paymentsByDate = useMemo(() => {
    const map = new Map<string, number>();
    (context.data?.payments ?? [])
      .filter((item) => item.buyer === buyer)
      .forEach((item) => map.set(item.date, (map.get(item.date) ?? 0) + item.amountCents / 100));
    return map;
  }, [context.data, buyer]);

  const purchase = parseBRL(purchaseInput);
  const terms = parseTerms(termsInput);

  const scenarios = useMemo(() => {
    const list = terms.length ? terms : [30];
    const installment = purchase / list.length;
    return list.map((term) => {
      const date = new Date(`${today}T12:00:00`);
      date.setDate(date.getDate() + term);
      const dueDate = iso(date);
      const goal = dailyGoal(monthlyBudget, dueDate);
      const existing = paymentsByDate.get(dueDate) ?? 0;
      return { term, date: dueDate, installment, existing, ...goal, canBuy: existing + installment <= goal.goal };
    });
  }, [terms, purchase, today, monthlyBudget, paymentsByDate]);

  const flowRows = useMemo(
    () =>
      Array.from(paymentsByDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, total]) => ({ date, total, ...dailyGoal(monthlyBudget, date) })),
    [paymentsByDate, monthlyBudget],
  );

  if (context.isLoading) return <div className="card empty">Carregando dados do comprador...</div>;
  if (context.isError) return <div className="card empty">Não foi possível carregar o módulo do comprador.</div>;

  return (
    <>
      <section className="card buyer-ident-card">
        <div className="card-heading">
          <div>
            <h2>Identificação do comprador</h2>
            <p>O IP de origem define o comprador. Use o seletor manual apenas quando o mesmo IP for compartilhado.</p>
          </div>
          <ShieldAlert size={20} />
        </div>
        <div className="buyer-ident-body">
          <div className="buyer-ident-line">
            <span>IP detectado</span>
            <strong>{ipAddress ?? "não identificado"}</strong>
          </div>
          <div className="buyer-ident-line">
            <span>Comprador do IP</span>
            <strong className={detected ? "green-text" : "red-text"}>{detected ?? "IP não cadastrado"}</strong>
          </div>
          <label>
            Comprador (seletor manual)
            <select value={manualBuyer} onChange={(event) => setManualBuyer(event.target.value as Buyer | "")}>
              <option value="">Usar o comprador do IP</option>
              {BUYERS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          {!detected && (
            <div className="scenario-alert">
              <div className="scenario-alert-main">
                Simulação bloqueada
                <strong className="red-text">IP não cadastrado</strong>
              </div>
              <div className="scenario-alert-support">
                Cadastre o IP abaixo ou escolha o comprador no seletor manual para liberar a simulação.
              </div>
            </div>
          )}
          <div className="buyer-ip-form">
            <input value={ipAddress ?? ""} readOnly placeholder="IP" />
            <select value={newIpBuyer} onChange={(event) => setNewIpBuyer(event.target.value as Buyer)}>
              {BUYERS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <button
              className="btn btn-dark"
              onClick={() => {
                if (!ipAddress) {
                  toast.error("Nenhum IP detectado para cadastrar.");
                  return;
                }
                saveIp.mutate(
                  { data: { password, ipAddress, buyer: newIpBuyer } },
                  {
                    onSuccess: () => {
                      toast.success("IP cadastrado.");
                      context.refetch();
                    },
                    onError: () => toast.error("Não foi possível cadastrar o IP."),
                  },
                );
              }}
            >
              Cadastrar este IP
            </button>
          </div>
          <div className="buyer-ip-list">
            {ips.map((item) => (
              <div className="buyer-ip-item" key={item.id}>
                <span>
                  <strong>{item.buyer}</strong>
                  <small>{item.ipAddress}</small>
                </span>
                <button
                  className="btn btn-light"
                  onClick={() =>
                    removeIp.mutate(
                      { data: { password, id: item.id } },
                      { onSuccess: () => context.refetch(), onError: () => toast.error("Não foi possível remover o IP.") },
                    )
                  }
                >
                  Remover
                </button>
              </div>
            ))}
            {!ips.length && <div className="empty">Nenhum IP cadastrado.</div>}
          </div>
        </div>
      </section>

      <div className="sim-layout has-simulation">
        <aside className="card simulator simulator-large">
          <div className="card-heading">
            <div>
              <h2>Simulador diário</h2>
              <p>Data prevista = hoje + prazo. A meta usa o peso do dia da semana e o redutor dos dias críticos.</p>
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
                placeholder="40.000,00"
              />
            </label>
            <label>
              Prazo da compra em dias
              <input type="text" value={termsInput} onChange={(event) => setTermsInput(event.target.value)} placeholder="30, 60, 90" />
            </label>
            <div className="buyer-ident-line">
              <span>Dotação do mês ({period})</span>
              <strong>{money(monthlyBudget)}</strong>
            </div>
          </div>
          <button
            className="btn btn-primary full"
            onClick={() => {
              if (!buyer) {
                toast.error("IP não cadastrado. Cadastre o IP ou selecione o comprador manualmente.");
                return;
              }
              if (!monthlyBudget) {
                toast.error("Cadastre a dotação mensal deste comprador na aba Cadastro de Metas.");
                return;
              }
              setSimulated(true);
            }}
          >
            Simular compra
          </button>
        </aside>
        {simulated && buyer && (
          <section className="card simulation-panel">
            <div className="card-heading">
              <div>
                <h2>Simulação de {buyer}</h2>
                <p>Cada dia tem teto próprio — folga ou estouro não migram entre dias.</p>
              </div>
            </div>
            <div className="scenario-list">
              {scenarios.map((scenario) => (
                <div className={"scenario " + (scenario.canBuy ? "scenario-ok" : "scenario-risk")} key={scenario.term}>
                  <div className="scenario-title">
                    <strong>{scenario.canBuy ? "PODE COMPRAR" : "NÃO PODE COMPRAR"}</strong>
                    <span>{scenario.term} dias</span>
                  </div>
                  <div className="scenario-grid">
                    <div>
                      <span>Data prevista</span>
                      <strong>{dateBR(scenario.date)}</strong>
                    </div>
                    <div>
                      <span>Dia da semana</span>
                      <strong>{scenario.weekday}</strong>
                    </div>
                    <div>
                      <span>Pagamentos do dia</span>
                      <strong>{money(scenario.existing)}</strong>
                    </div>
                    <div>
                      <span>Valor da parcela</span>
                      <strong>{money(scenario.installment)}</strong>
                    </div>
                    <div>
                      <span>{scenario.isCritical ? "Meta do dia (crítico 85%)" : "Meta do dia"}</span>
                      <strong>{money(scenario.goal)}</strong>
                    </div>
                    <div>
                      <span>Peso do dia</span>
                      <strong>{(scenario.weight * 100).toFixed(2).replace(".", ",")}%</strong>
                    </div>
                  </div>
                  <div className="scenario-alert">
                    <div className="scenario-alert-main">
                      {scenario.existing <= scenario.goal ? "Saldo Disponível para compra no dia" : "Valor ultrapassado da meta diária"}
                      <strong className={scenario.existing <= scenario.goal ? "green-text" : "red-text"}>
                        {money(Math.abs(scenario.goal - scenario.existing))}
                      </strong>
                    </div>
                    <div className="scenario-alert-support">
                      {scenario.canBuy
                        ? "Débitos existentes + parcela ficam dentro do limite."
                        : "Débitos existentes + parcela ultrapassam o limite."}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <section className="card timeline-card">
        <div className="card-heading">
          <div>
            <h2>Pagamentos por dia {buyer ? `— ${buyer}` : ""}</h2>
            <p>Pagamentos importados da planilha, comparados com a meta do dia.</p>
          </div>
        </div>
        <div className="timeline-list">
          {flowRows.map((row) => {
            const exceeded = row.total > row.goal;
            return (
              <div className="timeline-row" key={row.date}>
                <div className="timeline-label">
                  <strong>{dateBR(row.date)}</strong>
                  <span>
                    {row.weekday}
                    {row.isCritical ? " · dia crítico" : ""}
                  </span>
                </div>
                <div className="timeline-track">
                  <div
                    className={"timeline-fill " + (exceeded ? "fill-risk" : "")}
                    style={{ width: `${row.goal ? Math.min(100, (row.total / row.goal) * 100) : 0}%` }}
                  />
                </div>
                <div className="timeline-value">
                  <strong className={exceeded ? "red-text" : "green-text"}>{money(row.total)}</strong>
                  <span>{exceeded ? `${money(row.total - row.goal)} acima da meta` : `${money(row.goal - row.total)} livres`}</span>
                </div>
              </div>
            );
          })}
          {!flowRows.length && <div className="empty">Nenhum pagamento importado para este comprador.</div>}
        </div>
      </section>

      <section className="card rules-card">
        <div className="card-heading">
          <div>
            <h2>Regras aplicadas</h2>
            <p>Base de cálculo do módulo Comprador.</p>
          </div>
        </div>
        <ul className="rules-list">
          {BUYER_BUSINESS_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </section>
    </>
  );
}

function BuyerImportArea({ password }: { password: string }) {
  const context = useBuyerContext(password);
  const importMutation = useMutation({ mutationFn: importBuyerPayments });
  const [summary, setSummary] = useState<{ count: number; ignored: number; total: number } | null>(null);

  const parseDate = (value: unknown): string => {
    if (value instanceof Date) return iso(value);
    const text = String(value ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (br) {
      const year = br[3]!.length === 2 ? `20${br[3]}` : br[3]!;
      return `${year}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
    }
    return "";
  };

  const handleFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const wb = XLSX.read(reader.result as ArrayBuffer, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]!]!;
        const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
        const header = (rows[0] ?? []).map((cell) => String(cell));
        const buyerColumns = header
          .map((label, index) => ({ index, buyer: matchBuyer(label) }))
          .filter((item): item is { index: number; buyer: Buyer } => Boolean(item.buyer));
        if (!buyerColumns.length) throw new Error("Nenhuma coluna de comprador encontrada (Marcelo, Suellen, Maurício).");
        const dateIndex = Math.max(
          0,
          header.findIndex((label) => matchBuyer(label) === null && label.toLowerCase().includes("venc")),
        );

        let ignored = 0;
        const entries: { date: string; buyer: Buyer; amountCents: number }[] = [];
        rows.slice(1).forEach((row) => {
          const date = parseDate(row[dateIndex]);
          if (!date) {
            if (row.some((cell) => String(cell ?? "").trim())) ignored += 1;
            return;
          }
          buyerColumns.forEach(({ index, buyer }) => {
            const raw = row[index];
            const value = typeof raw === "number" ? raw : parseBRL(String(raw ?? ""));
            if (!value || value <= 0) return;
            entries.push({ date, buyer, amountCents: Math.round(value * 100) });
          });
        });

        if (!entries.length) throw new Error("Nenhum pagamento válido encontrado.");
        importMutation.mutate(
          { data: { password, fileName: file.name, entries } },
          {
            onSuccess: () => {
              setSummary({
                count: entries.length,
                ignored,
                total: entries.reduce((sum, entry) => sum + entry.amountCents, 0) / 100,
              });
              context.refetch();
              toast.success(`${entries.length} pagamento(s) importado(s) por comprador.`);
              if (ignored) toast.warning(`${ignored} linha(s) ignorada(s) por data inválida.`);
            },
            onError: () => toast.error("Não foi possível salvar a importação."),
          },
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Não foi possível processar a planilha.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="import-page">
      <div className="import-grid">
        <label className="dropzone">
          <Upload size={30} />
          <strong>Selecionar planilha de contas a pagar</strong>
          <span>1ª coluna: data de vencimento · demais colunas: Marcelo, Suellen e Maurício</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => handleFile(event.target.files?.[0])} />
        </label>
        <section className="card import-help">
          <Upload size={22} />
          <h2>Como o sistema lê a planilha</h2>
          <p>O nome de cada coluna identifica o comprador; somente Marcelo, Suellen e Maurício são processados.</p>
          <div className="columns">
            <span>Coluna 1 — Data de vencimento</span>
            <span>Coluna 2, 3 e 4 — Valores por comprador</span>
          </div>
          <p className="muted">
            Linhas com data inválida são ignoradas com alerta; valores vazios são ignorados; valores repetidos são mantidos, pois cada
            linha é um pagamento distinto. Nenhum custo operacional entra nesta base.
          </p>
        </section>
      </div>
      {summary && (
        <div className="import-summary">
          <strong>{summary.count} pagamento(s) importado(s)</strong>
          <span>
            Total {money(summary.total)} · {summary.ignored} linha(s) ignorada(s)
          </span>
        </div>
      )}
    </div>
  );
}
