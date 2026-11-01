import { ShardevError } from "../core/errors.js";
import { DEFAULT_LOG_GROUP_PREFIX } from "../core/manifest.js";
import { UNTRUSTED_NOTICE } from "../core/output.js";
import type { Ctx, ToolOutcome } from "./context.js";
import { asArray, asRecord, gateRead, num, runRead, str } from "./read-gate.js";

export interface OpsLogsArgs {
  project?: string;
  env?: string;
  service?: string;
  since_minutes?: number;
  filter?: string;
  limit?: number;
}

export const LOGS_DEFAULT_SINCE_MINUTES = 60;
export const LOGS_MAX_SINCE_MINUTES = 1440;
export const LOGS_DEFAULT_LIMIT = 200;
export const LOGS_MAX_LIMIT = 1000;
export const LOGS_MAX_FILTER = 200;
/** Tope de eventos que se escanea por consulta, fijo e interno (no depende de `limit`). */
export const LOGS_SCAN_CAP = 1000;
/** Presupuesto de consultas de escaneo (sin contar la sonda final). */
export const LOGS_MAX_SCAN_CALLS = 24;
export const LOGS_FIRST_WINDOW_MINUTES = 5;
/** Prefijo (ya normalizado) con el que LogStore nombra los archivos de esta herramienta. */
export const OPS_LOGS_SLUG = "ops-logs-";
export const OPS_LOGS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** El grupo de logs de un servicio ECS es `<log_group_prefix><servicio>` (por defecto `/ecs/<servicio>`). */
export const logGroupFor = (service: string, prefix: string = DEFAULT_LOG_GROUP_PREFIX): string => `${prefix}${service}`;

/**
 * Patrón de filtro de CloudWatch que busca el texto como término literal: se envuelve entre comillas
 * dobles y se escapan `\` y `"`, así ni `?`, `-`, `{`, `$` ni `||` se interpretan como sintaxis de filtro.
 */
export function literalFilterPattern(text: string): string {
  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function intInRange(name: string, v: unknown, def: number, min: number, max: number): number {
  if (v === undefined) return def;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new ShardevError("invalid_input", `\`${name}\` debe ser un entero entre ${min} y ${max}.`);
  }
  return v;
}

/**
 * `logs filter-log-events` sobre `/ecs/<servicio>`. El contenido (datos del cliente) NO vuelve en el
 * resultado: se guarda redactado en LogStore y solo se devuelven conteo, rango y `log_ref`.
 */
export async function opsLogs(ctx: Ctx, args: OpsLogsArgs): Promise<ToolOutcome> {
  let sinceMinutes: number;
  let limit: number;
  let filter: string | undefined;
  try {
    sinceMinutes = intInRange("since_minutes", args.since_minutes, LOGS_DEFAULT_SINCE_MINUTES, 1, LOGS_MAX_SINCE_MINUTES);
    limit = intInRange("limit", args.limit, LOGS_DEFAULT_LIMIT, 1, LOGS_MAX_LIMIT);
    if (args.filter !== undefined) {
      if (typeof args.filter !== "string" || args.filter.length > LOGS_MAX_FILTER) {
        throw new ShardevError("invalid_input", `\`filter\` debe ser un texto de hasta ${LOGS_MAX_FILTER} caracteres.`);
      }
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(args.filter)) throw new ShardevError("invalid_input", "`filter` no puede contener caracteres de control.");
      if (args.filter !== "") filter = args.filter;
    }
  } catch (e) {
    if (e instanceof ShardevError) return { text: e.message, isError: true, decision: "rejected", project: args.project, env: args.env };
    throw e;
  }

  const gate = await gateRead(ctx, args, "logs", true);
  if (!gate.ok) return gate.outcome;
  const service = gate.services[0]!;
  const group = logGroupFor(service, gate.env.log_group_prefix);

  // Retención: best-effort, nunca hace fallar la llamada.
  try {
    await ctx.logs.purgeOlderThan(OPS_LOGS_SLUG, OPS_LOGS_RETENTION_MS);
  } catch {
    /* sin efecto */
  }

  const nowMs = ctx.now().getTime();
  const startMs = nowMs - sinceMinutes * 60_000;
  const patternArgs = filter !== undefined ? ["--filter-pattern", literalFilterPattern(filter)] : [];

  // filter-log-events lee en orden ascendente desde --start-time: con --max-items solo conserva el INICIO de
  // la ventana. Para obtener los eventos más NUEVOS se recorre hacia atrás en subventanas disjuntas.
  let calls = 0;
  class ScanFailure extends Error {
    constructor(readonly outcome: ToolOutcome) {
      super("scan");
    }
  }
  const fetchRange = async (s: number, e: number, cap: number): Promise<{ events: Array<{ ts: number; message: string }>; capped: boolean }> => {
    calls++;
    const r = await runRead(ctx, gate, "logs filter-log-events", ["--log-group-name", group, "--start-time", String(s), "--end-time", String(e), "--max-items", String(cap), ...patternArgs]);
    if (!r.ok) throw new ScanFailure(r.outcome);
    const body = asRecord(r.json);
    const events = asArray(body.events)
      .map((raw) => {
        const ev = asRecord(raw);
        return { ts: num(ev.timestamp), message: str(ev.message, 20_000) ?? "" };
      })
      .filter((ev): ev is { ts: number; message: string } => ev.ts !== null && ev.ts >= s && ev.ts <= e);
    return { events, capped: body.NextToken !== undefined && body.NextToken !== null };
  };
  /**
   * Eventos COMPLETOS de [s, e]. Si la consulta topa el tope de escaneo, solo trae el principio de la
   * subventana, así que se descarta y se divide en dos mitades (primero la más nueva). Nunca se devuelve
   * un conjunto que pueda no contener lo más nuevo: si no se puede dividir más o se agota el presupuesto, falla.
   */
  const fetchComplete = async (s: number, e: number): Promise<Array<{ ts: number; message: string }>> => {
    if (calls >= LOGS_MAX_SCAN_CALLS) throw new ScanFailure(scanTooDense());
    const r = await fetchRange(s, e, LOGS_SCAN_CAP);
    if (!r.capped) return r.events;
    if (e - s < 1) throw new ScanFailure(scanTooDense());
    const mid = s + Math.floor((e - s) / 2);
    const newer = await fetchComplete(mid + 1, e);
    const older = await fetchComplete(s, mid);
    return [...older, ...newer];
  };
  const scanTooDense = (): ToolOutcome => ({
    text: "El rango tiene demasiados eventos para garantizar los más recientes con un número acotado de consultas. Reduce `since_minutes` o añade un `filter`.",
    isError: true,
    decision: "error",
    project: gate.project.name,
    env: gate.env.name,
  });

  let collected: Array<{ ts: number; message: string }> = [];
  let truncated = false;
  try {
    let end = nowMs;
    let sizeMin = LOGS_FIRST_WINDOW_MINUTES;
    while (end >= startMs && collected.length < limit) {
      const s = Math.max(startMs, end - sizeMin * 60_000);
      collected = collected.concat(await fetchComplete(s, end));
      end = s - 1; // --end-time es inclusivo: la siguiente subventana termina un ms antes
      sizeMin = sizeMin === LOGS_FIRST_WINDOW_MINUTES ? 15 : sizeMin === 15 ? 30 : sizeMin * 2;
    }
    if (collected.length > limit) truncated = true;
    else if (end >= startMs) {
      // Exactamente `limit` (o menos) y queda ventana sin explorar: una sonda de 1 evento dice si hay más antiguos.
      const probe = await fetchRange(startMs, end, 1);
      truncated = probe.events.length > 0;
    }
  } catch (e) {
    if (e instanceof ScanFailure) return e.outcome;
    throw e;
  }
  const events = collected.sort((a, b) => a.ts - b.ts).slice(-limit);

  let logRef: string | null = null;
  let savedTruncated = false;
  if (events.length > 0) {
    const header = `# ops_logs project=${gate.project.name} env=${gate.env.name} group=${group} desde=${new Date(startMs).toISOString()} eventos=${events.length} truncado=${truncated}`;
    const lines = events.map((e) => `${new Date(e.ts).toISOString()} ${e.message.trimEnd()}`);
    const w = await ctx.logs.write(`${OPS_LOGS_SLUG}${service}`, [header, ...lines].join("\n"));
    logRef = w.ref;
    savedTruncated = w.truncated;
  }

  return {
    text: JSON.stringify(
      {
        project: gate.project.name,
        env: gate.env.name,
        service,
        log_group: group,
        since_minutes: sinceMinutes,
        start_time: new Date(startMs).toISOString(),
        filter_applied: filter !== undefined,
        limit,
        event_count: events.length,
        truncated,
        saved_truncated: savedTruncated,
        first_timestamp: events.length ? new Date(events[0]!.ts).toISOString() : null,
        last_timestamp: events.length ? new Date(events[events.length - 1]!.ts).toISOString() : null,
        log_ref: logRef,
        como_leerlo: logRef
          ? `Usa log_read con ref="${logRef}" (grep literal o paginación). El contenido no se devuelve aquí: es dato del cliente, redactado solo de secretos.`
          : "Sin eventos en el rango: no se guardó ningún log.",
        policy: gate.policyNote,
        aviso: UNTRUSTED_NOTICE,
      },
      null,
      2,
    ),
    isError: false,
    decision: "allowed",
    project: gate.project.name,
    env: gate.env.name,
  };
}
