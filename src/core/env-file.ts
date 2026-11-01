import { createHash } from "node:crypto";

/** Nombre válido de variable de entorno (convención: mayúsculas). */
export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export interface EnvVar {
  /** Único dato del valor que se conserva: si no está vacío. */
  nonEmpty: boolean;
  /** SHA-256 del valor, solo para comparar en memoria (igualdad con otro archivo o con el manifest). Nunca se imprime. */
  digest: string;
}

export interface ParsedEnvFile {
  vars: Map<string, EnvVar>;
  /** Nombres (válidos) definidos más de una vez. */
  duplicates: string[];
  /** Líneas con nombre inválido (solo el número: el texto de la línea no se reproduce). */
  invalidNameLines: number[];
  /** Líneas sin `=` (solo el número de línea). */
  malformedLines: number[];
  /** Línea donde empieza una comilla sin cerrar, si la hay. */
  unterminatedLine: number | null;
}

export const digestOf = (value: string): string => createHash("sha256").update(value).digest("hex");

/**
 * Lee el valor a partir de `rest` (lo que sigue al `=`). Soporta comillas simples y dobles, también
 * en varias líneas (p. ej. una clave PEM). Devuelve el valor y cuántas líneas extra consumió, o `null`
 * si la comilla no se cierra. El valor existe solo dentro de esta función y de su llamador inmediato.
 */
function readValue(rest: string, lines: string[], index: number): { value: string; consumed: number } | null {
  const trimmed = rest.trimStart();
  const q = trimmed[0];
  if (q !== '"' && q !== "'") {
    // Sin comillas: un ` #` inicia un comentario en línea.
    const hash = trimmed.search(/\s#/);
    return { value: (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim(), consumed: 0 };
  }
  let buf = trimmed.slice(1);
  let consumed = 0;
  for (;;) {
    for (let i = 0; i < buf.length; i++) {
      if (q === '"' && buf[i] === "\\") {
        i++;
        continue;
      }
      if (buf[i] === q) return { value: buf.slice(0, i), consumed };
    }
    const next = lines[index + consumed + 1];
    if (next === undefined) return null;
    consumed++;
    buf += `\n${next.replace(/\r$/, "")}`;
  }
}

/**
 * Parser mínimo de `KEY=valor` (comentarios `#`, prefijo `export`, comillas). Está pensado para
 * validar NOMBRES: de cada valor solo se conservan un booleano y un digest para comparar en memoria.
 */
export function parseEnvFile(text: string): ParsedEnvFile {
  const out: ParsedEnvFile = { vars: new Map(), duplicates: [], invalidNameLines: [], malformedLines: [], unterminatedLine: null };
  const lines = text.replace(/^﻿/, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const body = line.replace(/^export\s+/, "");
    const eq = body.indexOf("=");
    if (eq === -1) {
      out.malformedLines.push(i + 1);
      continue;
    }
    const name = body.slice(0, eq).trim();
    const parsed = readValue(body.slice(eq + 1), lines, i);
    if (parsed === null) {
      out.unterminatedLine = i + 1;
      break;
    }
    i += parsed.consumed;
    if (!ENV_NAME_RE.test(name)) {
      out.invalidNameLines.push(i + 1 - parsed.consumed);
      continue;
    }
    if (out.vars.has(name)) {
      if (!out.duplicates.includes(name)) out.duplicates.push(name);
    }
    out.vars.set(name, { nonEmpty: parsed.value.trim() !== "", digest: digestOf(parsed.value.trim()) });
  }
  return out;
}

export type SchemaCategory = "secret" | "public" | "exclude";

export interface SchemaEntry {
  category: SchemaCategory;
  name: string;
  required: boolean;
}

export interface ParsedSchema {
  entries: SchemaEntry[];
  /** Mensajes de líneas inválidas (sin valores: el schema solo tiene nombres). */
  errors: string[];
}

/**
 * Formato de `env.schema`: una variable por línea, `<categoría> <NOMBRE> [required]`, con categoría
 * `secret` (va a secrets.env), `public` (a environment.env o aws.env) o `exclude` (nunca llega al
 * contenedor). `#` comenta. `required` es opcional y marca la variable como obligatoria.
 */
export function parseSchema(text: string): ParsedSchema {
  const entries: SchemaEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "").replace(/(^|\s)#.*$/, "").trim();
    if (line === "") return;
    const [category, name, extra, ...more] = line.split(/\s+/);
    const where = `línea ${i + 1}`;
    if (category !== "secret" && category !== "public" && category !== "exclude") {
      errors.push(`${where}: categoría desconocida (use secret, public o exclude)`);
      return;
    }
    if (name === undefined || !ENV_NAME_RE.test(name)) {
      errors.push(`${where}: nombre de variable ausente o inválido`);
      return;
    }
    if (more.length > 0 || (extra !== undefined && extra !== "required")) {
      errors.push(`${where}: sobra texto tras el nombre (solo se admite \`required\`)`);
      return;
    }
    if (category === "secret" && name.startsWith("VITE_")) {
      errors.push(`${where}: ${name} es VITE_ (va al JS del frontend) y no puede ser secret`);
      return;
    }
    if (seen.has(name)) {
      errors.push(`${where}: ${name} está declarada más de una vez`);
      return;
    }
    seen.add(name);
    entries.push({ category, name, required: extra === "required" });
  });
  return { entries, errors };
}
