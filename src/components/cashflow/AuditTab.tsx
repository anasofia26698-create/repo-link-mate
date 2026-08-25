import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { getImportComparison, listAuditEvents } from "@/lib/cashflow.functions";
import { isPurchaseAccessGranted } from "@/lib/purchaseRules";
import { dateBR, money } from "./format";

function auditEventLabel(type: string) {
  return type === "confirmation"
    ? "Confirmação de compra"
    : type === "import"
      ? "Importação de fluxo"
      : type === "simulation"
        ? "Simulação de compra"
        : "Acesso ao site";
}

function formatAuditDetail(type: string, value: string | null) {
  if (!value) return null;
  try {
    const details = JSON.parse(value) as Record<string, any>;
    if (type === "confirmation" && typeof details.totalCents === "number" && Array.isArray(details.installments))
      return `Valor: ${money(details.totalCents / 100)} · ${details.installments
        .map((item: any) => `${item.termDays ?? "—"} dias → ${dateBR(item.date)} (${money(item.debitCents / 100)})`)
        .join(" | ")}`;
    if (type === "simulation" && typeof details.purchaseCents === "number" && Array.isArray(details.scenarios))
      return `Valor simulado: ${money(details.purchaseCents / 100)} · Base: ${dateBR(details.referenceDate)} · ${details.scenarios
        .map(
          (item: any) =>
            `${item.termDays} dias → ${dateBR(item.paymentDate)} · ${item.canBuy ? "pode comprar" : "não pode comprar"} · meta ${money(item.limitCents / 100)}`,
        )
        .join(" | ")}`;
    if (type === "import" && details.mappedColumns)
      return `Arquivo: ${details.fileName || "não informado"} · Colunas: ${Object.values(details.mappedColumns).join(" / ")} · Período: ${dateBR(details.periodStart)} a ${dateBR(details.periodEnd)} · Total: ${money(details.totalDebitCents / 100)}`;
    return null;
  } catch {
    return null;
  }
}

export function AuditTab() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const audit = useQuery({
    queryKey: ["audit-events"],
    queryFn: () => listAuditEvents({ data: { password: "2606", limit: 100 } }),
    enabled: unlocked,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
  const comparison = useQuery({
    queryKey: ["audit-import-comparison"],
    queryFn: () => getImportComparison({ data: { password: "2606" } }),
    enabled: unlocked,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  if (!unlocked)
    return (
      <section className="card access-card">
        <ShieldCheck size={28} />
        <h2>Auditoria protegida</h2>
        <p>Informe a senha para consultar IPs, acessos, importações e confirmações registradas.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (isPurchaseAccessGranted(password)) {
              setUnlocked(true);
            } else {
              toast.error("Senha incorreta.");
            }
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

  return (
    <section className="audit-page">
      <div className="page-heading page-heading-compact">
        <div>
          <p className="eyebrow">Controle e rastreabilidade</p>
          <h1>Auditoria de acessos</h1>
          <p className="subheading">
            Acessos e eventos são atualizados a cada minuto, mantendo os dados já existentes e acrescentando novos detalhes.
          </p>
        </div>
      </div>
      <section className="card audit-card">
        <div className="card-heading">
          <div>
            <h2>Eventos recentes</h2>
            <p>Histórico imutável de acessos, importações, simulações e confirmações.</p>
          </div>
          <ShieldCheck size={21} />
        </div>
        {audit.isLoading ? (
          <div className="empty">Carregando eventos...</div>
        ) : (
          <>
            <div className="audit-list">
              {audit.data?.map((event) => {
                const detail = formatAuditDetail(event.eventType, event.details);
                return (
                  <div className="audit-item" key={event.id}>
                    <div>
                      <strong>{auditEventLabel(event.eventType)}</strong>
                      <span>
                        {event.userName || "Visitante não identificado"}
                        {event.userEmail ? ` · ${event.userEmail}` : ""}
                      </span>
                    </div>
                    <div>
                      <b>{new Date(event.createdAt).toLocaleString("pt-BR")}</b>
                      <span>
                        IP: {event.ipAddress || "Não disponível"} · {event.entryCount} lançamento(s)
                      </span>
                      {detail && <span className="audit-confirmation-details">{detail}</span>}
                      <small>{event.userAgent || "Navegador não informado"}</small>
                    </div>
                  </div>
                );
              })}
            </div>
            {!audit.data?.length && <div className="empty">Nenhum evento de auditoria registrado ainda.</div>}
          </>
        )}
      </section>
      <section className="card import-comparison-card">
        <div className="card-heading">
          <div>
            <h2>Comparação de importações</h2>
            <p>Compara a importação mais recente com a média das cinco importações anteriores e mantém as cinco referências disponíveis.</p>
          </div>
          <FileSpreadsheet size={21} />
        </div>
        {comparison.isLoading ? (
          <div className="empty">Carregando histórico de importações...</div>
        ) : (
          <div className="comparison-content">
            <div className="import-run-list">
              {comparison.data?.runs.slice(0, 5).map((run) => (
                <div className="import-run" key={run.id}>
                  <strong>{run.fileName || "Planilha sem nome"}</strong>
                  <span>
                    {new Date(run.createdAt).toLocaleString("pt-BR")} · {run.entryCount} lançamentos · {money(Number(run.totalDebitCents) / 100)}
                  </span>
                  <small>
                    {dateBR(run.periodStart)} a {dateBR(run.periodEnd)}
                  </small>
                </div>
              ))}
              {!(comparison.data?.runs.length ?? 0) && (
                <div className="empty">O histórico começará a ser comparado a partir das próximas importações.</div>
              )}
            </div>
            <div className="increase-list">
              <h3>Maiores aumentos versus média histórica</h3>
              {comparison.data?.changes.map((change) => (
                <div className="increase-row" key={change.date}>
                  <span>{dateBR(change.date)}</span>
                  <b>{money(Number(change.increaseCents) / 100)}</b>
                  <small>
                    média: {money(Number(change.previousDebitCents) / 100)} · atual: {money(Number(change.currentDebitCents) / 100)}
                  </small>
                </div>
              ))}
              {(comparison.data?.runs.length ?? 0) > 0 && !(comparison.data?.changes.length ?? 0) ? (
                <p className="muted">Nenhum aumento de débito por data foi identificado em relação à média histórica disponível.</p>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
