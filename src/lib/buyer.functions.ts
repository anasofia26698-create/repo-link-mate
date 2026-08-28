import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const passwordSchema = z.object({ password: z.string() });

async function requirePassword(password: string) {
  const { isBuyerModuleAccessGranted } = await import("./buyerRules");
  if (!isBuyerModuleAccessGranted(password)) throw new Error("Senha incorreta.");
}

function currentIp() {
  const request = getRequest();
  const headers = request?.headers;
  const forwarded = headers?.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim() || headers?.get("cf-connecting-ip") || undefined;
}

export const getBuyerContext = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => passwordSchema.parse(data))
  .handler(async ({ data }) => {
    await requirePassword(data.password);
    const server = await import("./buyer.server");
    const ipAddress = currentIp();
    const [buyer, ips, payments, budgets] = await Promise.all([
      server.buyerForIp(ipAddress),
      server.listBuyerIps(),
      server.listBuyerPayments(),
      server.listBuyerBudgets(),
    ]);
    return { ipAddress: ipAddress ?? null, buyer, ips, payments, budgets };
  });

export const saveBuyerIpAddress = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    passwordSchema
      .extend({ ipAddress: z.string().trim().min(3).max(64), buyer: z.string().trim().min(1).max(60) })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requirePassword(data.password);
    const { saveBuyerIp } = await import("./buyer.server");
    return saveBuyerIp({ ipAddress: data.ipAddress, buyer: data.buyer });
  });

export const deleteBuyerIpAddress = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => passwordSchema.extend({ id: z.number().int() }).parse(data))
  .handler(async ({ data }) => {
    await requirePassword(data.password);
    const { removeBuyerIp } = await import("./buyer.server");
    return removeBuyerIp(data.id);
  });

export const importBuyerPayments = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    passwordSchema
      .extend({
        fileName: z.string().max(255).optional(),
        entries: z
          .array(
            z.object({
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              buyer: z.string().min(1).max(60),
              amountCents: z.number().int().min(1).max(100_000_000_00),
            }),
          )
          .min(1)
          .max(20000),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requirePassword(data.password);
    const { replaceBuyerPayments } = await import("./buyer.server");
    return replaceBuyerPayments({ entries: data.entries, fileName: data.fileName });
  });

export const saveBuyerMonthlyBudget = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    passwordSchema
      .extend({
        period: z.string().regex(/^\d{4}-\d{2}$/),
        buyer: z.string().trim().min(1).max(60),
        monthlyCents: z.number().int().min(0),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requirePassword(data.password);
    const { saveBuyerBudget } = await import("./buyer.server");
    return saveBuyerBudget({ period: data.period, buyer: data.buyer, monthlyCents: data.monthlyCents });
  });

/** Visão mensal pública do módulo, usada pelo Dashboard de Compras. */
export const getBuyerMonthlyOverview = createServerFn({ method: "GET" }).handler(async () => {
  const server = await import("./buyer.server");
  const [payments, budgets] = await Promise.all([server.listBuyerPayments(), server.listBuyerBudgets()]);
  return { payments, budgets };
});
