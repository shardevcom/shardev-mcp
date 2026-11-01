import { lstat } from "node:fs/promises";
import { isAbsolute, join, posix, resolve, sep } from "node:path";
import { ShardevError } from "../core/errors.js";

/** Ruta relativa segura (posix): sin absolutas, `..`, NUL, backslash ni segmentos vacíos. */
export function safeRel(rel: string, what = "ruta"): string {
  if (typeof rel !== "string" || rel === "" || rel.includes("\0") || rel.includes("\\") || isAbsolute(rel) || rel.startsWith("/")) {
    throw new ShardevError("invalid_template", `${what} inválida: "${String(rel).slice(0, 80)}"`);
  }
  const parts = rel.split("/");
  if (parts.some((p) => p === ".." || p === "" || p === ".")) {
    throw new ShardevError("invalid_template", `${what} inválida (segmentos vacíos o ".."): "${rel.slice(0, 80)}"`);
  }
  const norm = posix.normalize(rel);
  if (norm !== rel) throw new ShardevError("invalid_template", `${what} no normalizada: "${rel.slice(0, 80)}"`);
  return rel;
}

/** root + rel, garantizando que queda dentro de root. */
export function resolveInside(root: string, rel: string): string {
  const full = resolve(root, safeRel(rel));
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + sep)) throw new ShardevError("invalid_template", `La ruta sale del directorio destino: ${rel}`);
  return full;
}

/** Rechaza si algún componente existente de `rel` bajo `root` es un symlink. */
export async function assertNoSymlinks(root: string, rel: string): Promise<void> {
  let cur = resolve(root);
  for (const part of safeRel(rel).split("/")) {
    cur = join(cur, part);
    try {
      if ((await lstat(cur)).isSymbolicLink()) throw new ShardevError("apply_failed", `Se rechaza escribir a través de un symlink: ${rel}`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
  }
}
