import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Buyer } from "./buyerRules";

export type BuyerIp = { id: number; ipAddress: string; buyer: string };
export type BuyerPayment = { date: string; buyer: string; amountCents: number };
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
  const { data, error } = await supabaseAdmin
    .from("buyer_payments")
    .select("due_date,buyer,amount_cents")
    .order("due_date", { ascending: true })
    .limit(50000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    date: row.due_date as string,
    buyer: row.buyer as string,
    amountCents: Number(row.amount_cents),
  }));
}

/** Substitui todos os pagamentos dos compradores importados pela nova planilha. */
export async function replaceBuyerPayments(input: {
  entries: { date: string; buyer: Buyer | string; amountCents: number }[];
  fileName?: string | undefined;
}): Promise<BuyerPayment[]> {
  const batch = `${Date.now()}-${input.fileName ?? "planilha"}`.slice(0, 120);
  const { error: deleteError } = await supabaseAdmin.from("buyer_payments").delete().gt("id", 0);
  if (deleteError) throw new Error(deleteError.message);
  if (input.entries.length) {
    const { error } = await supabaseAdmin.from("buyer_payments").insert(
      input.entries.map((entry) => ({
        due_date: entry.date,
        buyer: entry.buyer,
        amount_cents: entry.amountCents,
        import_batch: batch,
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
