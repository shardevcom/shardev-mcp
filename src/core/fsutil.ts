import { chmod, mkdir } from "node:fs/promises";

/** Crea el directorio (y padres) con modo 0700 y fuerza 0700 sobre el último nivel. */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}
