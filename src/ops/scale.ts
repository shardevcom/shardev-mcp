import { ShardevError } from "../core/errors.js";
import { changeCommandOutcome } from "./change-command.js";
import { gateChange, type ChangeArgs } from "./change-gate.js";
import type { Ctx, ToolOutcome } from "./context.js";

export const MAX_DESIRED_COUNT = 20;

export interface OpsScaleArgs extends ChangeArgs {
  desired_count?: unknown;
}

/** Entero 0-20 o ShardevError; lo comparten la herramienta MCP y la CLI. */
export function parseDesiredCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_DESIRED_COUNT) {
    throw new ShardevError("invalid_input", `desired_count debe ser un entero entre 0 y ${MAX_DESIRED_COUNT}.`);
  }
  return v;
}

/**
 * Cambio de `desired-count` de servicios ECS (T3). El MCP NUNCA lo ejecuta: valida, decide la política y devuelve
 * el comando `shardev ops scale ...` para que lo ejecute una persona por la CLI. Solo se llama a AWS para la identidad.
 */
export async function opsScale(ctx: Ctx, args: OpsScaleArgs): Promise<ToolOutcome> {
  const project = typeof args.project === "string" ? args.project : undefined;
  const env = typeof args.env === "string" ? args.env : undefined;
  let count: number;
  try {
    count = parseDesiredCount(args.desired_count);
  } catch (e) {
    if (e instanceof ShardevError) return { text: e.message, isError: true, decision: "rejected", ...(project ? { project } : {}), ...(env ? { env } : {}) };
    throw e;
  }
  const gate = await gateChange(ctx, args, "ecs");
  if (!gate.ok) return gate.outcome;
  return changeCommandOutcome(gate, "scale", ["--desired-count", String(count)], count === 0 ? ["AVISO: con desired_count 0 los servicios afectados quedan FUERA DE LÍNEA (sin tareas)."] : []);
}
