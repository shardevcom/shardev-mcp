import { ShardevError } from "../core/errors.js";
import type { Ctx } from "../ops/context.js";

/** git por `exec` (array, stdin cerrado), sin hooks del repo ni prompts. Lanza si el exit code != 0. */
export async function git(ctx: Pick<Ctx, "runner">, repo: string, args: string[], opts: { allowFail?: boolean } = {}): Promise<{ ok: boolean; out: string }> {
  const r = await ctx.runner("git", ["-c", "core.hooksPath=/dev/null", "-C", repo, ...args], {
    timeoutMs: 30_000,
    env: { LANG: "C", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
  if (r.spawnError) throw new ShardevError("apply_failed", `No se pudo ejecutar git: ${r.spawnError}`);
  const ok = r.exitCode === 0;
  if (!ok && !opts.allowFail) throw new ShardevError("apply_failed", `git ${args[0]} falló: ${r.stderr.trim().split("\n")[0] ?? ""}`.slice(0, 300));
  return { ok, out: r.stdout.trim() };
}

export const PROTECTED_BRANCHES = /^(master|main)$/i;
export const BRANCH_RE = /^shardev\/[a-z0-9][a-z0-9-]{0,120}$/;
