import { ShardevError } from "../core/errors.js";
import { wrapUntrusted } from "../core/output.js";
import type { Ctx, ToolOutcome } from "./context.js";

export interface LogReadArgs {
  ref: string;
  grep?: string;
  context?: number;
  offset?: number;
  limit?: number;
}

export async function logRead(ctx: Ctx, args: LogReadArgs): Promise<ToolOutcome> {
  try {
    const r = await ctx.logs.read(args.ref, args);
    const head = `log_ref: ${r.ref} | líneas totales: ${r.totalLines} | devueltas: ${r.returnedLines}${r.truncated ? " | recortado" : ""}`;
    return { text: `${head}\n${wrapUntrusted(r.ref, r.text || "(sin coincidencias)")}`, isError: false, decision: "allowed" };
  } catch (e) {
    if (e instanceof ShardevError) return { text: e.message, isError: true, decision: "rejected" };
    throw e;
  }
}
