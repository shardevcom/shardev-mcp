import { isDeepStrictEqual } from "node:util";
import { isSeq, parseDocument } from "yaml";
import { ShardevError } from "../core/errors.js";

/** Un edit de cableado falló (ancla ausente/ambigua, conflicto de valores...). Nunca se adivina. */
export class WiringError extends ShardevError {
  constructor(message: string) {
    super("wiring_failed", message);
    this.name = "WiringError";
  }
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function mergeInto(target: Record<string, unknown>, src: Record<string, unknown>, path: string, file: string): void {
  for (const [k, v] of Object.entries(src)) {
    if (FORBIDDEN_KEYS.has(k)) throw new WiringError(`${file}: clave prohibida "${k}" en ${path || "(raíz)"}`);
    const here = path ? `${path}.${k}` : k;
    if (!Object.hasOwn(target, k)) {
      target[k] = v;
      continue;
    }
    const cur = target[k];
    if (isPlainObject(cur) && isPlainObject(v)) mergeInto(cur, v, here, file);
    else if (Array.isArray(cur) && Array.isArray(v)) {
      for (const item of v) if (!cur.some((x) => isDeepStrictEqual(x, item))) cur.push(item);
    } else if (!isDeepStrictEqual(cur, v)) {
      throw new WiringError(`${file}: conflicto en "${here}": ya existe un valor distinto (${JSON.stringify(cur)?.slice(0, 60)}) y el edit pide ${JSON.stringify(v)?.slice(0, 60)}`);
    }
  }
}

/** Merge profundo en JSON: objetos se fusionan, arrays se unen sin duplicar, escalares distintos = error. */
export function applyJsonMerge(text: string, value: Record<string, unknown>, file: string): string {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new WiringError(`${file}: no es JSON válido (los comentarios no se admiten): ${(e as Error).message.slice(0, 80)}`);
  }
  if (!isPlainObject(doc)) throw new WiringError(`${file}: la raíz del JSON no es un objeto`);
  const before = structuredClone(doc);
  mergeInto(doc, value, "", file);
  if (isDeepStrictEqual(before, doc)) return text; // ya aplicado: no-op
  const indentMatch = /^([ \t]+)\S/m.exec(text);
  const indent = indentMatch ? (indentMatch[1]!.startsWith("\t") ? "\t" : indentMatch[1]!.length) : 2;
  return JSON.stringify(doc, null, indent) + (text.endsWith("\n") || text === "" ? "\n" : "");
}

/** Añade un elemento a una lista YAML existente (conserva comentarios). Si ya está, no-op. */
export function applyYamlAppend(text: string, path: string[], value: unknown, file: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new WiringError(`${file}: YAML inválido: ${doc.errors[0]!.message.split("\n")[0]}`);
  if (path.length === 0) throw new WiringError(`${file}: path vacío`);
  if (path.some((p) => FORBIDDEN_KEYS.has(p))) throw new WiringError(`${file}: path prohibido`);
  const node = doc.getIn(path, true);
  if (!isSeq(node)) {
    throw new WiringError(`${file}: "${path.join(".")}" ${node === undefined ? "no existe" : "no es una lista"}; no se crea automáticamente`);
  }
  const existing = node.toJSON() as unknown[];
  if (existing.some((x) => isDeepStrictEqual(x, value))) return text;
  node.add(doc.createNode(value));
  return doc.toString({ lineWidth: 0 });
}

export interface InsertEdit {
  anchor: string;
  position: "before" | "after";
  content: string;
  /** Prefija a cada línea no vacía la indentación de la línea ancla (por defecto sí). */
  indent?: boolean;
}

/**
 * Inserta texto junto a una línea ancla (la que CONTIENE el texto del ancla). Ancla ausente o
 * ambigua = error. Si el bloque ya está presente (líneas contiguas, en cualquier lugar), no-op.
 */
export function applyInsert(text: string, edit: InsertEdit, file: string): string {
  if (edit.anchor.trim() === "") throw new WiringError(`${file}: ancla vacía`);
  const lines = text.split("\n");
  const hits = lines.flatMap((l, i) => (l.includes(edit.anchor) ? [i] : []));
  if (hits.length === 0) throw new WiringError(`${file}: ancla no encontrada: "${edit.anchor.slice(0, 80)}"`);
  if (hits.length > 1) throw new WiringError(`${file}: ancla ambigua (${hits.length} coincidencias, líneas ${hits.map((i) => i + 1).join(", ")}): "${edit.anchor.slice(0, 80)}"`);
  const at = hits[0]!;
  const prefix = edit.indent === false ? "" : (/^[ \t]*/.exec(lines[at]!)?.[0] ?? "");
  const block = edit.content.replace(/\n$/, "").split("\n").map((l) => (l === "" ? l : prefix + l));
  for (let i = 0; i + block.length <= lines.length; i++) {
    if (block.every((l, j) => lines[i + j] === l)) return text;
  }
  lines.splice(edit.position === "before" ? at : at + 1, 0, ...block);
  return lines.join("\n");
}
