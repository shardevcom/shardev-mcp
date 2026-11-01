import { lstat, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { digestOf, parseEnvFile, parseSchema, type ParsedEnvFile } from "../core/env-file.js";
import { ShardevError } from "../core/errors.js";
import { requireEnvironment, resolveProject, type Environment, type ResolvedProject } from "../core/manifest.js";
import { classifyEnvironment, loadPolicy, resolveMode } from "../core/policy.js";
import type { Ctx, ToolOutcome } from "./context.js";

export interface OpsEnvCheckArgs {
  project?: unknown;
  env?: unknown;
}

export type CheckStatus = "ok" | "warn" | "fail" | "skip";
export interface Check {
  name: string;
  status: CheckStatus;
  message: string;
}

/** Archivos de variables por entorno (convención documentada en docs/decisions/0008-env-check.md). */
const KINDS = ["aws", "environment", "secrets"] as const;
type Kind = (typeof KINDS)[number];
const MAX_FILE_BYTES = 1024 * 1024;

/** Nombres que deben ser distintos de los de producción en un entorno que no lo es. */
const ISOLATION_NAMES = ["DB_DATABASE", "DB_USERNAME", "REDIS_HOST", "AWS_PROJECT_NAME", "AWS_DOMAIN_NAME"] as const;

export type SafeRead = { state: "ok"; text: string } | { state: "missing" } | { state: "bad"; reason: string };

/** Lee un archivo solo si es regular (no enlace simbólico) y su ruta real queda dentro de `realRoot`. */
export async function safeReadFile(path: string, realRoot: string): Promise<SafeRead> {
  let st;
  try {
    st = await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
    return { state: "bad", reason: "no se pudo inspeccionar" };
  }
  if (st.isSymbolicLink()) return { state: "bad", reason: "es un enlace simbólico (no se admite)" };
  if (!st.isFile()) return { state: "bad", reason: "no es un archivo regular" };
  if (st.size > MAX_FILE_BYTES) return { state: "bad", reason: "supera 1 MiB" };
  try {
    const real = await realpath(path);
    if (!real.startsWith(realRoot + sep)) return { state: "bad", reason: "queda fuera de la raíz del proyecto" };
    return { state: "ok", text: await readFile(real, "utf8") };
  } catch {
    return { state: "bad", reason: "no se pudo leer" };
  }
}

type DirState = { state: "ok"; dir: string } | { state: "missing" } | { state: "bad"; reason: string };

async function safeEnvDir(root: string, realRoot: string, env: string): Promise<DirState> {
  const dir = join(root, ".aws", "env", env);
  try {
    const st = await lstat(dir);
    if (st.isSymbolicLink()) return { state: "bad", reason: "es un enlace simbólico (no se admite)" };
    if (!st.isDirectory()) return { state: "bad", reason: "no es un directorio" };
    const real = await realpath(dir);
    if (!real.startsWith(realRoot + sep)) return { state: "bad", reason: "queda fuera de la raíz del proyecto" };
    return { state: "ok", dir };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
    return { state: "bad", reason: "no se pudo inspeccionar" };
  }
}

const list = (names: readonly string[]): string => names.join(", ");

interface Loaded {
  files: Partial<Record<Kind, ParsedEnvFile>>;
  /** Algún archivo está ausente o no es seguro: los checks que dependen de los datos se omiten. */
  incomplete: boolean;
}

/** Variables de un entorno: una por archivo. Cada nombre se busca en los tres archivos. */
function findVar(files: Partial<Record<Kind, ParsedEnvFile>>, name: string): Array<{ kind: Kind; nonEmpty: boolean; digest: string }> {
  const out: Array<{ kind: Kind; nonEmpty: boolean; digest: string }> = [];
  for (const kind of KINDS) {
    const v = files[kind]?.vars.get(name);
    if (v) out.push({ kind, ...v });
  }
  return out;
}

async function run(ctx: Ctx, project: ResolvedProject, env: Environment): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, status: CheckStatus, message: string): void => void checks.push({ name, status, message });

  // 1. Manifest y política (sin identidad AWS).
  const cls = classifyEnvironment(env, project.productionEnvs);
  add("clasificacion", cls.conflict ? "warn" : "ok", cls.conflict ?? `El entorno "${env.name}" existe en ops.yaml y se trata como ${cls.production ? "producción" : "no producción"}.`);

  const missing: string[] = [];
  if (!env.services || env.services.length === 0) missing.push(`\`services\` del entorno "${env.name}"`);
  if (project.manifest.capabilities.length === 0) missing.push("`capabilities`");
  add("manifiesto", missing.length ? "fail" : "ok", missing.length ? `ops.yaml no declara: ${list(missing)}.` : "ops.yaml declara `services` y `capabilities`.");

  try {
    const { policy } = await loadPolicy(ctx.paths);
    const rule = Object.hasOwn(policy.aws_profiles, env.aws_profile) ? policy.aws_profiles[env.aws_profile] : undefined;
    if (cls.production && !rule) {
      add("politica", "fail", `El entorno es producción y el perfil "${env.aws_profile}" no tiene regla en aws_profiles de policy.yaml: las operaciones quedarían disabled.`);
    } else if (resolveMode(policy, project.manifest, env, project.productionEnvs).mode === "disabled") {
      add("politica", "warn", `La política efectiva para "${env.name}" es disabled.`);
    } else {
      add("politica", "ok", cls.production ? `policy.yaml tiene regla para el perfil "${env.aws_profile}".` : "La política efectiva no bloquea el entorno.");
    }
  } catch (e) {
    add("politica", "fail", e instanceof ShardevError ? e.message : "No se pudo leer policy.yaml.");
  }

  // 2. Disposición de archivos.
  let realRoot: string;
  try {
    realRoot = await realpath(project.root);
  } catch {
    add("archivos", "fail", "La raíz del proyecto no existe o no es accesible.");
    return skipRest(checks);
  }
  const dir = await safeEnvDir(project.root, realRoot, env.name);
  if (dir.state !== "ok") {
    add("archivos", "fail", dir.state === "missing" ? `Falta el directorio .aws/env/${env.name}/ en la raíz del proyecto.` : `.aws/env/${env.name}/ ${dir.reason}.`);
    return skipRest(checks);
  }
  const loaded: Loaded = { files: {}, incomplete: false };
  const problems: string[] = [];
  for (const kind of KINDS) {
    const r = await safeReadFile(join(dir.dir, `${kind}.env`), realRoot);
    if (r.state === "ok") loaded.files[kind] = parseEnvFile(r.text);
    else {
      loaded.incomplete = true;
      problems.push(`${kind}.env ${r.state === "missing" ? "no existe" : r.reason}`);
    }
  }
  add("archivos", problems.length ? "fail" : "ok", problems.length ? `.aws/env/${env.name}/: ${problems.join("; ")}.` : `Existen aws.env, environment.env y secrets.env en .aws/env/${env.name}/.`);

  // Permisos y git de secrets.env.
  const secretsPath = join(dir.dir, "secrets.env");
  if (loaded.files.secrets) {
    try {
      const mode = (await lstat(secretsPath)).mode & 0o777;
      add("permisos", (mode & 0o077) !== 0 ? "warn" : "ok", (mode & 0o077) !== 0 ? `secrets.env es accesible por grupo u otros (modo ${mode.toString(8)}); usa chmod 600.` : "secrets.env solo es accesible por su propietario.");
    } catch {
      add("permisos", "skip", "No se pudieron leer los permisos de secrets.env.");
    }
    add(...(await gitCheck(ctx, realRoot, `.aws/env/${env.name}/secrets.env`)));
  } else {
    add("permisos", "skip", "secrets.env no está disponible.");
    add("git", "skip", "secrets.env no está disponible.");
  }

  // 3. Sintaxis (solo nombres).
  const syntax: string[] = [];
  for (const kind of KINDS) {
    const f = loaded.files[kind];
    if (!f) continue;
    if (f.duplicates.length) syntax.push(`${kind}.env: nombres duplicados: ${list(f.duplicates)}`);
    if (f.invalidNameLines.length) syntax.push(`${kind}.env: nombre inválido (debe cumplir ^[A-Z_][A-Z0-9_]*$) en las líneas ${list(f.invalidNameLines.map(String))}`);
    if (f.malformedLines.length) syntax.push(`${kind}.env: líneas sin "=" en ${list(f.malformedLines.map(String))}`);
    if (f.unterminatedLine !== null) syntax.push(`${kind}.env: comilla sin cerrar desde la línea ${f.unterminatedLine}`);
  }
  const total = KINDS.reduce((n, k) => n + (loaded.files[k]?.vars.size ?? 0), 0);
  add("sintaxis", syntax.length ? "fail" : "ok", syntax.length ? `${syntax.join("; ")}.` : `${total} variable(s) con nombre válido y sin duplicados.`);

  // 4. Esquema de variables.
  await schemaCheck(project.root, realRoot, loaded, add);

  // 5. Aislamiento respecto a producción.
  await isolationCheck(project, env, realRoot, loaded, cls.production, add);

  // 6. Consistencia con el manifest.
  if (loaded.incomplete && KINDS.every((k) => !loaded.files[k])) {
    add("consistencia", "skip", "No hay archivos de variables que comparar.");
  } else {
    const expected: Array<[string, string]> = [
      ["AWS_PROFILE", env.aws_profile],
      ["AWS_ACCOUNT_ID", env.account_id],
      ["AWS_ECS_CLUSTER_NAME", env.cluster],
      ["AWS_DEFAULT_REGION", env.region],
      ["AWS_REGION", env.region],
    ];
    const bad: string[] = [];
    const matched: string[] = [];
    for (const [name, value] of expected) {
      const found = findVar(loaded.files, name).filter((v) => v.nonEmpty);
      if (found.length === 0) continue;
      if (found.some((v) => v.digest !== digestOf(value))) bad.push(name);
      else matched.push(name);
    }
    if (bad.length) add("consistencia", "fail", `Difieren de ops.yaml: ${list(bad)}.`);
    else if (matched.length) add("consistencia", "ok", `Coinciden con ops.yaml: ${list(matched)}.`);
    else add("consistencia", "skip", "Ninguna de AWS_PROFILE, AWS_ACCOUNT_ID, AWS_ECS_CLUSTER_NAME, AWS_DEFAULT_REGION o AWS_REGION está definida.");
  }
  return checks;
}

const REST = ["permisos", "git", "sintaxis", "esquema", "aislamiento", "consistencia"];
function skipRest(checks: Check[]): Check[] {
  for (const name of REST) checks.push({ name, status: "skip", message: "Omitido: faltan los archivos del entorno." });
  return checks;
}

async function gitCheck(ctx: Ctx, realRoot: string, relPath: string): Promise<[string, CheckStatus, string]> {
  const inside = await ctx.runner("git", ["-C", realRoot, "rev-parse", "--is-inside-work-tree"], { timeoutMs: 10_000 });
  if (inside.spawnError !== undefined || inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return ["git", "warn", "La raíz no es un repositorio git (o git no está disponible): no se pudo comprobar si secrets.env está versionado."];
  }
  const tracked = await ctx.runner("git", ["-C", realRoot, "ls-files", "--error-unmatch", "--", relPath], { timeoutMs: 10_000 });
  if (tracked.exitCode === 0) return ["git", "fail", `${relPath} está versionado en git: sácalo del índice (git rm --cached) y añádelo a .gitignore.`];
  return ["git", "ok", "secrets.env no está versionado en git."];
}

async function schemaCheck(root: string, realRoot: string, loaded: Loaded, add: (n: string, s: CheckStatus, m: string) => void): Promise<void> {
  const r = await safeReadFile(join(root, "env.schema"), realRoot);
  if (r.state === "missing") return add("esquema", "warn", "No existe env.schema en la raíz del proyecto: no se validó la clasificación de variables.");
  if (r.state === "bad") return add("esquema", "fail", `env.schema ${r.reason}.`);
  const schema = parseSchema(r.text);
  if (schema.errors.length) return add("esquema", "fail", `env.schema inválido: ${schema.errors.join("; ")}.`);

  const fails: string[] = [];
  const warns: string[] = [];
  for (const { category, name, required } of schema.entries) {
    const found = findVar(loaded.files, name);
    if (found.length === 0) {
      if (required && category !== "exclude") fails.push(`${name} es obligatoria y no está definida`);
      continue;
    }
    if (category === "secret") {
      const wrong = found.filter((f) => f.kind !== "secrets").map((f) => `${f.kind}.env`);
      if (wrong.length) fails.push(`${name} es secret y está en ${list(wrong)} (debe estar en secrets.env)`);
    } else if (category === "public") {
      if (found.some((f) => f.kind === "secrets")) warns.push(`${name} es public y está en secrets.env (debe estar en environment.env o aws.env)`);
    }
    if (category !== "exclude" && !found.some((f) => f.nonEmpty)) {
      if (required) fails.push(`${name} es obligatoria y está vacía`);
      else warns.push(`${name} está vacía`);
    }
  }
  for (const f of findVarsByPrefix(loaded, "VITE_")) fails.push(`${f} (VITE_) está en secrets.env: iría al JS del frontend`);
  const message = [...fails, ...warns].join("; ");
  if (fails.length) add("esquema", "fail", `${message}.`);
  else if (warns.length) add("esquema", "warn", `${message}.`);
  else add("esquema", "ok", `${schema.entries.length} variable(s) de env.schema en el archivo que su clasificación exige.`);
}

function findVarsByPrefix(loaded: Loaded, prefix: string): string[] {
  return [...(loaded.files.secrets?.vars.keys() ?? [])].filter((n) => n.startsWith(prefix));
}

async function isolationCheck(
  project: ResolvedProject,
  env: Environment,
  realRoot: string,
  loaded: Loaded,
  production: boolean,
  add: (n: string, s: CheckStatus, m: string) => void,
): Promise<void> {
  if (production) return add("aislamiento", "skip", "Es producción: no aplica la comprobación de aislamiento.");
  // Referencias: entornos de producción del manifest y, si existe, el directorio literal `production`.
  const refs = new Set<string>(["production"]);
  for (const e of project.manifest.environments) if (classifyEnvironment(e, project.productionEnvs).production) refs.add(e.name);
  refs.delete(env.name);

  const prod: Partial<Record<Kind, ParsedEnvFile>> = {};
  let refName: string | null = null;
  const unreadable: string[] = [];
  for (const ref of refs) {
    const d = await safeEnvDir(project.root, realRoot, ref);
    if (d.state === "missing") continue;
    if (d.state === "bad") {
      unreadable.push(`.aws/env/${ref}/ ${d.reason}`);
      continue;
    }
    refName = ref;
    for (const kind of KINDS) {
      const r = await safeReadFile(join(d.dir, `${kind}.env`), realRoot);
      if (r.state === "ok") prod[kind] = parseEnvFile(r.text);
      else if (r.state === "bad") unreadable.push(`${ref}/${kind}.env ${r.reason}`);
    }
    break;
  }
  if (refName === null) {
    return add("aislamiento", unreadable.length ? "warn" : "skip", unreadable.length ? `No se pudo comparar con producción: ${unreadable.join("; ")}.` : "No hay configuración de producción en .aws/env/: no se puede comprobar el aislamiento.");
  }
  const same: string[] = [];
  const unknown: string[] = [];
  for (const name of ISOLATION_NAMES) {
    const mine = findVar(loaded.files, name).find((v) => v.nonEmpty);
    const theirs = findVar(prod, name).find((v) => v.nonEmpty);
    if (!mine || !theirs) unknown.push(name);
    else if (mine.digest === theirs.digest) same.push(name);
  }
  const parts = [
    ...same.map((n) => `${n}: igual a producción`),
    ...(unknown.length ? [`sin valor en este entorno o en producción (no comparables): ${list(unknown)}`] : []),
    ...unreadable,
  ];
  if (same.length) add("aislamiento", "fail", `${parts.join("; ")}.`);
  else if (parts.length) add("aislamiento", "warn", `${parts.join("; ")}.`);
  else add("aislamiento", "ok", `${ISOLATION_NAMES.length} variable(s) distintas de las de producción.`);
}

/** T0, sin AWS: valida los archivos de variables locales de un entorno. Nunca devuelve ni registra valores. */
export async function opsEnvCheck(ctx: Ctx, args: OpsEnvCheckArgs): Promise<ToolOutcome> {
  const projectName = typeof args.project === "string" ? args.project : undefined;
  const envName = typeof args.env === "string" ? args.env : undefined;
  const reject = (text: string): ToolOutcome => ({ text, isError: true, decision: "rejected", ...(projectName ? { project: projectName } : {}), ...(envName ? { env: envName } : {}) });

  let project: ResolvedProject;
  let env: Environment;
  try {
    if (projectName === undefined || projectName === "") throw new ShardevError("invalid_input", "Debes indicar `project` (nombre de un proyecto registrado).");
    project = await resolveProject(ctx.paths, projectName);
    env = requireEnvironment(project.manifest, envName);
  } catch (e) {
    if (e instanceof ShardevError) return reject(e.message);
    throw e;
  }

  const checks = await run(ctx, project, env);
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 };
  for (const c of checks) counts[c.status]++;
  const ok = counts.fail === 0;
  return {
    text: JSON.stringify({ project: project.name, env: env.name, ok, checks, counts }, null, 2),
    isError: !ok,
    decision: ok ? "allowed" : "error",
    project: project.name,
    env: env.name,
  };
}
