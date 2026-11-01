import type { AuditEntry } from "../core/audit.js";
import type { OperationDef } from "./catalog.js";
import type { Ctx, ToolOutcome } from "./context.js";

/**
 * Registra en la auditoría una llamada a una operación del catálogo. Lo comparten el servidor MCP
 * y la CLI para que ambos escriban exactamente la misma forma de entrada (solo cambia `source`).
 * Un fallo al escribir nunca se propaga: se avisa por `warn` y la llamada sigue igual.
 */
export async function recordCall(
  ctx: Pick<Ctx, "audit">,
  op: OperationDef,
  call: {
    source: NonNullable<AuditEntry["source"]>;
    args?: Record<string, unknown>;
    outcome: Pick<ToolOutcome, "decision" | "project" | "env" | "exitCode">;
    started: number;
    /** Exit code por defecto cuando el resultado no trae uno. */
    exitCode?: number | null;
    phase?: NonNullable<AuditEntry["phase"]>;
    /** Si es true, un fallo de escritura se propaga (T3 falla cerrado) en vez de solo avisar. */
    strict?: boolean;
  },
  warn: (message: string) => void,
): Promise<void> {
  const { args, outcome } = call;
  try {
    await ctx.audit.record({
      source: call.source,
      ...(call.phase ? { phase: call.phase } : {}),
      tool: op.name,
      project: outcome.project ?? (typeof args?.project === "string" ? args.project : undefined),
      env: outcome.env,
      tier: op.tier,
      decision: outcome.decision,
      exit_code: outcome.exitCode !== undefined ? outcome.exitCode : call.exitCode,
      duration_ms: Date.now() - call.started,
      args,
    });
  } catch (e) {
    if (call.strict) throw e;
    warn(`no se pudo escribir la auditoría: ${e instanceof Error ? e.message : String(e)}`);
  }
}
