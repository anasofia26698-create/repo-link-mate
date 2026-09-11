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
  knownName: string | null;
};

export async function recentAuditEvents(limit: number): Promise<AuditEventRow[]> {
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const [eventsResult, knownIps] = await Promise.all([
    supabaseAdmin
      .from("audit_events")
      .select("id,event_type,user_name,user_email,ip_address,user_agent,entry_count,details,created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit),
    listKnownIpUsers(),
  ]);
  if (eventsResult.error) throw new Error(eventsResult.error.message);
  const nameByIp = new Map(knownIps.map((item) => [normalizeIp(item.ipAddress), item.userName]));
  return (eventsResult.data ?? []).map((row) => {
    const ipAddress = row.ip_address as string | null;
    return {
      id: Number(row.id),
      eventType: row.event_type as string,
      userName: row.user_name as string | null,
      userEmail: row.user_email as string | null,
      ipAddress,
      userAgent: row.user_agent as string | null,
      entryCount: Number(row.entry_count),
      details: row.details as string | null,
      createdAt: row.created_at as string,
      knownName: ipAddress ? (nameByIp.get(normalizeIp(ipAddress)) ?? null) : null,
    };
  });
}

export type KnownIpUser = {
  id: number;
  ipAddress: string;
  userName: string;
};

const normalizeIp = (ip: string) => ip.trim().toLowerCase();

export async function listKnownIpUsers(): Promise<KnownIpUser[]> {
  const { data, error } = await supabaseAdmin
    .from("known_ip_users")
    .select("id,ip_address,user_name")
    .order("user_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    ipAddress: row.ip_address as string,
    userName: row.user_name as string,
  }));
}

export async function saveKnownIpUser(input: { ipAddress: string; userName: string }): Promise<KnownIpUser[]> {
  const { error } = await supabaseAdmin
    .from("known_ip_users")
    .upsert(
      { ip_address: normalizeIp(input.ipAddress), user_name: input.userName.trim(), updated_at: new Date().toISOString() },
      { onConflict: "ip_address" },
    );
  if (error) throw new Error(error.message);
  return listKnownIpUsers();
}

export async function removeKnownIpUser(id: number): Promise<KnownIpUser[]> {
  const { error } = await supabaseAdmin.from("known_ip_users").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return listKnownIpUsers();
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

export type ImportIncreaseRow = {
  date: string;
  previousDebitCents: number;
  currentDebitCents: number;
  currentIncreaseCents: number;
  nextDebitCents: number;
  nextIncreaseCents: number;
};

export type ImportComparison = {
  runs: ImportRunRow[];
  increases: ImportIncreaseRow[];
};

/** Mantém somente as importações dos últimos dois dias e calcula aumentos futuros. */
export async function importComparison(): Promise<ImportComparison> {
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("cash_flow_import_runs")
    .select("id,file_name,entry_count,period_start,period_end,total_debit_cents,created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
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
  if (!runs.length) return { runs, increases: [] };

  const runIds = runs.map((run) => run.id);
  const { data: rows, error: rowsError } = await supabaseAdmin
    .from("cash_flow_import_entries")
    .select("import_run_id,date,debit_cents")
    .in("import_run_id", runIds)
    .limit(100000);
  if (rowsError) throw new Error(rowsError.message);

  const byRun = new Map<number, Map<string, number>>();
  for (const run of runs) byRun.set(run.id, new Map());
  for (const row of rows ?? []) {
    const values = byRun.get(Number(row.import_run_id));
    if (!values) continue;
    const date = row.date as string;
    values.set(date, (values.get(date) ?? 0) + Number(row.debit_cents));
  }

  const today = new Date().toISOString().slice(0, 10);
  const dates = new Set<string>();
  for (const values of byRun.values()) for (const date of values.keys()) if (date >= today) dates.add(date);
  const latest = runs[0];
  if (!latest) return { runs, increases: [] };
  const current = runs[1] ?? latest;
  const previous = runs[2];
  const nextValues = byRun.get(latest.id) ?? new Map();
  const currentValues = byRun.get(current.id) ?? new Map();
  const previousValues = previous ? byRun.get(previous.id) ?? new Map() : new Map();
  const threshold = 5000 * 100;
  const increases = Array.from(dates)
    .map((date) => {
      const previousDebitCents = previousValues.get(date) ?? 0;
      const currentDebitCents = currentValues.get(date) ?? 0;
      const nextDebitCents = nextValues.get(date) ?? 0;
      return {
        date,
        previousDebitCents,
        currentDebitCents,
        currentIncreaseCents: currentDebitCents - previousDebitCents,
        nextDebitCents,
        nextIncreaseCents: nextDebitCents - currentDebitCents,
      };
    })
    .filter((row) => row.currentIncreaseCents > threshold || row.nextIncreaseCents > threshold)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { runs, increases };
}
