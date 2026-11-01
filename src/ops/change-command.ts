import { classifyEnvironment, commandOnlyResponse } from "../core/policy.js";
import type { ChangeGate } from "./change-gate.js";
import type { ToolOutcome } from "./context.js";

/**
 * Resultado común de las herramientas MCP T3: NO ejecutan nada. Dice brevemente qué afectaría
 * (servicios, entorno, producción sí/no), añade avisos propios y devuelve el comando exacto vía
 * `commandOnlyResponse` (con las notas de la política). Solo con `gate.ok`.
 */
export function changeCommandOutcome(gate: Extract<ChangeGate, { ok: true }>, subcommand: string, extraArgv: readonly string[] = [], warnings: readonly string[] = []): ToolOutcome {
  const prod = classifyEnvironment(gate.env, gate.project.productionEnvs).production;
  const argv = ["shardev", "ops", subcommand, "--project", gate.project.name, "--env", gate.env.name, ...(gate.all ? ["--all"] : ["--service", gate.services[0]!]), ...extraArgv];
  const text = [
    `Afectaría a: ${gate.services.join(", ")} (entorno ${gate.env.name}, producción: ${prod ? "sí" : "no"}).`,
    ...warnings,
    commandOnlyResponse(gate.decision, argv),
  ].join("\n");
  return { text, isError: false, decision: "command-only", project: gate.project.name, env: gate.env.name, exitCode: null };
}
