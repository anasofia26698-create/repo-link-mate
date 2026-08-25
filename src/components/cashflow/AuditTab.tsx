import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileSpreadsheet, Pencil, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteKnownIpUser,
  getImportComparison,
  listAuditEvents,
  listKnownIpUsers,
  saveKnownIpUser,
} from "@/lib/cashflow.functions";
import { isPurchaseAccessGranted } from "@/lib/purchaseRules";
import { dateBR, money } from "./format";

const AUDIT_PASSWORD = "2606";

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
    const details = JSON.parse(value) as any;
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
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [identifyingIp, setIdentifyingIp] = useState<string | null>(null);
  const [identifyName, setIdentifyName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newIp, setNewIp] = useState("");
  const [newName, setNewName] = useState("");

  const audit = useQuery({
    queryKey: ["audit-events"],
    queryFn: () => listAuditEvents({ data: { password: AUDIT_PASSWORD, limit: 100 } }),
    enabled: unlocked,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
  const comparison = useQuery({
    queryKey: ["audit-import-comparison"],
    queryFn: () => getImportComparison({ data: { password: AUDIT_PASSWORD } }),
    enabled: unlocked,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
  const knownUsers = useQuery({
    queryKey: ["known-ip-users"],
    queryFn: () => listKnownIpUsers({ data: { password: AUDIT_PASSWORD } }),
    enabled: unlocked,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["audit-events"] });
    queryClient.invalidateQueries({ queryKey: ["known-ip-users"] });
  };

  const saveMutation = useMutation({
    mutationFn: saveKnownIpUser,
    onError: () => toast.error("Não foi possível salvar o usuário deste IP."),
  });
  const removeMutation = useMutation({
    mutationFn: deleteKnownIpUser,
    onError: () => toast.error("Não foi possível remover o IP."),
  });

  const identify = () => {
    const name = identifyName.trim();
    if (!identifyingIp || !name) {
      toast.error("Informe o nome do usuário.");
      return;
    }
    saveMutation.mutate(
      { data: { password: AUDIT_PASSWORD, ipAddress: identifyingIp, userName: name } },
      {
        onSuccess: () => {
          toast.success(`IP identificado como ${name}.`);
          setIdentifyingIp(null);
          setIdentifyName("");
          refresh();
        },
      },
    );
  };

  const addKnownUser = () => {
    const ip = newIp.trim();
    const name = newName.trim();
    if (!ip || !name) {
      toast.error("Informe o IP e o nome do usuário.");
      return;
    }
    saveMutation.mutate(
      { data: { password: AUDIT_PASSWORD, ipAddress: ip, userName: name } },
      {
        onSuccess: () => {
          toast.success("IP cadastrado com sucesso.");
          setNewIp("");
          setNewName("");
          refresh();
        },
      },
    );
  };

  const saveEdit = () => {
    const user = knownUsers.data?.find((item) => item.id === editingId);
    const name = editingName.trim();
    if (!user || !name) {
      toast.error("Informe o nome do usuário.");
      return;
    }
    saveMutation.mutate(
      { data: { password: AUDIT_PASSWORD, ipAddress: user.ipAddress, userName: name } },
      {
        onSuccess: () => {
          toast.success("Nome atualizado.");
          setEditingId(null);
          refresh();
        },
      },
    );
  };

  const removeKnown = (id: number) => {
    removeMutation.mutate(
      { data: { password: AUDIT_PASSWORD, id } },
      {
        onSuccess: () => {
          toast.success("IP removido da lista de usuários conhecidos.");
          refresh();
        },
      },
    );
  };

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
      <div className="audit-columns">
        <section className="card audit-card">
          <div className="card-heading">
            <div>
              <h2>Eventos recentes</h2>
              <p>Histórico imutável de acessos, importações, simulações e confirmações, com quem inseriu e o IP de origem.</p>
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
                  const displayName = event.knownName || event.userName;
                  return (
                    <div className="audit-item" key={event.id}>
                      <div>
                        <strong>{auditEventLabel(event.eventType)}</strong>
                        <span>
                          {displayName ? (
                            <>
                              {displayName}
                              {event.userEmail ? ` · ${event.userEmail}` : ""}
                            </>
                          ) : event.ipAddress ? (
                            <span className="audit-unidentified">Não identificado (IP: {event.ipAddress})</span>
                          ) : (
                            "Visitante não identificado"
                          )}
                        </span>
                        {!displayName && event.ipAddress ? (
                          identifyingIp === event.ipAddress ? (
                            <div className="identify-form">
                              <input
                                value={identifyName}
                                onChange={(inputEvent) => setIdentifyName(inputEvent.target.value)}
                                placeholder="Nome do usuário (ex.: Mauricio)"
                                autoFocus
                              />
                              <button className="btn btn-dark" onClick={identify} disabled={saveMutation.isPending}>
                                Salvar
                              </button>
                              <button
                                className="btn btn-light"
                                onClick={() => {
                                  setIdentifyingIp(null);
                                  setIdentifyName("");
                                }}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              className="identify-btn"
                              onClick={() => {
                                setIdentifyingIp(event.ipAddress);
                                setIdentifyName("");
                              }}
                            >
                              <UserPlus size={13} /> Identificar usuário
                            </button>
                          )
                        ) : null}
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
              <p>Compara a importação mais recente com a média das cinco anteriores e destaca o que mais aumentou desde a última importação.</p>
            </div>
            <FileSpreadsheet size={21} />
          </div>
          {comparison.isLoading ? (
            <div className="empty">Carregando histórico de importações...</div>
          ) : (
            <div className="comparison-content comparison-content-stacked">
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
      </div>
      <section className="card known-users-card">
        <div className="card-heading">
          <div>
            <h2>Usuários conhecidos</h2>
            <p>IPs cadastrados e o nome exibido na auditoria. Edite o nome ou remova um IP quando necessário.</p>
          </div>
          <UserPlus size={21} />
        </div>
        {knownUsers.isLoading ? (
          <div className="empty">Carregando usuários conhecidos...</div>
        ) : (
          <div className="known-user-list">
            {knownUsers.data?.map((user) => (
              <div className="known-user-row" key={user.id}>
                {editingId === user.id ? (
                  <input value={editingName} onChange={(inputEvent) => setEditingName(inputEvent.target.value)} autoFocus />
                ) : (
                  <strong>{user.userName}</strong>
                )}
                <span>{user.ipAddress}</span>
                <div className="known-user-actions">
                  {editingId === user.id ? (
                    <>
                      <button className="icon-btn" onClick={saveEdit} aria-label="Salvar nome" disabled={saveMutation.isPending}>
                        <Check size={15} />
                      </button>
                      <button className="icon-btn" onClick={() => setEditingId(null)} aria-label="Cancelar edição">
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="icon-btn"
                        onClick={() => {
                          setEditingId(user.id);
                          setEditingName(user.userName);
                        }}
                        aria-label="Editar nome"
                      >
                        <Pencil size={15} />
                      </button>
                      <button className="icon-btn" onClick={() => removeKnown(user.id)} aria-label="Remover IP" disabled={removeMutation.isPending}>
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!knownUsers.data?.length && <div className="empty">Nenhum IP cadastrado ainda.</div>}
          </div>
        )}
        <div className="known-user-form">
          <label>
            IP do usuário
            <input value={newIp} onChange={(inputEvent) => setNewIp(inputEvent.target.value)} placeholder="Ex.: 2804:79d4:... ou 207.248.5.43" />
          </label>
          <label>
            Nome
            <input value={newName} onChange={(inputEvent) => setNewName(inputEvent.target.value)} placeholder="Ex.: Mauricio" />
          </label>
          <button className="btn btn-dark" onClick={addKnownUser} disabled={saveMutation.isPending}>
            Cadastrar IP
          </button>
        </div>
      </section>
    </section>
  );
}
