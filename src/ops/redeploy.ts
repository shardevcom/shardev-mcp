import { classifyEnvironment, commandOnlyResponse } from "../core/policy.js";
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
  const prod = classifyEnvironment(gate.env, gate.project.productionEnvs).production;
  const argv = ["shardev", "ops", "redeploy", "--project", gate.project.name, "--env", gate.env.name, ...(gate.all ? ["--all"] : ["--service", gate.services[0]!])];
  const text = [
    `Afectaría a: ${gate.services.join(", ")} (entorno ${gate.env.name}, producción: ${prod ? "sí" : "no"}).`,
    commandOnlyResponse(gate.decision, argv),
  ].join("\n");
  return { text, isError: false, decision: "command-only", project: gate.project.name, env: gate.env.name, exitCode: null };
}
