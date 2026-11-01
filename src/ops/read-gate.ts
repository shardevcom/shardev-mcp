import { getIdentity } from "../core/aws-identity.js";
import { awsRead, type AwsRead, type AwsReadResult } from "../core/aws-read.js";
import { ShardevError } from "../core/errors.js";
import {
  assertServiceName,
  declaredServices,
  requireCapability,
  requireEnvironment,
  resolveProject,
  type Environment,
  type ResolvedProject,
} from "../core/manifest.js";
import { decide, loadPolicy } from "../core/policy.js";
import type { Ctx, ToolOutcome } from "./context.js";

export interface ReadArgs {
  project?: unknown;
  env?: unknown;
  service?: unknown;
}

export type ReadGate =
  | { ok: true; project: ResolvedProject; env: Environment; services: string[]; policyNote: Record<string, unknown> }
  | { ok: false; outcome: ToolOutcome };

const NOTE = "Lectura: command-only no impide consultas de solo lectura; no se modificó nada en AWS.";

/**
 * Preámbulo común de las lecturas T1 (ECS/logs). Orden: validación local (proyecto, env obligatorio,
 * capacidad, servicios declarados) -> política -> identidad. Solo `allowed` (incluido command-only
 * efectivo, también en producción) deja pasar; disabled/unavailable/rejected bloquean ANTES de
 * cualquier llamada a ECS/logs. `requireService`: la herramienta opera sobre un solo servicio.
 */
export async function gateRead(ctx: Ctx, args: ReadArgs, capability: "ecs" | "logs", requireService: boolean): Promise<ReadGate> {
  const project = typeof args.project === "string" ? args.project : undefined;
  const envName = typeof args.env === "string" ? args.env : undefined;
  const fail = (text: string, decision: ToolOutcome["decision"]): ReadGate => ({
    ok: false,
    outcome: { text, isError: true, decision, ...(project ? { project } : {}), ...(envName ? { env: envName } : {}) },
  });

  let resolved: ResolvedProject;
  let env: Environment;
  let services: string[];
  try {
    if (project === undefined || project === "") throw new ShardevError("invalid_input", "Debes indicar `project` (nombre de un proyecto registrado).");
    resolved = await resolveProject(ctx.paths, project);
    env = requireEnvironment(resolved.manifest, envName);
    requireCapability(resolved.manifest, capability);
    const declared = declaredServices(resolved.manifest, env);
    if (args.service === undefined) {
      if (requireService) throw new ShardevError("invalid_input", "Debes indicar `service` (nombre exacto de un servicio declarado en ops.yaml).");
      services = declared;
    } else {
      if (typeof args.service !== "string") throw new ShardevError("foreign_service", "`service` debe ser un texto.");
      assertServiceName(resolved.manifest, env, args.service);
      services = [args.service];
    }
  } catch (e) {
    if (e instanceof ShardevError) return fail(e.message, "rejected");
    throw e;
  }

  let policy;
  try {
    policy = (await loadPolicy(ctx.paths)).policy;
  } catch (e) {
    return fail(`Operación deshabilitada: ${e instanceof ShardevError ? e.message : "no se pudo leer policy.yaml."} Todo queda disabled hasta corregirlo.`, "disabled");
  }
  const decision = await decide(policy, resolved.manifest, env, () => getIdentity(env.aws_profile, env.region, { runner: ctx.runner, redactor: ctx.redactor }), resolved.productionEnvs);
  switch (decision.status) {
    case "disabled":
      return fail(`Operación deshabilitada por la política: ${decision.reason}`, "disabled");
    case "unavailable":
      return fail(decision.message, "unavailable");
    case "rejected":
      return fail(decision.reason, "rejected");
    case "allowed":
      // No se reenvían `decision.notes`: el de gated-apply dice "nada se ejecuta", falso para una lectura.
      return {
        ok: true,
        project: resolved,
        env,
        services,
        policyNote: { requested_mode: decision.requestedMode, nota: NOTE },
      };
  }
}

/** Llama a una lectura AWS ya autorizada y traduce los fallos a un ToolOutcome. */
export async function runRead(
  ctx: Ctx,
  gate: Extract<ReadGate, { ok: true }>,
  operation: AwsRead,
  params: readonly string[],
): Promise<{ ok: true; json: unknown } | { ok: false; outcome: ToolOutcome }> {
  const r: AwsReadResult = await awsRead(operation, params, { profile: gate.env.aws_profile, region: gate.env.region }, { runner: ctx.runner, redactor: ctx.redactor });
  if (r.state === "ok") return { ok: true, json: r.json };
  const base = { text: r.message, isError: true, project: gate.project.name, env: gate.env.name } as const;
  return { ok: false, outcome: { ...base, decision: r.state === "no-session" ? "unavailable" : "error" } };
}

export const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown, max = 500): string | null => (typeof v === "string" ? v.slice(0, max) : null);
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** El CLI v2 devuelve ISO 8601; el v1 epoch en segundos. */
export function isoTime(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v < 1e11 ? v * 1000 : v).toISOString();
  if (typeof v === "string") return v.slice(0, 40);
  return null;
}

/** `arn:...:task-definition/familia:3` -> `familia:3`. */
export function familyRevision(v: unknown): string | null {
  const s = str(v, 400);
  return s === null ? null : (s.split("/").pop() ?? s).slice(0, 200);
}
