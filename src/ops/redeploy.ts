import { changeCommandOutcome } from "./change-command.js";
import { gateChange, type ChangeArgs } from "./change-gate.js";
import type { Ctx, ToolOutcome } from "./context.js";

export type OpsRedeployArgs = ChangeArgs;

/**
 * Redespliegue forzado de servicios ECS (T3). El MCP NUNCA lo ejecuta: valida, decide la política y
 * devuelve el comando `shardev ops redeploy ...` para que lo ejecute una persona por la CLI
 * (con confirmación humana, ver docs/decisions/0010-operaciones-t3.md). No llama a ninguna API de AWS
 * que cambie algo; la única llamada es la de identidad que hace la política.
 */
export async function opsRedeploy(ctx: Ctx, args: OpsRedeployArgs): Promise<ToolOutcome> {
  const gate = await gateChange(ctx, args, "ecs");
  if (!gate.ok) return gate.outcome;
  return changeCommandOutcome(gate, "redeploy");
}
