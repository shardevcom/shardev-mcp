import { awsRead } from "../core/aws-read.js";
import type { ConfirmIo } from "../core/confirm.js";
import { OPS_SCALE } from "./catalog.js";
import { list, rec, runChange } from "./change-exec.js";
import type { Ctx, ToolOutcome } from "./context.js";
import { parseDesiredCount, type OpsScaleArgs } from "./scale.js";

const DESCRIBE_BATCH = 10;

/**
 * Ejecución REAL de `shardev ops scale` (solo CLI): `ecs update-service --desired-count N`, sin
 * `--force-new-deployment`. Antes de preguntar lee el estado actual (`ecs describe-services`, lectura permitida); si la
 * lectura falla o falta un servicio, no pregunta ni cambia nada. Los servicios que ya están en N no se tocan.
 * Con N = 0 la frase es `<proyecto>/<entorno>/apagar`. No se intenta detectar autoscaling.
 * Que AWS acepte el desired-count no significa que las tareas ya estén en marcha o detenidas.
 * Solo se importa desde cli-run.ts. Ver docs/decisions/0010-operaciones-t3.md.
 */
export async function cliScale(ctx: Ctx, io: ConfirmIo, args: OpsScaleArgs, started: number): Promise<ToolOutcome> {
  const count = parseDesiredCount(args.desired_count);
  return runChange(ctx, io, OPS_SCALE, args as Record<string, unknown>, started, async (gate) => {
    const fail = (text: string): { outcome: ToolOutcome } => ({ outcome: { text: `No se cambió nada: ${text}`, isError: true, decision: "error", exitCode: 1 } });
    const current = new Map<string, { desired: number; running: number | null }>();
    for (let i = 0; i < gate.services.length; i += DESCRIBE_BATCH) {
      const batch = gate.services.slice(i, i + DESCRIBE_BATCH);
      const r = await awsRead("ecs describe-services", ["--cluster", gate.env.cluster, "--services", ...batch], { profile: gate.env.aws_profile, region: gate.env.region }, { runner: ctx.runner, redactor: ctx.redactor });
      if (r.state === "no-session") return fail(r.message);
      if (r.state !== "ok") return fail(`no se pudo leer el estado actual de los servicios. ${r.message}`);
      for (const raw of list(rec(r.json).services)) {
        const s = rec(raw);
        if (typeof s.serviceName === "string" && typeof s.desiredCount === "number") {
          current.set(s.serviceName, { desired: s.desiredCount, running: typeof s.runningCount === "number" ? s.runningCount : null });
        }
      }
    }
    const missing = gate.services.filter((s) => !current.has(s));
    if (missing.length > 0) return fail(`ECS no devolvió el estado de: ${missing.join(", ")}.`);

    const unchanged = new Map<string, number | undefined>();
    for (const s of gate.services) if (current.get(s)!.desired === count) unchanged.set(s, count);
    const off = count === 0;
    return {
      plan: {
        phrase: `${gate.project.name}/${gate.env.name}${off ? "/apagar" : ""}`,
        title: `Cambio de desired-count a ${count} (ecs update-service --desired-count ${count})`,
        banner: off ? ["!!! LOS SERVICIOS QUEDAN FUERA DE LÍNEA (0 tareas) !!!", "Si existe una política de autoscaling programado, puede volver a cambiar el número de tareas."] : [],
        serviceLines: [`Servicios (${gate.services.length}):`, ...gate.services.map((s) => {
          const c = current.get(s)!;
          return `  ${s}: deseadas ${c.desired} / en ejecución ${c.running ?? "?"} -> ${count}${unchanged.has(s) ? " (sin cambios)" : ""}`;
        })],
        effect: off ? "se piden 0 tareas deseadas: ECS detiene todas las tareas de cada servicio cambiado." : `se piden ${count} tareas deseadas: ECS lanza o detiene tareas hasta alcanzarlo.`,
        unchanged,
        params: ["--desired-count", String(count)],
        pick: (json) => {
          const d = rec(rec(json).service).desiredCount;
          return typeof d === "number" ? { desired_count: d } : {};
        },
        next: (project, env) => `Cambio de desired-count iniciado (que AWS lo acepte no significa que las tareas ya estén en marcha o detenidas). Comprueba el avance con: shardev ops services --project ${project} --env ${env}`,
        noChangeNext: () => `Sin cambios: todos los servicios ya tienen desired-count ${count}.`,
      },
    };
  });
}
