import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { dateBR, money } from "./format";

export function ImportTab({
  onFile,
  onDownload,
  summary,
}: {
  onFile: (file?: File) => void;
  onDownload: () => void;
  summary: { count: number; start: string; end: string; total: number } | null;
}) {
  return (
    <section className="import-page" aria-label="Importar planilha de débitos">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Atualização diária</p>
          <h1>Importar Planilha</h1>
          <p className="subheading">Envie o arquivo de contas a pagar. O sistema usa somente Data de Operação e Débito.</p>
        </div>
      </div>
      <div className="import-grid">
        <label className="dropzone">
          <input type="file" accept=".xlsx,.csv" onChange={(event) => onFile(event.target.files?.[0])} />
          <Upload size={30} />
          <strong>Selecionar arquivo Excel</strong>
          <span>.xlsx ou .csv</span>
        </label>
        <div className="card import-help">
          <FileSpreadsheet size={24} />
          <h2>Modelo correto</h2>
          <p>O arquivo deve conter exatamente estas quatro colunas:</p>
          <div className="columns">
            <span>1. Data de Operação</span>
            <span>2. Crédito</span>
            <span>3. Débito</span>
            <span>4. Saldo</span>
          </div>
          <p className="muted">Durante o processamento, Crédito e Saldo são ignorados. Apenas Débito monta o fluxo.</p>
          <button className="btn btn-dark full" onClick={onDownload}>
            <Download size={16} /> Baixar modelo
          </button>
        </div>
      </div>
      {summary && (
        <section className="card import-summary-card">
          <h2>Última importação desta sessão</h2>
          <div className="import-summary-grid">
            <div>
              <span>Lançamentos</span>
              <strong>{summary.count}</strong>
            </div>
            <div>
              <span>Período</span>
              <strong>
                {dateBR(summary.start)} a {dateBR(summary.end)}
              </strong>
            </div>
            <div>
              <span>Total em débitos</span>
              <strong>{money(summary.total)}</strong>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
