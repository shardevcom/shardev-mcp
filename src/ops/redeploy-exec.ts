import { awsChange } from "../core/aws-change.js";
import { confirmHuman, type ConfirmIo } from "../core/confirm.js";
import { classifyEnvironment } from "../core/policy.js";
import { recordCall } from "./audit-call.js";
import { OPS_REDEPLOY } from "./catalog.js";
import { gateChange, type ChangeArgs } from "./change-gate.js";
import type { Ctx, ToolOutcome } from "./context.js";

/**
 * Ejecución REAL de `shardev ops redeploy` (solo CLI). Este módulo solo se importa desde cli-run.ts:
 * el servidor MCP no debe poder alcanzarlo (test sobre el grafo de imports). Ver docs/decisions/0010-operaciones-t3.md.
 *
 * Orden: gateChange -> confirmación humana -> auditoría de intención (si falla, NO se cambia nada)
 * -> `ecs update-service --force-new-deployment` servicio a servicio, parando en el primer fallo.
 * La auditoría de resultado la escribe el envoltorio `audited` de cli-run.ts con lo que devuelve esta función.
 * Que update-service devuelva significa "iniciado", no "completado".
 */
export async function cliRedeploy(ctx: Ctx, io: ConfirmIo, args: ChangeArgs, started: number): Promise<ToolOutcome> {
  const gate = await gateChange(ctx, args, "ecs");
  if (!gate.ok) return { ...gate.outcome, exitCode: 1 };
  const { env } = gate;
  const project = gate.project.name;
  const production = classifyEnvironment(env, gate.project.productionEnvs).production;
  const base = { project, env: env.name } as const;
  const refuse = (text: string): ToolOutcome => ({ text, isError: true, decision: "rejected", exitCode: 1, ...base });

  const phrase = `${project}/${env.name}`;
  const summary = [
    `Redespliegue forzado (ecs update-service --force-new-deployment)`,
    `PRODUCCIÓN: ${production ? "SÍ" : "no"}`,
    `Proyecto: ${project}   Entorno: ${env.name}`,
    `Cuenta: ${env.account_id}   Perfil: ${env.aws_profile}   Región: ${env.region}   Cluster: ${env.cluster}`,
    `Servicios (${gate.services.length}): ${gate.services.join(", ")}`,
    `Efecto: reinicio gradual de las tareas de cada servicio; se lanza en orden y se detiene en el primer fallo.`,
  ].map((l) => ctx.redactor.redact(l));

  const c = await confirmHuman(io, { summary, phrase });
  if (c === "no_tty") return refuse("No se cambió nada: la confirmación exige una terminal interactiva (stdin y stderr deben ser TTY); no se acepta por tubería ni con flags.");
  if (c === "eof") return refuse("No se cambió nada: no hubo confirmación (fin de entrada).");
  if (c === "mismatch") return refuse("No se cambió nada: la frase no coincide.");

  // T3 falla cerrado: sin registro de intención no se toca AWS.
  try {
    await recordCall(ctx, OPS_REDEPLOY, { source: "cli", args: args as Record<string, unknown>, outcome: { decision: "allowed", project, env: env.name, exitCode: null }, started, phase: "intent", strict: true }, () => undefined);
  } catch (e) {
    return { text: `No se cambió nada: no se pudo escribir la auditoría de intención (${ctx.redactor.redact(e instanceof Error ? e.message : String(e)).slice(0, 200)}).`, isError: true, decision: "error", exitCode: 1, ...base };
  }

  type Row = { service: string; state: "done" | "failed" | "unknown" | "not_attempted"; deployment_id?: string; reason?: string };
  const rows: Row[] = [];
  let stopped = false;
  for (const service of gate.services) {
    if (stopped) {
      rows.push({ service, state: "not_attempted" });
      continue;
    }
    const r = await awsChange("ecs update-service", ["--cluster", env.cluster, "--service", service, "--force-new-deployment"], { profile: env.aws_profile, region: env.region }, { runner: ctx.runner, redactor: ctx.redactor });
    if (r.state === "ok") {
      const svc = rec(rec(r.json).service);
      const dep = list(svc.deployments).map(rec).find((d) => d.status === "PRIMARY");
      const id = typeof dep?.id === "string" ? dep.id.slice(0, 100) : undefined;
      rows.push({ service, state: "done", ...(id ? { deployment_id: id } : {}) });
      continue;
    }
    stopped = true;
    if (r.state === "timeout") rows.push({ service, state: "unknown", reason: `${r.message} Puede haberse aplicado: verifica con \`shardev ops services --project ${project} --env ${env.name}\`.` });
    else rows.push({ service, state: "failed", reason: ctx.redactor.redact(r.message).slice(0, 400) });
  }
  const ok = rows.every((r) => r.state === "done");
  const result = {
    project,
    env: env.name,
    production,
    services: rows,
    next: `Despliegue iniciado (update-service solo lo lanza; puede seguir en curso). Comprueba el avance con: shardev ops services --project ${project} --env ${env.name}`,
  };
  return { text: JSON.stringify(result, null, 2), isError: !ok, decision: ok ? "allowed" : "error", exitCode: ok ? 0 : 1, ...base };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
