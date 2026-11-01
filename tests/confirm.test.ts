import { spawnSync } from "node:child_process";
import { describe, expect, test, vi } from "vitest";
import { confirmHuman, type ConfirmIo } from "../src/core/confirm.js";

function fake(line: string | null, tty: { stdin?: boolean; stderr?: boolean } = { stdin: true, stderr: true }) {
  const err: string[] = [];
  const readLine = vi.fn(async () => line);
  const io: ConfirmIo = { err: (s) => err.push(s), isTty: (s) => tty[s] === true, readLine };
  return { io, err, readLine };
}
const opts = { summary: ["Reiniciar demo/prod"], phrase: "demo/prod" };

describe("confirmHuman", () => {
  test("confirma con la frase exacta, con o sin fin de línea", async () => {
    expect(await confirmHuman(fake("demo/prod").io, opts)).toBe("confirmed");
    expect(await confirmHuman(fake("demo/prod\r\n").io, opts)).toBe("confirmed");
  });

  test("frase errónea, distinto caso, vacía, con espacios y EOF no confirman", async () => {
    for (const l of ["demo/stg", "Demo/Prod", "DEMO/PROD", "", " demo/prod", "demo/prod ", "y", "yes"]) expect(await confirmHuman(fake(l).io, opts)).toBe("mismatch");
    expect(await confirmHuman(fake(null).io, opts)).toBe("eof");
  });

  test("una sola lectura, sin reintentos", async () => {
    const f = fake("mal");
    await confirmHuman(f.io, opts);
    expect(f.readLine).toHaveBeenCalledTimes(1);
  });

  test("stdin sin TTY: rechaza sin leer; stderr sin TTY: también; sin isTty/readLine: falla cerrado", async () => {
    const a = fake("demo/prod", { stdin: false, stderr: true });
    expect(await confirmHuman(a.io, opts)).toBe("no_tty");
    expect(a.readLine).not.toHaveBeenCalled();
    expect(a.err).toHaveLength(0);
    const b = fake("demo/prod", { stdin: true, stderr: false });
    expect(await confirmHuman(b.io, opts)).toBe("no_tty");
    expect(b.readLine).not.toHaveBeenCalled();
    expect(await confirmHuman({ err: () => undefined }, opts)).toBe("no_tty");
  });

  test("el resumen y el prompt van a stderr y nada a stdout", async () => {
    const out = vi.spyOn(process.stdout, "write");
    const f = fake("demo/prod");
    await confirmHuman(f.io, opts);
    expect(f.err.join("")).toContain("Reiniciar demo/prod");
    expect(f.err.join("")).toContain("demo/prod");
    expect(out).not.toHaveBeenCalled();
    out.mockRestore();
  });

  test("proceso real: la frase correcta por tubería no confirma", () => {
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "tests/helpers/confirm-child.mts"], { input: "demo/prod\n", encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("no_tty");
    expect(r.stderr).not.toContain("Para confirmar");
  });
});
