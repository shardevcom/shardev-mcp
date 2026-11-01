import { randomBytes } from "node:crypto";
import { lstat, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { parseDocument } from "yaml";
import { unifiedDiff } from "../gen/diff.js";
import { ShardevError } from "../core/errors.js";
import { requireEnvironment, resolveProject, type Environment, type ResolvedProject } from "../core/manifest.js";
import { classifyEnvironment, renderCommand } from "../core/policy.js";
import type { Ctx, ToolOutcome } from "./context.js";
import { safeReadFile } from "./env-check.js";

/** Convención documentada en docs/decisions/0009-ci-workflows.md. */
export const TEMPLATE_PARTS = [".github", "templates", "deploy.template.yml"] as const;
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const CI_ENV_RE = /^[a-z][a-z0-9-]{1,30}$/;
const MAX_DIFF_LINES = 120;
const MAX_DIFF_CHARS = 6000;

export interface OpsCiArgs {
  project?: unknown;
  env?: unknown;
  branch?: unknown;
  mobile?: unknown;
}
export interface OpsCiGenerateOptions {
  /** Solo la CLI (una persona) puede escribir un entorno de producción; el MCP nunca. */
  allowProduction?: boolean;
}

interface Options {
  branch: string | undefined;
  mobile: boolean;
}
type Origin = "flags" | "saved" | "defaults";

export const outputRel = (env: string): string => `.github/workflows/deploy-${env}.yml`;

/** Ruta bajo la raíz real sin enlaces simbólicos en ningún componente. `create` crea los directorios que falten. */
async function safeChain(realRoot: string, parts: readonly string[], create: boolean): Promise<{ ok: true; dir: string } | { ok: false; reason: string }> {
  let cur = realRoot;
  for (const part of parts) {
    cur = join(cur, part);
    try {
      const st = await lstat(cur);
      if (st.isSymbolicLink()) return { ok: false, reason: `${relOf(realRoot, cur)} es un enlace simbólico (no se admite)` };
      if (!st.isDirectory()) return { ok: false, reason: `${relOf(realRoot, cur)} no es un directorio` };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") return { ok: false, reason: `no se pudo inspeccionar ${relOf(realRoot, cur)}` };
      if (!create) return { ok: true, dir: cur }; // el llamador verá el archivo ausente
      await mkdir(cur, { mode: 0o755 });
    }
  }
  const real = await realpath(cur).catch(() => cur);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return { ok: false, reason: "queda fuera de la raíz del proyecto" };
  return { ok: true, dir: cur };
}
const relOf = (realRoot: string, p: string): string => p.slice(realRoot.length + 1);

/** Opciones guardadas en la primera línea `# Opciones:` de un workflow ya generado. */
export function parseSavedOptions(text: string): { branch?: string; mobile?: boolean } {
  const line = text.split("\n").find((l) => l.startsWith("# Opciones:"));
  const out: { branch?: string; mobile?: boolean } = {};
  if (!line) return out;
  for (const tok of line.slice("# Opciones:".length).split(/\s+/).filter(Boolean)) {
    if (tok.startsWith("--branch=")) out.branch = tok.slice("--branch=".length);
    else if (tok === "--mobile") out.mobile = true;
    else if (tok === "--no-mobile") out.mobile = false;
  }
  return out;
}

/** Cuerpo comparable: desde la primera línea `name:`; ignora la cabecera generada (la de otras herramientas difiere). */
export function bodyFromName(text: string): string {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  const i = lines.findIndex((l) => l.startsWith("name:"));
  return (i === -1 ? lines : lines.slice(i)).join("\n");
}

const hasMarker = (l: string, m: string): boolean => l.includes(`@@${m}@@`);

/** Quita o conserva los bloques móviles; exige marcadores balanceados (un END perdido borraría el resto del archivo). */
function applyMobile(lines: string[], mobile: boolean): string[] {
  let open = false;
  const out: string[] = [];
  lines.forEach((l, i) => {
    const b = hasMarker(l, "MOBILE_BEGIN");
    const e = hasMarker(l, "MOBILE_END");
    if (b && e) throw new ShardevError("invalid_input", `La plantilla tiene BEGIN y END en la misma línea (${i + 1}).`);
    if (b) {
      if (open) throw new ShardevError("invalid_input", `La plantilla anida @@MOBILE_BEGIN@@ (línea ${i + 1}).`);
      open = true;
      return;
    }
    if (e) {
      if (!open) throw new ShardevError("invalid_input", `@@MOBILE_END@@ sin BEGIN en la plantilla (línea ${i + 1}).`);
      open = false;
      return;
    }
    if (mobile || !open) out.push(l);
  });
  if (open) throw new ShardevError("invalid_input", "La plantilla tiene @@MOBILE_BEGIN@@ sin su @@MOBILE_END@@.");
  return out;
}

/** Función pura: plantilla + opciones => texto del workflow. Lanza ShardevError si algo no cuadra. */
export function renderWorkflow(template: string, input: { project: string; env: string; branch: string | undefined; mobile: boolean }): string {
  const { project, env, branch, mobile } = input;
  const all = template.replaceAll("\r\n", "\n").split("\n");
  const start = all.findIndex((l) => l.startsWith("name:"));
  if (start === -1) throw new ShardevError("invalid_input", "La plantilla no tiene ninguna línea `name:`.");
  const body = applyMobile(all.slice(start), mobile);

  const label = env.charAt(0).toUpperCase() + env.slice(1);
  const trigger = branch
    ? `  push:\n    branches: [${branch}]\n  workflow_dispatch:`
    : `  # Solo manual (Actions → Run workflow). Para desplegar con cada push:\n  #   ${renderCommand(["shardev", "ops", "ci-generate", "--project", project, "--env", env, "--branch", "<rama>"])}\n  workflow_dispatch:`;
  const subs: Array<[string, string]> = [
    ["@@TRIGGER@@", trigger],
    ["@@ENVIRONMENT@@", env],
    ["@@ENV_LABEL@@", label],
    ["@@MOBILE_LABEL@@", mobile ? " + Mobile" : ""],
  ];
  let text = body.join("\n");
  for (const [k, v] of subs) text = text.split(k).join(v);

  const left = text.split("\n").flatMap((l, i) => (l.includes("@@") ? [i + 1] : []));
  if (left.length) throw new ShardevError("invalid_input", `Quedaron marcadores sin reemplazar en las líneas ${left.slice(0, 10).join(", ")} del resultado.`);

  const header = [
    "# ======================================================================",
    `# GENERADO por \`shardev ops ci-generate\` (entorno "${env}") — NO EDITAR A MANO.`,
    `# Opciones:${branch ? ` --branch=${branch}` : ""} ${mobile ? "--mobile" : "--no-mobile"}`,
    `# Plantilla: ${TEMPLATE_PARTS.join("/")}`,
    "# Regenerar: el comando `shardev ops ci-generate` con las opciones de arriba; luego revisar y versionar el cambio.",
    "# ======================================================================",
  ].join("\n");
  const out = `${header}\n${text}`;

  const doc = parseDocument(out);
  if (doc.errors.length) throw new ShardevError("invalid_input", `El workflow generado no es YAML válido: ${doc.errors[0]!.message.split("\n")[0]}`);
  return out.endsWith("\n") ? out : `${out}\n`;
}

function validBranch(branch: unknown, what: string): string | undefined {
  if (branch === undefined || branch === "") return undefined;
  if (typeof branch !== "string" || !BRANCH_RE.test(branch) || branch.length > 200) {
    throw new ShardevError("invalid_input", `${what} inválida: solo se admiten letras, números, ".", "_", "/" y "-".`);
  }
  return branch;
}

interface Plan {
  project: ResolvedProject;
  env: Environment;
  production: boolean;
  options: Options;
  origin: Origin;
  rendered: string;
  rel: string;
  outputDir: string;
  outputPath: string;
  existing: { state: "missing" } | { state: "ok"; text: string };
}

async function plan(ctx: Ctx, args: OpsCiArgs, forWrite: boolean): Promise<Plan> {
  const projectName = typeof args.project === "string" ? args.project : "";
  const envName = typeof args.env === "string" ? args.env : "";
  if (projectName === "") throw new ShardevError("invalid_input", "Debes indicar `project` (nombre de un proyecto registrado).");
  if (envName !== "" && !CI_ENV_RE.test(envName)) throw new ShardevError("invalid_input", "`env` inválido: minúsculas, números y guiones (2-31 caracteres, empieza por letra).");
  if (args.mobile !== undefined && typeof args.mobile !== "boolean") throw new ShardevError("invalid_input", "`mobile` debe ser booleano.");
  const explicitBranch = validBranch(args.branch, "`branch`");

  const project = await resolveProject(ctx.paths, projectName);
  const env = requireEnvironment(project.manifest, envName);
  if (!CI_ENV_RE.test(env.name)) throw new ShardevError("invalid_input", `El entorno "${env.name}" no admite workflows (minúsculas, números y guiones).`);
  const production = classifyEnvironment(env, project.productionEnvs).production;

  let realRoot: string;
  try {
    realRoot = await realpath(project.root);
  } catch {
    throw new ShardevError("invalid_input", "La raíz del proyecto no existe o no es accesible.");
  }

  // Plantilla.
  const tdir = await safeChain(realRoot, TEMPLATE_PARTS.slice(0, -1), false);
  if (!tdir.ok) throw new ShardevError("invalid_input", `Plantilla: ${tdir.reason}.`);
  const tpl = await safeReadFile(join(tdir.dir, TEMPLATE_PARTS[2]), realRoot);
  if (tpl.state === "missing") throw new ShardevError("invalid_input", `No existe la plantilla ${TEMPLATE_PARTS.join("/")} en la raíz del proyecto (cada proyecto aporta la suya).`);
  if (tpl.state === "bad") throw new ShardevError("invalid_input", `La plantilla ${TEMPLATE_PARTS.join("/")} ${tpl.reason}.`);

  // Salida actual.
  const rel = outputRel(env.name);
  const odir = await safeChain(realRoot, [".github", "workflows"], forWrite);
  if (!odir.ok) throw new ShardevError("invalid_input", `Salida: ${odir.reason}.`);
  const outputPath = join(odir.dir, `deploy-${env.name}.yml`);
  const cur = await safeReadFile(outputPath, realRoot);
  if (cur.state === "bad") throw new ShardevError("invalid_input", `${rel} ${cur.reason}.`);
  const existing: Plan["existing"] = cur.state === "ok" ? { state: "ok", text: cur.text } : { state: "missing" };

  // Opciones: explícitas, o las guardadas si no se pasó ninguna (como el script de referencia), o los valores por defecto.
  let branch = explicitBranch;
  let mobile = args.mobile as boolean | undefined;
  let origin: Origin = "defaults";
  if (branch !== undefined || mobile !== undefined) origin = "flags";
  else if (existing.state === "ok") {
    const saved = parseSavedOptions(existing.text);
    branch = validBranch(saved.branch, "La rama guardada en `# Opciones:`");
    mobile = saved.mobile;
    if (branch !== undefined || mobile !== undefined) origin = "saved";
  }
  if (production) {
    if (branch === undefined) {
      throw new ShardevError("invalid_input", `"${env.name}" es producción: indica la rama que despliega con \`branch\` (no hay valor por defecto ni se admite "solo manual" sin decidirlo).`);
    }
    mobile ??= true;
  } else {
    mobile ??= false;
    if (branch === "main" || branch === "master") throw new ShardevError("invalid_input", `"${branch}" despliega producción: usa otra rama para "${env.name}".`);
  }

  const rendered = renderWorkflow(tpl.text, { project: project.name, env: env.name, branch, mobile });
  return { project, env, production, options: { branch, mobile }, origin, rendered, rel, outputDir: odir.dir, outputPath, existing };
}

type Status = "up_to_date" | "missing" | "different";

function compare(p: Plan): { status: Status; differing_lines: number; diff: string; diff_truncated: boolean } {
  if (p.existing.state === "missing") return { status: "missing", differing_lines: 0, diff: "", diff_truncated: false };
  const before = bodyFromName(p.existing.text);
  const after = bodyFromName(p.rendered);
  if (before === after) return { status: "up_to_date", differing_lines: 0, diff: "", diff_truncated: false };
  const full = unifiedDiff(p.rel, before, after);
  const lines = full.split("\n");
  const differing = lines.slice(2).filter((l) => l.startsWith("+") || l.startsWith("-")).length;
  let diff = lines.slice(0, MAX_DIFF_LINES).join("\n");
  let truncated = lines.length > MAX_DIFF_LINES;
  if (diff.length > MAX_DIFF_CHARS) {
    diff = diff.slice(0, MAX_DIFF_CHARS);
    truncated = true;
  }
  return { status: "different", differing_lines: differing, diff, diff_truncated: truncated };
}

const optionsOut = (p: Plan) => ({ branch: p.options.branch ?? null, mobile: p.options.mobile, origin: p.origin });

function regenerateArgv(p: Plan): string[] {
  return ["shardev", "ops", "ci-generate", "--project", p.project.name, "--env", p.env.name, ...(p.options.branch ? ["--branch", p.options.branch] : []), p.options.mobile ? "--mobile" : "--no-mobile"];
}

function reject(e: unknown, args: OpsCiArgs): ToolOutcome {
  if (!(e instanceof ShardevError)) throw e;
  return {
    text: e.message,
    isError: true,
    decision: "rejected",
    ...(typeof args.project === "string" && args.project ? { project: args.project } : {}),
    ...(typeof args.env === "string" && args.env ? { env: args.env } : {}),
  };
}

/** T0: renderiza en memoria y compara con el archivo actual. No escribe nada. */
export async function opsCiCheck(ctx: Ctx, args: OpsCiArgs): Promise<ToolOutcome> {
  let p: Plan;
  try {
    p = await plan(ctx, args, false);
  } catch (e) {
    return reject(e, args);
  }
  const c = compare(p);
  const ok = c.status === "up_to_date";
  const text = ctx.redactor.redact(
    JSON.stringify(
      {
        project: p.project.name,
        env: p.env.name,
        status: c.status,
        path: p.rel,
        options: optionsOut(p),
        differing_lines: c.differing_lines,
        diff: c.diff,
        diff_truncated: c.diff_truncated,
        message: ok
          ? `${p.rel} está al día con la plantilla (se ignora la cabecera generada).`
          : c.status === "missing"
            ? `${p.rel} no existe. Genéralo con: ${renderCommand(regenerateArgv(p))}`
            : `${p.rel} no coincide con la plantilla (${c.differing_lines} línea(s) distintas). Regenera con: ${renderCommand(regenerateArgv(p))}`,
      },
      null,
      2,
    ),
  );
  return { text, isError: !ok, decision: ok ? "allowed" : "error", project: p.project.name, env: p.env.name };
}

async function writeAtomic(dir: string, target: string, text: string): Promise<void> {
  const tmp = join(dir, `.${target.slice(dir.length + 1)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, text, { flag: "wx", mode: 0o644 });
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/**
 * T2: escribe `.github/workflows/deploy-<env>.yml` (solo esa ruta, de forma atómica). Para producción el MCP
 * nunca escribe: devuelve el comando. Tampoco hace git: el archivo debe revisarse y versionarse a mano.
 */
export async function opsCiGenerate(ctx: Ctx, args: OpsCiArgs, opts: OpsCiGenerateOptions = {}): Promise<ToolOutcome> {
  let p: Plan;
  try {
    p = await plan(ctx, args, false);
  } catch (e) {
    return reject(e, args);
  }
  const c = compare(p);
  const command = renderCommand(regenerateArgv(p));
  const base = { project: p.project.name, env: p.env.name, path: p.rel, options: optionsOut(p), previous: c.status, differing_lines: c.differing_lines, diff: c.diff, diff_truncated: c.diff_truncated };
  const out = (o: Record<string, unknown>, decision: ToolOutcome["decision"], isError = false): ToolOutcome => ({
    text: ctx.redactor.redact(JSON.stringify({ ...base, ...o }, null, 2)),
    isError,
    decision,
    project: p.project.name,
    env: p.env.name,
  });

  if (p.production && opts.allowProduction !== true) {
    return out(
      {
        decision: "command-only",
        written: false,
        command,
        message: `NO se escribió nada: "${p.env.name}" es producción y un cambio en este workflow puede iniciar despliegues de producción con cada push. Ejecuta tú este comando, revisa el diff y versiona el cambio: ${command}`,
      },
      "command-only",
    );
  }
  if (c.status === "up_to_date") {
    return out({ decision: "allowed", written: false, message: `${p.rel} ya está al día: no se escribió nada.` }, "allowed");
  }
  try {
    // Con `forWrite` se crean .github/workflows si faltan (y se revalidan los enlaces simbólicos).
    const w = await plan(ctx, args, true);
    await writeAtomic(w.outputDir, w.outputPath, w.rendered);
  } catch (e) {
    return reject(e, args);
  }
  return out(
    {
      decision: "allowed",
      written: true,
      message: `Se escribió ${p.rel}. Es un cambio local: revisa el diff, haz commit y push tú mismo (esta herramienta no usa git ni GitHub, y no comprueba que la rama exista).`,
    },
    "allowed",
  );
}
