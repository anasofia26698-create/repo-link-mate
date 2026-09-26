import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { LockKeyhole, ShieldAlert, Upload } from "lucide-react";
import {
  BUYERS,
  BUYER_BUSINESS_RULES,
  isBuyerModuleAccessGranted,
  matchBuyer,
  type Buyer,
} from "@/lib/buyerRules";
import {
  getBuyerContext,
  importBuyerPayments,
} from "@/lib/buyer.functions";
import { iso, money, parseBRL } from "@/components/cashflow/format";
import { GoalsTab } from "@/components/cashflow/PurchaseGoals";

type BuyerArea = "metas" | "importar";

function BuyerPasswordGate({ area, onUnlock }: { area: BuyerArea; onUnlock: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return (
    <section className="card access-card">
      <LockKeyhole size={28} />
      <h2>Área protegida</h2>
      <p>Informe a senha para acessar {area === "metas" ? "o Cadastro de Metas" : "a Importação de Planilha"}.</p>
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
  const [area, setArea] = useState<BuyerArea>("metas");
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
        <button className={area === "metas" ? "active" : ""} onClick={() => changeArea("metas")}>
          Cadastro de Metas
        </button>
        <button className={area === "importar" ? "active" : ""} onClick={() => changeArea("importar")}>
          Importação Planilha
        </button>
      </div>
      {!password ? (
        <BuyerPasswordGate area={area} onUnlock={setPassword} />
      ) : area === "metas" ? (
        <GoalsTab requireBuyerAccess={false} />
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
