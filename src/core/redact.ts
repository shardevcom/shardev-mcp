export const REDACTED = "[REDACTED]";

const SECRET_WORDS =
  "(?:SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|SESSION[_-]?KEY|SIGNING[_-]?KEY|ENCRYPTION[_-]?KEY|AUTH(?:ORIZATION)?(?![A-Za-z]))";
/** Nombres que "parecen secretos": contienen una palabra sensible o terminan en _KEY. */
const SECRET_NAME = `(?:[A-Za-z0-9_.-]*${SECRET_WORDS}[A-Za-z0-9_.-]*|[A-Za-z0-9_.-]*_KEY)`;
const SECRET_NAME_RE = new RegExp(`^${SECRET_NAME}$`, "i");

/** Valor tras `=`: entre comillas dobles (con escapes), simples, comilla sin cerrar, o sin comillas. */
const VALUE = `("(?:[^"\\\\\\n]|\\\\.)*"|'[^'\\n]*'|"[^\\n]*|'[^\\n]*|[^\\s'"]+)`;

const PATTERNS: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  // Bloques de clave privada (incluso truncados: se enmascara hasta el final del texto).
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]"],
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/AIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  [/GOCSPX-[A-Za-z0-9_-]{10,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, (_m, scheme = "") => `${scheme} ${REDACTED}`],
  // JSON: "nombre_secreto": "valor"
  [
    new RegExp(`("${SECRET_NAME}"\\s*:\\s*)("(?:[^"\\\\\\n]|\\\\.)*")`, "gi"),
    (_m, head = "") => `${head}"${REDACTED}"`,
  ],
  // NAME=valor, export NAME="valor con espacios", NAME = 'valor', --flag=valor
  [
    new RegExp(`(${SECRET_NAME})(\\s*=\\s*)${VALUE}`, "gi"),
    (_m, name = "", sep = "", val = "") => {
      const q = val[0] === '"' || val[0] === "'" ? val[0] : "";
      const closed = q !== "" && val.length > 1 && val.endsWith(q);
      return `${name}${sep}${q}${REDACTED}${closed ? q : ""}`;
    },
  ],
  // YAML / estilo log: `nombre_secreto: valor`, `password: "con espacios"`. Solo espacios/tabs tras ':'
  // (nunca saltos de línea: un valor vacío no debe tragarse la línea siguiente).
  [
    new RegExp(`(^|[^A-Za-z0-9_.-])(${SECRET_NAME})([ \\t]*:[ \\t]*)${VALUE}`, "gim"),
    (_m, pre = "", name = "", sep = "", val = "") => {
      const q = val[0] === '"' || val[0] === "'" ? val[0] : "";
      const closed = q !== "" && val.length > 1 && val.endsWith(q);
      return `${pre}${name}${sep}${q}${REDACTED}${closed ? q : ""}`;
    },
  ],
  // Credenciales en URLs: scheme://usuario:clave@host => se conserva usuario y host.
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@'"]+):([^\s/'"]+)@(?=[^\s@/'"])/gi, (_m, scheme = "", user = "") => `${scheme}${user}:${REDACTED}@`],
  // --password valor / --token "valor" (el valor no puede empezar por '-')
  [
    new RegExp(`(--?[A-Za-z-]*(?:password|token|secret|api-key|access-key)[A-Za-z-]*)(\\s+)(?!-)${VALUE}`, "gi"),
    (_m, flag = "", sp = "") => `${flag}${sp}${REDACTED}`,
  ],
];

/** Patrones de alta confianza (formas de token conocidas, claves privadas, credenciales en URLs): no dependen del nombre. */
const STRONG_PATTERNS = [...PATTERNS.slice(0, 9), PATTERNS[PATTERNS.length - 2]!];

/** Igual que `redact` pero solo con los patrones de alta confianza (para escanear código fuente). */
export function redactHighConfidence(text: string): string {
  let out = text;
  for (const [re, rep] of STRONG_PATTERNS) out = out.replace(re, rep as never);
  return out;
}

/** Nombre que parece secreto (misma definición que usa el redactor). */
export const looksLikeSecretName = (name: string): boolean => SECRET_NAME_RE.test(name);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class Redactor {
  private literals = new Set<string>();
  private literalRe: RegExp | null = null;

  /** Registra valores secretos exactos. Valores de menos de 4 caracteres se ignoran. */
  register(...values: Array<string | undefined | null>): void {
    for (const v of values) {
      if (typeof v === "string" && v.length >= 4) this.literals.add(v);
    }
    this.literalRe = null;
  }

  redact(text: string): string {
    if (!text) return text;
    let out = text;
    if (this.literals.size > 0) {
      this.literalRe ??= new RegExp(
        [...this.literals].sort((a, b) => b.length - a.length).map(escapeRe).join("|"),
        "g",
      );
      out = out.replace(this.literalRe, REDACTED);
    }
    for (const [re, rep] of PATTERNS) {
      out = out.replace(re, rep as never);
    }
    return out;
  }

  /** Redacta recursivamente un valor JSON (argumentos de herramientas, etc.). */
  redactValue<T>(value: T, depth = 0): T {
    if (depth > 8) return REDACTED as unknown as T;
    if (typeof value === "string") return this.redact(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v, depth + 1)) as unknown as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = typeof v === "string" && SECRET_NAME_RE.test(k) ? REDACTED : this.redactValue(v, depth + 1);
      }
      return out as T;
    }
    return value;
  }
}

/** Instancia por defecto sin literales; el servidor crea la suya. */
export const redact = (text: string): string => new Redactor().redact(text);
