import type { Ctx } from "./context.js";

/** Etiqueta (normalizada) con la que `ops_logs` nombra sus copias en LogStore. */
export const OPS_LOGS_SLUG = "ops-logs-";
/** Retención única de las copias de `ops_logs`: 7 días. */
export const OPS_LOGS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const OPS_LOG_NAME_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})-[0-9a-f]{8}-ops-logs-[a-z0-9-]*\.log$/;

/**
 * Borra las copias vencidas de `ops_logs` (misma seguridad que `LogStore.purgeOlderThan`: solo nombres exactos,
 * sin symlinks, otros logs intactos). Best-effort: nunca lanza ni hace fallar al llamador. No hay demonio ni
 * temporizador: solo corre cuando se invoca, así que no garantiza un plazo de borrado.
 */
export async function purgeExpiredOpsLogs(ctx: Pick<Ctx, "logs">): Promise<void> {
  try {
    await ctx.logs.purgeOlderThan(OPS_LOGS_SLUG, OPS_LOGS_RETENTION_MS);
  } catch {
    /* sin efecto */
  }
}

/** True si `ref` es una copia de `ops_logs` cuya marca de tiempo (del nombre, UTC) supera la retención. */
export function isExpiredOpsLog(ref: string, now: Date): boolean {
  const m = OPS_LOG_NAME_RE.exec(ref);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, se) < now.getTime() - OPS_LOGS_RETENTION_MS;
}
