import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sectorGoalSchema } from "./sectorGoalRules";

const credentials = z.object({ password: z.string() });
export const validateGoalsAccess = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => credentials.parse(input))
  .handler(async ({ data }) => {
    const { isPurchaseAccessGranted } = await import("./purchaseRules");
    if (!isPurchaseAccessGranted(data.password)) throw new Error("Senha incorreta.");
    return { ok: true };
  });

export const getSectorGoals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => credentials.parse(input))
  .handler(async ({ data }) => {
    const { isPurchaseAccessGranted } = await import("./purchaseRules");
    if (!isPurchaseAccessGranted(data.password)) throw new Error("Senha incorreta.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.from("purchase_sector_goals").select("sector,period,sales,cmv,initial_stock,final_stock,coverage,turnover");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({ sector: row.sector, period: row.period, sales: Number(row.sales), cmv: Number(row.cmv), initialStock: Number(row.initial_stock), finalStock: Number(row.final_stock), coverage: Number(row.coverage), turnover: Number(row.turnover) }));
  });

export const saveSectorGoals = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => credentials.extend({ goals: z.array(sectorGoalSchema).max(1000), migrate: z.boolean().default(false) }).parse(input))
  .handler(async ({ data }) => {
    const { isPurchaseAccessGranted } = await import("./purchaseRules");
    if (!isPurchaseAccessGranted(data.password)) throw new Error("Senha incorreta.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.rpc("save_sector_goals", { p_goals: data.goals, p_migrate: data.migrate });
    if (error) throw new Error(error.message);
    return { ok: true };
  });