import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { allocateBudgetCents, FLOW_MONTHS, paymentDateError } from "./purchaseValidation";
import { BUYERS } from "./buyerRules";

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

export const recordAccess = createServerFn({ method: "POST" }).handler(async () => {
  const { insertAuditEvent } = await import("./cashflow.server");
  await insertAuditEvent({ eventType: "access", actor: requestActor() });
  return { ok: true };
});

export const listCashFlowMonthBudgets = createServerFn({ method: "GET" }).handler(async () => {
  const { listCashFlowMonthBudgets: list } = await import("./cashflow.server");
  return list();
});

export const savePurchaseMonthPlan = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ password: z.string(), month: z.enum(FLOW_MONTHS), budgetCents: z.number().int().positive(), shares: z.array(z.number().nonnegative()).length(3) }).parse(data))
  .handler(async ({ data }) => {
    const { isPurchaseAccessGranted } = await import("./purchaseRules");
    if (!isPurchaseAccessGranted(data.password)) throw new Error("Senha incorreta.");
    if (data.month === "2026-12") throw new Error("Os valores atuais de dezembro estão preservados.");
    const amounts = allocateBudgetCents(data.budgetCents, data.shares);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("save_purchase_month_plan", {
      p_month: data.month, p_budget: data.budgetCents,
      p_shares: Object.fromEntries(BUYERS.map((buyer, index) => [buyer, data.shares[index] ?? 0])),
      p_allocations: Object.fromEntries(BUYERS.map((buyer, index) => [buyer, amounts[index] ?? 0])),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAuditPurchaseBudgets = createServerFn({ method: "GET" }).handler(async () => {
  const { listAuditPurchaseBudgets: list } = await import("./cashflow.server");
  return list();
});

export const saveCashFlowMonthBudget = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), budgetCents: z.number().int().min(0) }).parse(data))
  .handler(async ({ data }) => {
    const { saveCashFlowMonthBudget: save } = await import("./cashflow.server");
    return save(data.month, data.budgetCents);
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
          .array(entrySchema.extend({ debitCents: z.number().int().min(1, "Valor da parcela muito baixo: informe um valor total maior"), termDays: z.number().int().min(1).max(230).optional() }))
          .min(1)
          .max(60),
        actorName: z.string().max(120).optional(),
        buyer: z.string().trim().min(1).max(60),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const { confirmPurchaseEntries } = await import("./cashflow.server");
    return confirmPurchaseEntries({
      entries: data.entries,
      buyer: data.buyer,
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
    for (const scenario of data.scenarios) {
      const error = paymentDateError(scenario.paymentDate);
      if (error) throw new Error(error);
      if (scenario.installmentCents < 1) throw new Error("Valor da parcela muito baixo: informe um valor total maior");
    }
    if (data.purchaseCents < 1) throw new Error("Valor total da compra deve ser maior que zero");
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
