import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Buyer } from "./buyerRules";

export type BuyerIp = { id: number; ipAddress: string; buyer: string };
export type BuyerPayment = { date: string; buyer: string; amountCents: number; source: "imported" | "confirmed" };

/** Compras confirmadas pelos compradores valem por 7 dias no fluxo. */
const CONFIRMED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function purgeExpiredBuyerConfirmations() {
  await supabaseAdmin
    .from("buyer_payments")
    .delete()
    .eq("source", "confirmed")
    .lt("created_at", new Date(Date.now() - CONFIRMED_TTL_MS).toISOString());
}

export type BuyerGoalConfig = {
  period: string;
  buyer: string;
  salesCents: number;
  cmvPercent: number;
  ips: string[];
};

export type LineGoal = { id: number; period: string; lineName: string; salesCents: number };

const validIp = (ip: string) =>
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(ip) || /^[0-9a-f:]+$/i.test(ip);

export async function listBuyerGoalConfigs(period?: string): Promise<BuyerGoalConfig[]> {
  let query = supabaseAdmin.from("buyer_goal_configs").select("period,buyer,sales_cents,cmv_percent,ips").order("buyer");
  if (period) query = query.eq("period", period);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ period: row.period as string, buyer: row.buyer as string, salesCents: Number(row.sales_cents), cmvPercent: Number(row.cmv_percent), ips: Array.isArray(row.ips) ? row.ips as string[] : [] }));
}

export async function saveBuyerGoalConfig(input: BuyerGoalConfig): Promise<BuyerGoalConfig[]> {
  const ips = [...new Set(input.ips.map((ip) => ip.trim().toLowerCase()).filter(Boolean))];
  if (ips.some((ip) => !validIp(ip))) throw new Error("Informe IPs válidos.");
  const { error } = await supabaseAdmin.from("buyer_goal_configs").upsert(
    { period: input.period, buyer: input.buyer, sales_cents: input.salesCents, cmv_percent: input.cmvPercent, ips, updated_at: new Date().toISOString() },
    { onConflict: "period,buyer" },
  );
  if (error) throw new Error(error.message);
  const existing = await listBuyerIps();
  for (const item of existing.filter((item) => item.buyer === input.buyer && !ips.includes(item.ipAddress))) await removeBuyerIp(item.id);
  for (const ip of ips) await saveBuyerIp({ ipAddress: ip, buyer: input.buyer });
  return listBuyerGoalConfigs(input.period);
}

export async function listLineGoals(period: string): Promise<LineGoal[]> {
  const { data, error } = await supabaseAdmin.from("line_goals").select("id,period,line_name,sales_cents").eq("period", period).order("id");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({ id: Number(row.id), period: row.period as string, lineName: row.line_name as string, salesCents: Number(row.sales_cents) }));
}

export async function replaceLineGoals(input: { period: string; goals: { id?: number; lineName: string; salesCents: number }[] }): Promise<LineGoal[]> {
  const goals = input.goals.map((goal) => ({ ...goal, lineName: goal.lineName.trim() })).filter((goal) => goal.lineName);
  const { error: deleteError } = await supabaseAdmin.from("line_goals").delete().eq("period", input.period);
  if (deleteError) throw new Error(deleteError.message);
  if (goals.length) {
    const { error } = await supabaseAdmin.from("line_goals").insert(goals.map((goal) => ({ period: input.period, line_name: goal.lineName, sales_cents: goal.salesCents })));
    if (error) throw new Error(error.message);
  }
  return listLineGoals(input.period);
}

export type BuyerBudget = { period: string; buyer: string; monthlyCents: number };

const normalizeIp = (ip: string) => ip.trim().toLowerCase();

export async function listBuyerIps(): Promise<BuyerIp[]> {
  const { data, error } = await supabaseAdmin
    .from("buyer_ips")
    .select("id,ip_address,buyer")
    .order("buyer", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    ipAddress: row.ip_address as string,
    buyer: row.buyer as string,
  }));
}

export async function saveBuyerIp(input: { ipAddress: string; buyer: string }): Promise<BuyerIp[]> {
  const { error } = await supabaseAdmin
    .from("buyer_ips")
    .upsert(
      { ip_address: normalizeIp(input.ipAddress), buyer: input.buyer, updated_at: new Date().toISOString() },
      { onConflict: "ip_address" },
    );
  if (error) throw new Error(error.message);
  return listBuyerIps();
}

export async function removeBuyerIp(id: number): Promise<BuyerIp[]> {
  const { error } = await supabaseAdmin.from("buyer_ips").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return listBuyerIps();
}

export async function buyerForIp(ipAddress: string | undefined): Promise<string | null> {
  if (!ipAddress) return null;
  const { data, error } = await supabaseAdmin
    .from("buyer_ips")
    .select("buyer")
    .eq("ip_address", normalizeIp(ipAddress))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.buyer as string | undefined) ?? null;
}

export async function listBuyerPayments(): Promise<BuyerPayment[]> {
  await purgeExpiredBuyerConfirmations();
  const { data, error } = await supabaseAdmin
    .from("buyer_payments")
    .select("due_date,buyer,amount_cents,source")
    .order("due_date", { ascending: true })
    .limit(50000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    date: row.due_date as string,
    buyer: row.buyer as string,
    amountCents: Number(row.amount_cents),
    source: ((row as { source?: string }).source === "confirmed" ? "confirmed" : "imported") as "imported" | "confirmed",
  }));
}

/** Compras confirmadas pelo comprador entram no fluxo e expiram em 7 dias. */
export async function confirmBuyerPurchase(input: {
  entries: { date: string; buyer: Buyer | string; amountCents: number }[];
}): Promise<BuyerPayment[]> {
  if (input.entries.length) {
    const { error } = await supabaseAdmin.from("buyer_payments").insert(
      input.entries.map((entry) => ({
        due_date: entry.date,
        buyer: entry.buyer,
        amount_cents: entry.amountCents,
        source: "confirmed",
        import_batch: null,
      })),
    );
    if (error) throw new Error(error.message);
  }
  return listBuyerPayments();
}

/** Substitui apenas os pagamentos importados da planilha (confirmações são preservadas). */
export async function replaceBuyerPayments(input: {
  entries: { date: string; buyer: Buyer | string; amountCents: number }[];
  fileName?: string | undefined;
}): Promise<BuyerPayment[]> {
  const batch = `${Date.now()}-${input.fileName ?? "planilha"}`.slice(0, 120);
  const { error: deleteError } = await supabaseAdmin.from("buyer_payments").delete().eq("source", "imported");
  if (deleteError) throw new Error(deleteError.message);
  if (input.entries.length) {
    const { error } = await supabaseAdmin.from("buyer_payments").insert(
      input.entries.map((entry) => ({
        due_date: entry.date,
        buyer: entry.buyer,
        amount_cents: entry.amountCents,
        import_batch: batch,
        source: "imported",
      })),
    );
    if (error) throw new Error(error.message);
  }
  return listBuyerPayments();
}

export async function listBuyerBudgets(): Promise<BuyerBudget[]> {
  const { data, error } = await supabaseAdmin
    .from("buyer_budgets")
    .select("period,buyer,monthly_cents")
    .order("period", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    period: row.period as string,
    buyer: row.buyer as string,
    monthlyCents: Number(row.monthly_cents),
  }));
}

export async function saveBuyerBudget(input: { period: string; buyer: string; monthlyCents: number }): Promise<BuyerBudget[]> {
  const { error } = await supabaseAdmin
    .from("buyer_budgets")
    .upsert(
      { period: input.period, buyer: input.buyer, monthly_cents: input.monthlyCents, updated_at: new Date().toISOString() },
      { onConflict: "period,buyer" },
    );
  if (error) throw new Error(error.message);
  return listBuyerBudgets();
}
