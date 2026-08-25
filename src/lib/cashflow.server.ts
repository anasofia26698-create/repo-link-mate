import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TEMPORARY_ENTRY_TTL_MS } from "./flowRules";

export type SharedEntry = {
  id: number;
  date: string;
  debitCents: number;
  source: "imported" | "manual";
  createdAt: string;
};

export type ImportMeta = {
  fileName?: string | undefined;
  mappedColumns: Record<string, string>;
  periodStart: string;
  periodEnd: string;
  totalDebitCents: number;
};

export type Actor = {
  actorName?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  route?: string | undefined;
};

function ttlCutoffIso() {
  return new Date(Date.now() - TEMPORARY_ENTRY_TTL_MS).toISOString();
}

/** Manual entries older than 7 days stop affecting the shared flow. */
export async function purgeExpiredManualEntries() {
  await supabaseAdmin
    .from("cash_flow_entries")
    .delete()
    .eq("source", "manual")
    .lt("created_at", ttlCutoffIso());
}

export async function listSharedEntries(): Promise<SharedEntry[]> {
  await purgeExpiredManualEntries();
  const { data, error } = await supabaseAdmin
    .from("cash_flow_entries")
    .select("id,date,debit_cents,source,created_at")
    .order("date", { ascending: true })
    .limit(20000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    date: row.date as string,
    debitCents: Number(row.debit_cents),
    source: row.source as "imported" | "manual",
    createdAt: row.created_at as string,
  }));
}

export async function insertAuditEvent(input: {
  eventType: "access" | "import" | "confirmation" | "simulation";
  actor: Actor;
  entryCount?: number;
  details?: unknown;
}) {
  const { data, error } = await supabaseAdmin
    .from("audit_events")
    .insert({
      event_type: input.eventType,
      user_name: input.actor.actorName ?? null,
      user_email: null,
      ip_address: input.actor.ipAddress ?? null,
      user_agent: input.actor.userAgent ?? null,
      route: input.actor.route ?? "/",
      entry_count: input.entryCount ?? 0,
      details: input.details === undefined ? null : JSON.stringify(input.details),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return Number(data.id);
}

export async function replaceImportedEntries(input: {
  entries: { date: string; debitCents: number }[];
  actor: Actor;
  importMeta?: ImportMeta | undefined;
}): Promise<SharedEntry[]> {
  const auditEventId = await insertAuditEvent({
    eventType: "import",
    actor: input.actor,
    entryCount: input.entries.length,
    details: input.importMeta ?? null,
  });

  const { error: deleteError } = await supabaseAdmin
    .from("cash_flow_entries")
    .delete()
    .eq("source", "imported");
  if (deleteError) throw new Error(deleteError.message);

  if (input.entries.length) {
    const { error } = await supabaseAdmin.from("cash_flow_entries").insert(
      input.entries.map((entry) => ({
        date: entry.date,
        debit_cents: entry.debitCents,
        source: "imported",
        audit_event_id: auditEventId,
      })),
    );
    if (error) throw new Error(error.message);
  }

  if (input.importMeta && input.entries.length) {
    const { data: run, error: runError } = await supabaseAdmin
      .from("cash_flow_import_runs")
      .insert({
        audit_event_id: auditEventId,
        file_name: input.importMeta.fileName ?? null,
        mapped_columns: JSON.stringify(input.importMeta.mappedColumns),
        entry_count: input.entries.length,
        period_start: input.importMeta.periodStart,
        period_end: input.importMeta.periodEnd,
        total_debit_cents: input.importMeta.totalDebitCents,
      })
      .select("id")
      .single();
    if (runError) throw new Error(runError.message);
    const { error: detailError } = await supabaseAdmin
      .from("cash_flow_import_entries")
      .insert(
        input.entries.map((entry) => ({
          import_run_id: run.id,
          date: entry.date,
          debit_cents: entry.debitCents,
        })),
      );
    if (detailError) throw new Error(detailError.message);
  }

  return listSharedEntries();
}

export async function confirmPurchaseEntries(input: {
  entries: { date: string; debitCents: number; termDays?: number | undefined }[];
  actor: Actor;
}): Promise<SharedEntry[]> {
  const totalCents = input.entries.reduce((sum, entry) => sum + entry.debitCents, 0);
  const auditEventId = await insertAuditEvent({
    eventType: "confirmation",
    actor: input.actor,
    entryCount: input.entries.length,
    details: {
      totalCents,
      installments: input.entries.map((entry) => ({
        date: entry.date,
        debitCents: entry.debitCents,
        termDays: entry.termDays ?? null,
      })),
    },
  });

  if (input.entries.length) {
    const { error } = await supabaseAdmin.from("cash_flow_entries").insert(
      input.entries.map((entry) => ({
        date: entry.date,
        debit_cents: entry.debitCents,
        source: "manual",
        audit_event_id: auditEventId,
      })),
    );
    if (error) throw new Error(error.message);
  }

  return listSharedEntries();
}

export type AuditEventRow = {
  id: number;
  eventType: string;
  userName: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  entryCount: number;
  details: string | null;
  createdAt: string;
};

export async function recentAuditEvents(limit: number): Promise<AuditEventRow[]> {
  const { data, error } = await supabaseAdmin
    .from("audit_events")
    .select("id,event_type,user_name,user_email,ip_address,user_agent,entry_count,details,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    eventType: row.event_type as string,
    userName: row.user_name as string | null,
    userEmail: row.user_email as string | null,
    ipAddress: row.ip_address as string | null,
    userAgent: row.user_agent as string | null,
    entryCount: Number(row.entry_count),
    details: row.details as string | null,
    createdAt: row.created_at as string,
  }));
}

export type ImportRunRow = {
  id: number;
  fileName: string | null;
  entryCount: number;
  periodStart: string;
  periodEnd: string;
  totalDebitCents: number;
  createdAt: string;
};

export type ImportComparison = {
  runs: ImportRunRow[];
  changes: {
    date: string;
    currentDebitCents: number;
    previousDebitCents: number;
    increaseCents: number;
  }[];
};

/** Compares the latest import against the average of the five previous ones. */
export async function importComparison(): Promise<ImportComparison> {
  const { data, error } = await supabaseAdmin
    .from("cash_flow_import_runs")
    .select("id,file_name,entry_count,period_start,period_end,total_debit_cents,created_at")
    .order("created_at", { ascending: false })
    .limit(6);
  if (error) throw new Error(error.message);

  const runs: ImportRunRow[] = (data ?? []).map((row) => ({
    id: Number(row.id),
    fileName: row.file_name as string | null,
    entryCount: Number(row.entry_count),
    periodStart: row.period_start as string,
    periodEnd: row.period_end as string,
    totalDebitCents: Number(row.total_debit_cents),
    createdAt: row.created_at as string,
  }));

  if (runs.length < 2) return { runs, changes: [] };

  const currentRun = runs[0];
  if (!currentRun) return { runs, changes: [] };
  const previousRuns = runs.slice(1, 6);
  const runIds = [currentRun.id, ...previousRuns.map((run) => run.id)];

  const { data: rows, error: rowsError } = await supabaseAdmin
    .from("cash_flow_import_entries")
    .select("import_run_id,date,debit_cents")
    .in("import_run_id", runIds)
    .limit(50000);
  if (rowsError) throw new Error(rowsError.message);

  const currentByDate = new Map<string, number>();
  const previousByDate = new Map<string, number[]>();
  const perRunDate = new Map<string, number>();

  for (const row of rows ?? []) {
    const runId = Number(row.import_run_id);
    const date = row.date as string;
    const cents = Number(row.debit_cents);
    if (runId === currentRun.id) {
      currentByDate.set(date, (currentByDate.get(date) ?? 0) + cents);
    } else {
      const key = `${runId}|${date}`;
      perRunDate.set(key, (perRunDate.get(key) ?? 0) + cents);
    }
  }

  for (const [key, cents] of perRunDate) {
    const date = key.split("|")[1]!;
    previousByDate.set(date, [...(previousByDate.get(date) ?? []), cents]);
  }

  const changes = Array.from(currentByDate.entries())
    .map(([date, currentDebitCents]) => {
      const history = previousByDate.get(date) ?? [];
      const previousDebitCents = history.length
        ? Math.round(history.reduce((sum, value) => sum + value, 0) / history.length)
        : 0;
      return {
        date,
        currentDebitCents,
        previousDebitCents,
        increaseCents: currentDebitCents - previousDebitCents,
      };
    })
    .filter((change) => change.increaseCents > 0)
    .sort((a, b) => b.increaseCents - a.increaseCents)
    .slice(0, 12);

  return { runs, changes };
}
