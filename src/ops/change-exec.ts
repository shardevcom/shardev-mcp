import { awsChange } from "../core/aws-change.js";
import { confirmHuman, type ConfirmIo } from "../core/confirm.js";
import { classifyEnvironment } from "../core/policy.js";
import { recordCall } from "./audit-call.js";
import type { OperationDef } from "./catalog.js";
import { gateChange, type ChangeArgs, type ChangeGate } from "./change-gate.js";
import type { Ctx, ToolOutcome } from "./context.js";

export type ServiceState = "done" | "failed" | "unknown" | "not_attempted" | "unchanged";
export interface ServiceRow {
  service: string;
  state: ServiceState;
  deployment_id?: string;
  desired_count?: number;
  reason?: string;
}

/** Lo que cada operación (redeploy, scale) aporta al flujo común. */
export interface ChangePlan {
  /** Frase que la persona debe escribir. */
  phrase: string;
  /** Primera línea del resumen. */
  title: string;
  /** Líneas destacadas justo después de PRODUCCIÓN (p. ej. aviso de apagado). */
  banner?: string[];
  /** Línea(s) de servicios del resumen. */
  serviceLines: string[];
  /** Línea "Efecto". */
  effect: string;
  /** Servicios que ya están en el estado pedido: no se tocan y se informan `unchanged`. */
  unchanged?: Map<string, number | undefined>;
  /** Parámetros de `ecs update-service` para un servicio (sin cluster/servicio/perfil: los pone el ejecutor). */
  params: string[];
  /** Filtra la respuesta de AWS a campos conocidos. */
  pick: (json: unknown) => Pick<ServiceRow, "deployment_id" | "desired_count">;
  next: (project: string, env: string) => string;
  noChangeNext: (project: string, env: string) => string;
}

export type PlanResult = { plan: ChangePlan } | { outcome: ToolOutcome };

/**
 * Flujo común de las órdenes de la CLI que cambian AWS (solo se importa desde cli-run.ts, vía
 * redeploy-exec.ts / scale-exec.ts; el servidor MCP no debe poder alcanzarlo). Orden:
 * gateChange -> plan (puede leer estado y parar sin preguntar) -> confirmación humana -> auditoría de
 * intención (T3 falla cerrado) -> servicio a servicio, parando en el primer fallo.
 * La auditoría de resultado la escribe el envoltorio `audited` de cli-run.ts con lo que se devuelve.
 */
export async function runChange(
  ctx: Ctx,
  io: ConfirmIo,
  op: OperationDef,
  args: ChangeArgs,
  started: number,
  makePlan: (gate: Extract<ChangeGate, { ok: true }>) => Promise<PlanResult>,
): Promise<ToolOutcome> {
  const gate = await gateChange(ctx, args, "ecs");
  if (!gate.ok) return { ...gate.outcome, exitCode: 1 };
  const { env } = gate;
  const project = gate.project.name;
  const production = classifyEnvironment(env, gate.project.productionEnvs).production;
  const base = { project, env: env.name } as const;
  const refuse = (text: string): ToolOutcome => ({ text, isError: true, decision: "rejected", exitCode: 1, ...base });

  const planned = await makePlan(gate);
  if ("outcome" in planned) return { ...planned.outcome, ...base };
  const { plan } = planned;
  const unchanged = plan.unchanged ?? new Map<string, number | undefined>();
  const toChange = gate.services.filter((s) => !unchanged.has(s));

  const result = (rows: ServiceRow[], ok: boolean, next: string): ToolOutcome => ({
    text: JSON.stringify({ project, env: env.name, production, services: rows, next }, null, 2),
    isError: !ok,
    decision: ok ? "allowed" : "error",
    exitCode: ok ? 0 : 1,
    ...base,
  });
  const unchangedRow = (service: string): ServiceRow => {
    const d = unchanged.get(service);
    return { service, state: "unchanged", ...(d !== undefined ? { desired_count: d } : {}) };
  };

  // Nada que cambiar: sin prompt, sin intención y sin llamada de cambio.
  if (toChange.length === 0) return result(gate.services.map(unchangedRow), true, plan.noChangeNext(project, env.name));

  const summary = [
    plan.title,
    `PRODUCCIÓN: ${production ? "SÍ" : "no"}`,
    ...(plan.banner ?? []),
    `Proyecto: ${project}   Entorno: ${env.name}`,
    `Cuenta: ${env.account_id}   Perfil: ${env.aws_profile}   Región: ${env.region}   Cluster: ${env.cluster}`,
    ...plan.serviceLines,
    `Efecto: ${plan.effect}`,
  ].map((l) => ctx.redactor.redact(l));

  const c = await confirmHuman(io, { summary, phrase: plan.phrase });
  if (c === "no_tty") return refuse("No se cambió nada: la confirmación exige una terminal interactiva (stdin y stderr deben ser TTY); no se acepta por tubería ni con flags.");
  if (c === "eof") return refuse("No se cambió nada: no hubo confirmación (fin de entrada).");
  if (c === "mismatch") return refuse("No se cambió nada: la frase no coincide.");

  // T3 falla cerrado: sin registro de intención no se toca AWS.
  try {
    await recordCall(ctx, op, { source: "cli", args: args as Record<string, unknown>, outcome: { decision: "allowed", project, env: env.name, exitCode: null }, started, phase: "intent", strict: true }, () => undefined);
  } catch (e) {
    return { text: `No se cambió nada: no se pudo escribir la auditoría de intención (${ctx.redactor.redact(e instanceof Error ? e.message : String(e)).slice(0, 200)}).`, isError: true, decision: "error", exitCode: 1, ...base };
  }

  const rows: ServiceRow[] = [];
  let stopped = false;
  for (const service of gate.services) {
    if (unchanged.has(service)) {
      rows.push(unchangedRow(service));
      continue;
    }
    if (stopped) {
      rows.push({ service, state: "not_attempted" });
      continue;
    }
    const r = await awsChange("ecs update-service", ["--cluster", env.cluster, "--service", service, ...plan.params], { profile: env.aws_profile, region: env.region }, { runner: ctx.runner, redactor: ctx.redactor });
    if (r.state === "ok") {
      rows.push({ service, state: "done", ...plan.pick(r.json) });
      continue;
    }
    stopped = true;
    if (r.state === "timeout") rows.push({ service, state: "unknown", reason: `${r.message} Puede haberse aplicado: verifica con \`shardev ops services --project ${project} --env ${env.name}\`.` });
    else rows.push({ service, state: "failed", reason: ctx.redactor.redact(r.message).slice(0, 400) });
  }
  return result(rows, rows.every((r) => r.state === "done" || r.state === "unchanged"), plan.next(project, env.name));
}

export const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
