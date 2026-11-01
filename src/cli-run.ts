import { readFile } from "node:fs/promises";
import { ShardevError } from "./core/errors.js";
import { defaultPaths } from "./core/paths.js";
import { createContext, type Ctx, type ToolOutcome } from "./ops/context.js";
import { appCreate, appPlan } from "./ops/app.js";
import { opsServices, opsTasks } from "./ops/ecs.js";
import { logRead } from "./ops/log-read.js";
import { purgeExpiredOpsLogs } from "./ops/log-retention.js";
import { opsLogs } from "./ops/logs.js";
import { opsEnvCheck } from "./ops/env-check.js";
import { opsCiCheck, opsCiGenerate } from "./ops/ci.js";
import { recordCall } from "./ops/audit-call.js";
import { APP_CREATE, APP_PLAN, LOG_READ, OPS_CI_CHECK, OPS_CI_GENERATE, OPS_ENV_CHECK, OPS_LOGS, OPS_REDEPLOY, OPS_SCALE, OPS_SERVICES, OPS_STATUS, OPS_TASKS, PROJECT_CREATE, PROJECT_PLAN, PROJECT_VERIFY, type OperationDef } from "./ops/catalog.js";
import { cliRedeploy } from "./ops/redeploy-exec.js";
import { MAX_DESIRED_COUNT } from "./ops/scale.js";
import { cliScale } from "./ops/scale-exec.js";
import { opsStatus } from "./ops/status.js";
import { projectCreate, projectPlan, projectVerify } from "./ops/project.js";

export const CLI_NAME = "shardev";
export const CLI_VERSION = "0.1.0";

export const USAGE = `${CLI_NAME} ${CLI_VERSION}

Uso:
  ${CLI_NAME} mcp serve                                   Inicia el servidor MCP por stdio
  ${CLI_NAME} project plan --spec <spec.json|-> --target <dir> [--detail summary|full] [--json]
  ${CLI_NAME} project create --plan-id <plan_id> [--json]
  ${CLI_NAME} project verify --project <nombre> [--json]
  ${CLI_NAME} app plan --project-path <dir> --key <key> --user-type <new|existing> [--provider <p>] [--table <t>]
        [--model <M>] [--api-guard <g>] [--session-guard <g>] [--port <n>] [--build-dir <d>] [--features otp,social,mfa,invitations] [--social-providers google,microsoft,apple] [--auto-register] [--json]
  ${CLI_NAME} app create --plan-id <plan_id> [--json]
  ${CLI_NAME} ops status [--project <nombre>] [--env <entorno>] [--json]
  ${CLI_NAME} ops services --project <nombre> --env <entorno> [--service <servicio>] [--json]
  ${CLI_NAME} ops tasks --project <nombre> --env <entorno> --service <servicio> [--status RUNNING|STOPPED] [--json]
  ${CLI_NAME} ops logs --project <nombre> --env <entorno> --service <servicio> [--since-minutes <1-1440>] [--filter <texto>] [--limit <1-1000>] [--json]
  ${CLI_NAME} ops env-check --project <nombre> --env <entorno> [--json]
  ${CLI_NAME} ops ci-check --project <nombre> --env <entorno> [--branch <rama>] [--mobile|--no-mobile] [--json]
  ${CLI_NAME} ops ci-generate --project <nombre> --env <entorno> [--branch <rama>] [--mobile|--no-mobile] [--json]
  ${CLI_NAME} ops redeploy --project <nombre> --env <entorno> (--service <servicio> | --all) [--json]
  ${CLI_NAME} ops scale --project <nombre> --env <entorno> (--service <servicio> | --all) --desired-count <0-20> [--json]
  ${CLI_NAME} ops log-read --ref <log_ref> [--grep <texto>] [--context <0-5>] [--offset <n>] [--limit <1-500>] [--json]
  ${CLI_NAME} --version | --help

project plan/create/verify usan las mismas funciones que las herramientas MCP project_plan,
project_create y project_verify (misma política, mismas raíces permitidas, misma auditoría).
app plan/create usan las mismas funciones que las herramientas app_plan y app_create (añadir una app a un
proyecto ya generado; --features admite otp, social, mfa e invitations; mfa no se combina con otp ni social).
ops status|services|tasks|logs|log-read usan las mismas funciones que las herramientas ops_status, ops_services, ops_tasks y
ops_logs y log_read (solo lectura; misma política y auditoría; redeploy es la excepción, y scale también; ver abajo). --env es obligatorio en services/tasks/logs (sin default) y los
servicios deben estar declarados en \`services\` del entorno en ops.yaml. ops logs no imprime el contenido: lo guarda
redactado y muestra el log_ref para leerlo con \`ops log-read --ref <log_ref>\` (o la herramienta MCP log_read).
ops env-check usa la misma función que la herramienta ops_env_check: valida sin conexión .aws/env/<entorno>/ y env.schema
(nunca imprime valores; sale con 1 si algún check falla, los avisos no fallan).
ops ci-check|ci-generate usan las mismas funciones que ops_ci_check y ops_ci_generate: renderizan
.github/templates/deploy.template.yml del proyecto en .github/workflows/deploy-<entorno>.yml. ci-check no escribe (sale con 1 si no
está al día; se ignora la cabecera generada). ci-generate escribe de forma atómica, también en producción (a diferencia de la
herramienta MCP); no hace commit ni push: revisa y versiona el archivo. Sin --branch ni --mobile/--no-mobile se reutilizan las
opciones guardadas en el workflow actual (línea "# Opciones:").
ops redeploy CAMBIA AWS (ecs update-service --force-new-deployment, servicio a servicio, sin esperar). Junto con ops scale son las únicas órdenes de ops que
no son de solo lectura: exige una terminal interactiva (stdin y stderr TTY) y escribir la frase <proyecto>/<entorno>; no existe --yes ni --force. Escribe una entrada
de auditoría de intención antes de cambiar (si falla, no cambia nada) y otra de resultado. Se detiene en el primer fallo y no revierte. "Iniciado" no es
"completado": comprueba con ops services. Un timeout se informa como estado desconocido.
ops scale CAMBIA AWS (ecs update-service --desired-count N): mismas reglas que redeploy (TTY, frase <proyecto>/<entorno>, auditoría de intención, parar en el
primer fallo). Antes de preguntar lee el estado actual y no toca los servicios que ya están en N; con N=0 los servicios quedan fuera de línea y la
frase es <proyecto>/<entorno>/apagar. No detecta autoscaling. AWS aceptar el valor no significa que las tareas ya estén en marcha o detenidas.
ops log-read no necesita --project ni --env: lee solo por referencia y marca el contenido como dato no confiable.
Con --json, si la herramienta responde con JSON, la salida es exactamente ese JSON; un rechazo previo (política, sesión, entrada) puede ser texto: comprueba primero el código de salida, que es distinto de 0 si falla.
`;

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
  stdin: () => Promise<string>;
  /** ¿Es el flujo un terminal real? Opcional: si falta se trata como no-TTY (falla cerrado). Ver core/confirm.ts. */
  isTty?: (stream: "stdin" | "stderr") => boolean;
  /** Lee una sola línea de stdin (sin salto de línea); `null` en EOF. Solo para la confirmación humana. */
  readLine?: () => Promise<string | null>;
}

interface Parsed {
  positional: string[];
  flags: Map<string, string | true>;
}

const VALUE_FLAGS = new Set(["desired-count", "spec", "target", "plan-id", "project", "project-path", "key", "user-type", "provider", "table", "model", "api-guard", "session-guard", "port", "build-dir", "features", "social-providers", "env", "service", "status", "since-minutes", "filter", "limit", "detail", "desired-count", "ref", "grep", "context", "offset", "branch"]);

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-") positional.push(a);
    else if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = (eq === -1 ? a.slice(2) : a.slice(2, eq)).trim();
      if (eq !== -1) flags.set(name, a.slice(eq + 1));
      else if (VALUE_FLAGS.has(name)) {
        const v = argv[++i];
        if (v === undefined) throw new ShardevError("invalid_input", `--${name} necesita un valor`);
        flags.set(name, v);
      } else flags.set(name, true);
    } else positional.push(a);
  }
  return { positional, flags };
}

function need(p: Parsed, name: string): string {
  const v = p.flags.get(name);
  if (typeof v !== "string" || v === "") throw new ShardevError("invalid_input", `Falta --${name}`);
  return v;
}

/** Estado de una invocación de la CLI que `audited` necesita para registrarla. */
interface Call {
  p?: Parsed;
  /** Argumentos tal como se pasan a la función de la herramienta (los mismos que recibiría por MCP). */
  args?: Record<string, unknown>;
  /** Fase de la entrada de resultado en operaciones que cambian algo (ver ops redeploy). */
  phase?: "result";
}

/**
 * Ejecuta `body` y registra una entrada de auditoría con `source: "cli"` (misma operación del catálogo,
 * mismo nivel y mismo registro que el servidor MCP). Si `body` lanza, registra `rejected` (entrada
 * inválida) o `error` y relanza el mismo error. Sin operación identificable (subcomando desconocido) no registra.
 * Un fallo al escribir la auditoría solo avisa por `io.err`.
 */
async function audited(ctx: Ctx, io: CliIo, table: Record<string, OperationDef>, argv: string[], call: Call, body: () => Promise<ToolOutcome>): Promise<ToolOutcome> {
  const started = Date.now();
  const opNow = (): OperationDef | undefined => opFor(table, call.p?.positional[0] ?? argv[0]);
  const warn = (m: string): void => io.err(`[shardev] ${ctx.redactor.redact(m)}\n`);
  let outcome: ToolOutcome;
  try {
    outcome = await body();
  } catch (e) {
    const op = opNow();
    if (op) {
      const rejected = e instanceof ShardevError;
      const flag = (n: string): string | undefined => {
        const v = call.p?.flags.get(n);
        return typeof v === "string" ? v : undefined;
      };
      await recordCall(
        ctx,
        op,
        {
          source: "cli",
          ...(call.phase ? { phase: call.phase } : {}),
          args: call.args ?? (call.p ? Object.fromEntries(call.p.flags) : undefined),
          outcome: { decision: rejected ? "rejected" : "error", project: flag("project"), env: flag("env") },
          started,
          exitCode: rejected && e.code === "invalid_input" ? 2 : 1,
        },
        warn,
      );
    }
    throw e;
  }
  const op = opNow();
  if (op) await recordCall(ctx, op, { source: "cli", ...(call.phase ? { phase: call.phase } : {}), args: call.args, outcome, started, exitCode: outcome.isError ? 1 : 0 }, warn);
  return outcome;
}

const PROJECT_OPS: Record<string, OperationDef> = { plan: PROJECT_PLAN, create: PROJECT_CREATE, verify: PROJECT_VERIFY };
const APP_OPS: Record<string, OperationDef> = { plan: APP_PLAN, create: APP_CREATE };
const OPS_OPS: Record<string, OperationDef> = { status: OPS_STATUS, services: OPS_SERVICES, tasks: OPS_TASKS, logs: OPS_LOGS, "env-check": OPS_ENV_CHECK, "ci-check": OPS_CI_CHECK, "ci-generate": OPS_CI_GENERATE, redeploy: OPS_REDEPLOY, scale: OPS_SCALE, "log-read": LOG_READ };
const opFor = (table: Record<string, OperationDef>, cmd: string | undefined): OperationDef | undefined => (cmd !== undefined && Object.hasOwn(table, cmd) ? table[cmd] : undefined);

/** Salida humana breve a partir del JSON de la herramienta. */
function human(cmd: string, o: ToolOutcome): string {
  if (o.isError && !o.text.trimStart().startsWith("{")) return o.text;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(o.text) as Record<string, unknown>;
  } catch {
    return o.text;
  }
  if (cmd === "plan") {
    const files = Array.isArray(j.files_to_create) ? j.files_to_create.length : typeof (j.files_summary as { total_files?: unknown } | undefined)?.total_files === "number" ? (j.files_summary as { total_files: number }).total_files : 0;
    const conflicts = Array.isArray(j.conflicts) ? (j.conflicts as string[]) : [];
    const cmds = Array.isArray(j.commands) ? (j.commands as Array<{ name: string; runs_in: string }>) : [];
    return [
      String(j.note ?? ""),
      `plan_id: ${String(j.plan_id)}`,
      `destino: ${String(j.target)}`,
      `archivos: ${files}; capas: ${Array.isArray(j.layers) ? (j.layers as string[]).join(", ") : ""}`,
      `pasos: ${cmds.map((c) => `${c.name}(${c.runs_in})`).join(", ")}`,
      ...conflicts.map((c) => `conflicto: ${c}`),
      ...(Array.isArray(j.notes) ? (j.notes as string[]).map((n) => `nota: ${n}`) : []),
    ].join("\n");
  }
  if (cmd === "create") return `${o.isError ? "FALLÓ" : "OK"}: ${String(j.message)}`;
  const steps = Array.isArray(j.steps) ? (j.steps as Array<{ name: string; ok: boolean; duration_ms: number }>) : [];
  return [`${o.isError ? "FALLÓ" : "OK"}: ${String(j.summary)}`, ...steps.map((s) => `  ${s.ok ? "ok " : "ERR"} ${s.name} (${Math.round(s.duration_ms / 1000)}s)`)].join("\n");
}

/** Ejecuta `shardev project ...`. Devuelve el código de salida. `ctx` se inyecta en tests. */
export async function runProject(argv: string[], io: CliIo, ctx: Ctx = createContext(defaultPaths())): Promise<number> {
  const call: Call = {};
  const outcome = await audited(ctx, io, PROJECT_OPS, argv, call, () => projectBody(argv, io, ctx, call));
  const json = call.p?.flags.get("json") === true;
  io.out(`${json ? outcome.text : human(call.p?.positional[0] ?? "", outcome)}\n`);
  return outcome.isError ? 1 : 0;
}

async function projectBody(argv: string[], io: CliIo, ctx: Ctx, call: Call): Promise<ToolOutcome> {
  const p = (call.p = parseArgs(argv));
  const cmd = p.positional[0];
  let outcome: ToolOutcome;
  if (cmd === "plan") {
    const specArg = need(p, "spec");
    const raw = specArg === "-" ? await io.stdin() : await readFile(specArg, "utf8");
    let spec: unknown;
    try {
      spec = JSON.parse(raw);
    } catch (e) {
      throw new ShardevError("invalid_input", `El spec no es JSON válido: ${(e as Error).message.slice(0, 80)}`);
    }
    outcome = await projectPlan(ctx, (call.args = { spec, target: need(p, "target"), detail: strFlag(p, "detail") }));
  } else if (cmd === "create") {
    outcome = await projectCreate(ctx, (call.args = { plan_id: need(p, "plan-id") }));
  } else if (cmd === "verify") {
    outcome = await projectVerify(ctx, (call.args = { project: need(p, "project") }));
  } else {
    throw new ShardevError("invalid_input", `Subcomando de project desconocido: ${cmd ?? "(ninguno)"}`);
  }
  return outcome;
}

/** Ejecuta `shardev app ...`. Devuelve el código de salida. */
export async function runApp(argv: string[], io: CliIo, ctx: Ctx = createContext(defaultPaths())): Promise<number> {
  const call: Call = {};
  const outcome = await audited(ctx, io, APP_OPS, argv, call, () => appBody(argv, ctx, call));
  const json = call.p?.flags.get("json") === true;
  io.out(`${json ? outcome.text : human(call.p?.positional[0] ?? "", outcome)}\n`);
  return outcome.isError ? 1 : 0;
}

async function appBody(argv: string[], ctx: Ctx, call: Call): Promise<ToolOutcome> {
  const p = (call.p = parseArgs(argv));
  const cmd = p.positional[0];
  let outcome: ToolOutcome;
  if (cmd === "plan") {
    const opt = (name: string): string | undefined => {
      const v = p.flags.get(name);
      if (v === undefined) return undefined;
      if (typeof v !== "string" || v === "") throw new ShardevError("invalid_input", `--${name} necesita un valor`);
      return v;
    };
    const portArg = opt("port");
    if (portArg !== undefined && !/^\d+$/.test(portArg)) throw new ShardevError("invalid_input", "--port debe ser un número entero");
    const features = p.flags.has("features") ? String(p.flags.get("features") === true ? "" : p.flags.get("features")).split(",").map((x) => x.trim()).filter(Boolean) : [];
    const list = (name: string): string[] => (p.flags.has(name) ? String(p.flags.get(name) === true ? "" : p.flags.get(name)).split(",").map((x) => x.trim()).filter(Boolean) : []);
    const input: Record<string, unknown> = { project_path: need(p, "project-path"), key: need(p, "key"), user_type: need(p, "user-type"), features, social_providers: list("social-providers"), auto_register: p.flags.get("auto-register") === true };
    for (const [flag, field] of [["provider", "provider"], ["table", "table"], ["model", "model"], ["api-guard", "api_guard"], ["session-guard", "session_guard"], ["build-dir", "build_dir"]] as const) {
      const v = opt(flag);
      if (v !== undefined) input[field] = v;
    }
    if (portArg !== undefined) input.port = Number(portArg);
    outcome = await appPlan(ctx, (call.args = input));
  } else if (cmd === "create") {
    outcome = await appCreate(ctx, (call.args = { plan_id: need(p, "plan-id") }));
  } else {
    throw new ShardevError("invalid_input", `Subcomando de app desconocido: ${cmd ?? "(ninguno)"}`);
  }
  return outcome;
}

function intFlag(p: Parsed, name: string): number | undefined {
  const v = p.flags.get(name);
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw new ShardevError("invalid_input", `--${name} debe ser un número entero`);
  return Number(v);
}

function strFlag(p: Parsed, name: string): string | undefined {
  const v = p.flags.get(name);
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new ShardevError("invalid_input", `--${name} necesita un valor`);
  return v;
}

/** Salida humana breve de las lecturas AWS; con --json se imprime el JSON de la herramienta tal cual. */
function humanOps(cmd: string, o: ToolOutcome): string {
  if (cmd === "redeploy" || cmd === "scale") {
    try {
      const j = JSON.parse(o.text) as { project: string; env: string; production: boolean; services: Array<{ service: string; state: string; deployment_id?: string; desired_count?: number; reason?: string }>; next: string };
      return [
        `${o.isError ? "FALLÓ" : j.services.every((x) => x.state === "unchanged") ? "SIN CAMBIOS" : "INICIADO"}: ${j.project}/${j.env}${j.production ? " (PRODUCCIÓN)" : ""}`,
        ...j.services.map((x) => `  ${x.state.padEnd(13)} ${x.service}${x.deployment_id ? `  ${x.deployment_id}` : ""}${x.desired_count !== undefined ? `  desired ${x.desired_count}` : ""}${x.reason ? `  ${x.reason}` : ""}`),
        j.next,
      ].join("\n");
    } catch {
      return o.text;
    }
  }
  if (o.isError && cmd !== "env-check" && cmd !== "ci-check") return o.text;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(o.text) as Record<string, unknown>;
  } catch {
    return o.text;
  }
  const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  if (cmd === "services") {
    return list(j.services)
      .map((s) => `${String(s.service)}  ${String(s.status)}  ${String(s.running)}/${String(s.desired)} (pend. ${String(s.pending)})  ${String(s.task_definition)}`)
      .concat(list(j.failures).map((f) => `FALLO ${String(f.service)}: ${String(f.reason)}`))
      .join("\n") || "(sin servicios)";
  }
  if (cmd === "tasks") {
    const rows = list(j.tasks).map((t) => `${String(t.task)}  ${String(t.lastStatus)}->${String(t.desiredStatus)}  ${String(t.task_definition)}  inicio ${String(t.startedAt)}${t.stopCode ? `  stop ${String(t.stopCode)}` : ""}`);
    return (rows.length ? rows : ["(sin tareas)"]).concat(j.truncated ? ["(truncado a 20 tareas)"] : []).join("\n");
  }
  if (cmd === "logs") {
    return [
      `eventos: ${String(j.event_count)}${j.truncated ? " (truncado)" : ""}`,
      `rango: ${String(j.first_timestamp)} .. ${String(j.last_timestamp)}`,
      `log_ref: ${String(j.log_ref)}`,
      String(j.como_leerlo),
    ].join("\n");
  }
  if (cmd === "env-check") {
    const checks = Array.isArray(j.checks) ? (j.checks as Array<{ name: string; status: string; message: string }>) : [];
    const c = (j.counts ?? {}) as Record<string, number>;
    return [
      `${j.ok ? "OK" : "FALLÓ"}: ${String(j.project)}/${String(j.env)}  (ok ${c.ok ?? 0}, avisos ${c.warn ?? 0}, fallos ${c.fail ?? 0}, omitidos ${c.skip ?? 0})`,
      ...checks.map((k) => `  ${k.status.padEnd(4)} ${k.name}: ${k.message}`),
    ].join("\n");
  }
  if (cmd === "ci-check" || cmd === "ci-generate") {
    const opt = (j.options ?? {}) as { branch?: string | null; mobile?: boolean; origin?: string };
    return [
      String(j.message),
      `opciones (${String(opt.origin)}): rama ${opt.branch ?? "(solo manual)"}, móvil ${opt.mobile ? "sí" : "no"}`,
      ...(typeof j.diff === "string" && j.diff ? [`líneas distintas: ${String(j.differing_lines)}`, j.diff, ...(j.diff_truncated ? ["(diff truncado)"] : [])] : []),
    ].join("\n");
  }
  return o.text;
}

/** Ejecuta `shardev ops ...` (lecturas y, con `redeploy` y `scale`, un cambio en AWS). Devuelve el código de salida. */
export async function runOps(argv: string[], io: CliIo, ctx: Ctx = createContext(defaultPaths())): Promise<number> {
  await purgeExpiredOpsLogs(ctx);
  const call: Call = {};
  const outcome = await audited(ctx, io, OPS_OPS, argv, call, () => opsBody(argv, io, ctx, call));
  const cmd = call.p?.positional[0] ?? "";
  const json = call.p?.flags.get("json") === true;
  io.out(`${json || cmd === "status" ? ctx.redactor.redact(outcome.text) : ctx.redactor.redact(humanOps(cmd, outcome))}\n`);
  return outcome.isError ? 1 : 0;
}

async function opsBody(argv: string[], io: CliIo, ctx: Ctx, call: Call): Promise<ToolOutcome> {
  const p = (call.p = parseArgs(argv));
  const cmd = p.positional[0];
  const project = strFlag(p, "project");
  const env = strFlag(p, "env");
  let outcome: ToolOutcome;
  if (cmd === "status") {
    outcome = await opsStatus(ctx, (call.args = { project, env }));
  } else if (cmd === "services") {
    outcome = await opsServices(ctx, (call.args = { project: need(p, "project"), env: need(p, "env"), service: strFlag(p, "service") }));
  } else if (cmd === "tasks") {
    outcome = await opsTasks(ctx, (call.args = { project: need(p, "project"), env: need(p, "env"), service: need(p, "service"), status: strFlag(p, "status") }));
  } else if (cmd === "logs") {
    outcome = await opsLogs(ctx, (call.args = {
      project: need(p, "project"),
      env: need(p, "env"),
      service: need(p, "service"),
      since_minutes: intFlag(p, "since-minutes"),
      filter: strFlag(p, "filter"),
      limit: intFlag(p, "limit"),
    }));
  } else if (cmd === "env-check") {
    outcome = await opsEnvCheck(ctx, (call.args = { project: need(p, "project"), env: need(p, "env") }));
  } else if (cmd === "ci-check" || cmd === "ci-generate") {
    if (p.flags.get("mobile") === true && p.flags.get("no-mobile") === true) throw new ShardevError("invalid_input", "--mobile y --no-mobile son excluyentes");
    const ci = (call.args = { project: need(p, "project"), env: need(p, "env"), branch: strFlag(p, "branch"), mobile: p.flags.get("mobile") === true ? true : p.flags.get("no-mobile") === true ? false : undefined });
    // La CLI la ejecuta una persona: puede escribir cualquier entorno (el MCP nunca escribe producción).
    outcome = cmd === "ci-check" ? await opsCiCheck(ctx, ci) : await opsCiGenerate(ctx, ci, { allowProduction: true });
  } else if (cmd === "redeploy" || cmd === "scale") {
    call.phase = "result";
    // Estos subcomandos cambian AWS: cualquier flag fuera de la lista es un error (nada se ignora en silencio, p. ej. --yes).
    const allowed = new Set(["project", "env", "service", "all", "json", ...(cmd === "scale" ? ["desired-count"] : [])]);
    for (const f of p.flags.keys()) if (!allowed.has(f)) throw new ShardevError("invalid_input", `Flag no admitida en ops ${cmd}: --${f}. No existe ninguna forma de omitir la confirmación.`);
    if (p.positional.length > 1) throw new ShardevError("invalid_input", `Argumento no admitido en ops ${cmd}: ${p.positional[1]}`);
    if (p.flags.has("all") && p.flags.get("all") !== true) throw new ShardevError("invalid_input", "--all no admite valor");
    let desired: number | undefined;
    if (cmd === "scale") {
      const raw = strFlag(p, "desired-count");
      if (raw === undefined || !/^\d{1,3}$/.test(raw) || Number(raw) > MAX_DESIRED_COUNT) throw new ShardevError("invalid_input", `Falta --desired-count o no es un entero entre 0 y ${MAX_DESIRED_COUNT}`);
      desired = Number(raw);
    }
    const target = { project: need(p, "project"), env: need(p, "env"), service: strFlag(p, "service"), ...(p.flags.has("all") ? { all: true as const } : {}), ...(desired !== undefined ? { desired_count: desired } : {}) };
    call.args = target;
    outcome = cmd === "scale" ? await cliScale(ctx, io, target, Date.now()) : await cliRedeploy(ctx, io, target, Date.now());
  } else if (cmd === "log-read") {
    const args = { ref: need(p, "ref"), grep: strFlag(p, "grep"), context: intFlag(p, "context"), offset: intFlag(p, "offset"), limit: intFlag(p, "limit") };
    call.args = args;
    // Mismos límites que el esquema de la herramienta MCP log_read.
    const bad =
      args.ref.length > 130 ? "--ref admite hasta 130 caracteres"
      : args.grep !== undefined && args.grep.length > 200 ? "--grep admite hasta 200 caracteres"
      : args.context !== undefined && args.context > 5 ? "--context debe estar entre 0 y 5"
      : args.offset !== undefined && args.offset < 1 ? "--offset debe ser >= 1"
      : args.limit !== undefined && (args.limit < 1 || args.limit > 500) ? "--limit debe estar entre 1 y 500"
      : undefined;
    if (bad) return { text: bad, isError: true, decision: "rejected", exitCode: 1 };
    outcome = await logRead(ctx, args);
  } else {
    throw new ShardevError("invalid_input", `Subcomando de ops desconocido: ${cmd ?? "(ninguno)"}`);
  }
  return outcome;
}
