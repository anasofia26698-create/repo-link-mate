import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const entrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  debitCents: z.number().int().min(0).max(100_000_000_00),
});

const importMetaSchema = z.object({
  fileName: z.string().max(255).optional(),
  mappedColumns: z.record(z.string(), z.string()),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalDebitCents: z.number().int().min(0),
});

function requestActor(actorName?: string) {
  const request = getRequest();
  const headers = request?.headers;
  const forwarded = headers?.get("x-forwarded-for") ?? "";
  return {
    actorName: actorName?.trim() || undefined,
    ipAddress: forwarded.split(",")[0]?.trim() || headers?.get("cf-connecting-ip") || undefined,
    userAgent: headers?.get("user-agent") ?? undefined,
    route: request ? new URL(request.url).pathname : "/",
  };
}

export const listCashFlow = createServerFn({ method: "GET" }).handler(async () => {
  const { listSharedEntries } = await import("./cashflow.server");
  return listSharedEntries();
});

export const getOctoberAccounting = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const url = process.env["SUPABASE_URL"];
  if (!key || !url) throw new Error("Não foi possível carregar os totais de outubro.");
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
      headers.set("apikey", key);
      return fetch(input, { ...init, headers });
    } },
  });
  const { data, error } = await client.from("purchase_month_accounting")
    .select("total_cents,paid_cents,open_cents").eq("period", "2026-10").single();
  if (error) throw new Error("Não foi possível carregar os totais de outubro.");
  return { totalCents: Number(data.total_cents), paidCents: Number(data.paid_cents), openCents: Number(data.open_cents) };
});

export const recordAccess = createServerFn({ method: "POST" }).handler(async () => {
  const { insertAuditEvent } = await import("./cashflow.server");
  await insertAuditEvent({ eventType: "access", actor: requestActor() });
  return { ok: true };
});

export const replaceImport = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        entries: z.array(entrySchema).min(1).max(5000),
        actorName: z.string().max(120).optional(),
        importMeta: importMetaSchema.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { replaceImportedEntries } = await import("./cashflow.server");
    return replaceImportedEntries({
      entries: data.entries,
      actor: requestActor(data.actorName),
      importMeta: data.importMeta,
    });
  });

export const confirmPurchases = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        entries: z
          .array(entrySchema.extend({ termDays: z.number().int().min(0).max(3650).optional() }))
          .min(1)
          .max(60),
        actorName: z.string().max(120).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { confirmPurchaseEntries } = await import("./cashflow.server");
    return confirmPurchaseEntries({
      entries: data.entries,
      actor: requestActor(data.actorName),
    });
  });

export const recordSimulation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        purchaseCents: z.number().int().min(0),
        actorName: z.string().max(120).optional(),
        scenarios: z
          .array(
            z.object({
              termDays: z.number().int(),
              paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              existingDebitCents: z.number().int(),
              installmentCents: z.number().int(),
              limitCents: z.number().int(),
              canBuy: z.boolean(),
            }),
          )
          .max(12),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { insertAuditEvent } = await import("./cashflow.server");
    await insertAuditEvent({
      eventType: "simulation",
      actor: requestActor(data.actorName),
      entryCount: data.scenarios.length,
      details: {
        referenceDate: data.referenceDate,
        purchaseCents: data.purchaseCents,
        scenarios: data.scenarios,
      },
    });
    return { ok: true };
  });

export const listAuditEvents = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ password: z.string(), limit: z.number().int().min(1).max(200).default(100) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { isPurchaseAccessGranted } = await import("./purchaseRules");
    if (!isPurchaseAccessGranted(data.password)) {
      throw new Error("Senha incorreta.");
    }
    const { recentAuditEvents } = await import("./cashflow.server");
    return recentAuditEvents(data.limit);
  });

export const getImportComparison = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ password: z.string() }).parse(data))
  .handler(async ({ data }) => {
    const { isPurchaseAccessGranted } = await import("./purchaseRules");
    if (!isPurchaseAccessGranted(data.password)) {
      throw new Error("Senha incorreta.");
    }
    const { importComparison } = await import("./cashflow.server");
    return importComparison();
  });

function requireAuditPassword(password: string) {
  return import("./purchaseRules").then(({ isPurchaseAccessGranted }) => {
    if (!isPurchaseAccessGranted(password)) {
      throw new Error("Senha incorreta.");
    }
  });
}

export const listKnownIpUsers = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ password: z.string() }).parse(data))
  .handler(async ({ data }) => {
    await requireAuditPassword(data.password);
    const { listKnownIpUsers: listUsers } = await import("./cashflow.server");
    return listUsers();
  });

export const saveKnownIpUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        password: z.string(),
        ipAddress: z.string().trim().min(3).max(64),
        userName: z.string().trim().min(1).max(120),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireAuditPassword(data.password);
    const { saveKnownIpUser: save } = await import("./cashflow.server");
    return save({ ipAddress: data.ipAddress, userName: data.userName });
  });

export const deleteKnownIpUser = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ password: z.string(), id: z.number().int() }).parse(data))
  .handler(async ({ data }) => {
    await requireAuditPassword(data.password);
    const { removeKnownIpUser } = await import("./cashflow.server");
    return removeKnownIpUser(data.id);
  });
