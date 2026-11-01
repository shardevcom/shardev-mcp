import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../core/config.js";
import { renderCommand } from "../core/policy.js";
import { looksLikeSecretName, redactHighConfidence } from "../core/redact.js";
import type { Ctx } from "../ops/context.js";
import { assertNoSymlinks, resolveInside } from "./safe-path.js";

export interface StepDef {
  name: string;
  argv: string[];
  timeout_s: number;
  env: Record<string, string>;
}
export interface SecretHit {
  path: string;
  line: number;
}
export interface ForbiddenTerm {
  /** Nombre del patrón (lo único que se reporta, nunca el contenido). */
  name: string;
  re: RegExp;
}

/**
 * Restos de otros proyectos que no deben llegar a un proyecto generado: ids de cuentas AWS (ARN o ECR) y los
 * términos que el dueño declare en `leftover_terms` de su config.yaml (nombres de proyectos o dominios de origen).
 */
const FORBIDDEN: Array<{ name: string; re: RegExp }> = [
  { name: "aws-arn-account", re: /arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:\d{12}:/ },
  { name: "aws-ecr-account", re: /\b\d{12}\.dkr\.ecr\./ },
];

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Términos prohibidos para este spec: los patrones genéricos más los `terms` configurados (coincidencia literal,
 * sin distinguir mayúsculas). Un término que forma parte del nombre/dominio elegido por el dueño no cuenta.
 * Puro y determinista: el mismo spec y los mismos términos dan siempre la misma lista.
 */
export function forbiddenFor(spec: { name: string; domain: string }, terms: readonly string[] = []): ForbiddenTerm[] {
  const own = `${spec.name} ${spec.domain}`.toLowerCase();
  const extra = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))]
    .sort()
    .filter((t) => !own.includes(t))
    .map((t) => ({ name: `leftover_terms:${t}`, re: new RegExp(escapeRegExp(t), "i") }));
  return [...FORBIDDEN, ...extra];
}

/** `leftover_terms` del config.yaml del dueño ([] si no hay config o no declara ninguno). */
export async function loadLeftoverTerms(ctx: Pick<Ctx, "paths">): Promise<string[]> {
  return (await loadConfig(ctx.paths)).leftover_terms;
}

export interface VerifyResult {
  ok: boolean;
  summary: string;
  steps: Array<{ name: string; command: string; ok: boolean; exit_code: number | null; timed_out: boolean; duration_ms: number; log_ref?: string }>;
  secrets: { scanned: number; hits: SecretHit[] };
  /** Restos de otros proyectos (términos configurados, cuentas AWS): solo ruta, línea y nombre del patrón. */
  leftovers: { hits: Array<SecretHit & { term: string }> };
}

const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/** Código fuente: aquí `password: z.string()` o `$token = $x->token()` NO son secretos. */
const CODE_FILE = /\.(php|tsx?|jsx?|css|html|htaccess)$|^public\/\.htaccess$/i;
/** `nombre_secreto => 'literal'`, `nombre = "literal"`, `nombre: 'literal'` con un literal plausible (8+ caracteres sin espacios ni código). */
const LITERAL_ASSIGN = /([A-Za-z0-9_.-]+)['"]?\s*(?:=>|=|:)\s*(['"])([^'"\s$(){}[\]<>]{8,})\2/g;
/** Solo nombres de credencial inequívocos; `CACHE_KEY = 'google_jwks'` o `$token = ...` no lo son. */
const CREDENTIAL_NAME = /(secret|passw(or)?d|passphrase|api[_-]?key|private[_-]?key|access[_-]?key|signing[_-]?key|encryption[_-]?key)/i;
/** Identificadores (`google_jwks`) y URLs no son credenciales. */
const NOT_A_CREDENTIAL = /^[a-z]+(_[a-z]+)*$|^[a-z]+:\/\//;

/** Referencias a variables (`${VAR}`, `$VAR`) no son secretos: se quitan antes de buscar. */
const stripRefs = (line: string): string => line.replace(/\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g, "");

/** ¿La línea contiene un posible secreto? Más estricta con texto/config que con código fuente. */
export function lineHasSecret(ctx: Pick<Ctx, "redactor">, rel: string, line: string): boolean {
  if (!CODE_FILE.test(rel)) {
    const clean = stripRefs(line);
    return ctx.redactor.redact(clean) !== clean;
  }
  if (redactHighConfidence(line) !== line) return true;
  for (const m of line.matchAll(LITERAL_ASSIGN)) if (CREDENTIAL_NAME.test(m[1]!) && looksLikeSecretName(m[1]!) && !NOT_A_CREDENTIAL.test(m[3]!)) return true;
  return false;
}
export const ALLOW_MARKER = "shardev-allow-secret";

/**
 * Escanea un texto en memoria (mismas reglas que scanForSecrets, sin tocar el disco). Sirve para
 * revisar lo que se va a escribir ANTES de escribirlo. Solo reporta ruta y línea.
 */
export function scanText(ctx: Pick<Ctx, "redactor">, rel: string, text: string, forbidden: ForbiddenTerm[] = []): { hits: SecretHit[]; leftovers: Array<SecretHit & { term: string }> } {
  const hits: SecretHit[] = [];
  const leftovers: Array<SecretHit & { term: string }> = [];
  // El bloque de clave privada es multilínea: se detecta sobre el texto completo.
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text)) {
    hits.push({ path: rel, line: text.slice(0, text.search(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/)).split("\n").length });
    return { hits, leftovers };
  }
  text.split("\n").forEach((line, i) => {
    for (const f of forbidden) if (f.re.test(line) || f.re.test(rel)) leftovers.push({ path: rel, line: i + 1, term: f.name });
    if (line.includes(ALLOW_MARKER)) return;
    if (lineHasSecret(ctx, rel, line)) hits.push({ path: rel, line: i + 1 });
  });
  return { hits, leftovers };
}

/**
 * Escanea archivos con los patrones del Redactor: una línea que el Redactor modificaría es un hit.
 * Solo se reporta ruta y línea (nunca el contenido). Línea con `shardev-allow-secret` se omite.
 */
export async function scanForSecrets(
  ctx: Pick<Ctx, "redactor">,
  root: string,
  files: string[],
  forbidden: ForbiddenTerm[] = [],
): Promise<{ scanned: number; hits: SecretHit[]; leftovers: Array<SecretHit & { term: string }> }> {
  const hits: SecretHit[] = [];
  const leftovers: Array<SecretHit & { term: string }> = [];
  let scanned = 0;
  for (const rel of files) {
    const full = resolveInside(root, rel);
    await assertNoSymlinks(root, rel);
    const st = await lstat(full).catch(() => null);
    if (!st || !st.isFile() || st.size > MAX_SCAN_BYTES) continue;
    const buf = await readFile(full);
    if (buf.includes(0)) continue; // binario
    scanned++;
    const r = scanText(ctx, rel, buf.toString("utf8"), forbidden);
    hits.push(...r.hits);
    leftovers.push(...r.leftovers);
  }
  return { scanned, hits, leftovers };
}

/** Pasos declarados por `exec` (array, stdin cerrado, env explícito, timeout) + escaneo de secretos. */
export async function verifyTree(ctx: Ctx, root: string, steps: StepDef[], scanFiles: string[], forbidden: ForbiddenTerm[] = []): Promise<VerifyResult> {
  const out: VerifyResult["steps"] = [];
  const cwd = resolve(root);
  for (const s of steps) {
    const [cmd, ...args] = s.argv;
    const command = renderCommand(s.argv);
    if (!cmd) continue;
    const r = await ctx.runner(cmd, args, { cwd, timeoutMs: s.timeout_s * 1000, env: s.env });
    const body = `$ ${command}\n[exit ${r.exitCode ?? "null"}${r.timedOut ? " TIMEOUT" : ""}${r.spawnError ? ` spawn: ${r.spawnError}` : ""}]\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`;
    const log = await ctx.logs.write(`verify-${s.name}`, body);
    out.push({ name: s.name, command, ok: r.exitCode === 0 && !r.timedOut && !r.spawnError, exit_code: r.exitCode, timed_out: r.timedOut, duration_ms: r.durationMs, log_ref: log.ref });
    if (r.exitCode !== 0) break; // el primer fallo corta: los siguientes pasos suelen depender de él
  }
  const scan = await scanForSecrets(ctx, root, scanFiles, forbidden);
  const secrets = { scanned: scan.scanned, hits: scan.hits };
  const leftovers = { hits: scan.leftovers };
  const failedStep = out.find((s) => !s.ok);
  const ok = !failedStep && secrets.hits.length === 0 && leftovers.hits.length === 0 && out.length === steps.length;
  const parts = [
    `${out.filter((s) => s.ok).length}/${steps.length} pasos OK`,
    failedStep ? `falló "${failedStep.name}" (log_ref ${failedStep.log_ref})` : null,
    secrets.hits.length > 0 ? `${secrets.hits.length} posible(s) secreto(s) en archivos generados (${[...new Set(secrets.hits.map((h) => h.path))].slice(0, 5).join(", ")})` : `sin secretos (${secrets.scanned} archivos escaneados)`,
    leftovers.hits.length > 0 ? `${leftovers.hits.length} resto(s) de otro proyecto (${[...new Set(leftovers.hits.map((h) => `${h.term}:${h.path}`))].slice(0, 5).join(", ")})` : "sin restos de otros proyectos",
  ].filter(Boolean);
  return { ok, summary: parts.join("; "), steps: out, secrets, leftovers };
}
