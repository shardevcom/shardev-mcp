import type { ConfirmIo } from "../core/confirm.js";
import { OPS_REDEPLOY } from "./catalog.js";
import type { ChangeArgs } from "./change-gate.js";
import { list, rec, runChange } from "./change-exec.js";
import type { Ctx, ToolOutcome } from "./context.js";

/**
 * Ejecución REAL de `shardev ops redeploy` (solo CLI): `ecs update-service --force-new-deployment`.
 * El flujo común (confirmación, auditoría de intención, secuencia, parada) vive en change-exec.ts.
 * Este módulo solo se importa desde cli-run.ts. Que update-service devuelva significa "iniciado", no "completado".
 * Ver docs/decisions/0010-operaciones-t3.md.
 */
export async function cliRedeploy(ctx: Ctx, io: ConfirmIo, args: ChangeArgs, started: number): Promise<ToolOutcome> {
  return runChange(ctx, io, OPS_REDEPLOY, args, started, async (gate) => ({
    plan: {
      phrase: `${gate.project.name}/${gate.env.name}`,
      title: "Redespliegue forzado (ecs update-service --force-new-deployment)",
      serviceLines: [`Servicios (${gate.services.length}): ${gate.services.join(", ")}`],
      effect: "reinicio gradual de las tareas de cada servicio; se lanza en orden y se detiene en el primer fallo.",
      params: ["--force-new-deployment"],
      pick: (json) => {
        const dep = list(rec(rec(json).service).deployments).map(rec).find((d) => d.status === "PRIMARY");
        return typeof dep?.id === "string" ? { deployment_id: dep.id.slice(0, 100) } : {};
      },
      next: (project, env) => `Despliegue iniciado (update-service solo lo lanza; puede seguir en curso). Comprueba el avance con: shardev ops services --project ${project} --env ${env}`,
      noChangeNext: () => "Sin cambios.",
    },
  }));
}
