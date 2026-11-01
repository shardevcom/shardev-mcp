import { ShardevError } from "../core/errors.js";
import { applyApp, planApp } from "../gen/app.js";
import type { Ctx, ToolOutcome } from "./context.js";

const rejected = (e: ShardevError): ToolOutcome => ({ text: e.message, isError: true, decision: "rejected" });

/** app_plan: sin plan_id ni escritura si hay conflictos (isError). */
export async function appPlan(ctx: Ctx, args: unknown): Promise<ToolOutcome> {
  try {
    const plan = await planApp(ctx, args);
    const note = plan.plan_id
      ? "Plan válido. Nada se escribió todavía: aplica con app_create(plan_id) (vigente 30 min; queda atado al estado actual de los archivos que toca)."
      : "El plan tiene conflictos y NO se guardó (sin plan_id): corrígelos y vuelve a planear. No se escribió nada.";
    return { text: JSON.stringify({ note, ...plan }, null, 2), isError: plan.plan_id === null, decision: plan.plan_id ? "allowed" : "rejected" };
  } catch (e) {
    if (e instanceof ShardevError) return rejected(e);
    throw e;
  }
}

export async function appCreate(ctx: Ctx, args: { plan_id: string }): Promise<ToolOutcome> {
  try {
    const r = await applyApp(ctx, args.plan_id);
    return { text: JSON.stringify(r, null, 2), isError: !r.ok, decision: r.ok ? "allowed" : "error" };
  } catch (e) {
    if (e instanceof ShardevError) return rejected(e);
    throw e;
  }
}
