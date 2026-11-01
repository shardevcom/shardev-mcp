import { describe, expect, test } from "vitest";
import { buildEnv, exec } from "../src/core/exec.js";

const node = process.execPath;

describe("exec", () => {
  test("usa argumentos como array, sin shell", async () => {
    const evil = "; echo PWNED $(whoami) `id` | cat";
    const r = await exec(node, ["-e", "process.stdout.write(process.argv[1])", evil]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe(evil);
  });

  test("stdin está cerrado: un hijo que lee stdin recibe EOF de inmediato", async () => {
    const r = await exec(
      node,
      ["-e", "let n=0;process.stdin.on('data',d=>n+=d.length);process.stdin.on('end',()=>console.log('EOF:'+n))"],
      { timeoutMs: 5000 },
    );
    expect(r.timedOut).toBe(false);
    expect(r.stdout.trim()).toBe("EOF:0");
  });

  test("solo hereda la allowlist de entorno", async () => {
    const source = { PATH: process.env.PATH, HOME: "/h", AWS_PROFILE: "p", ANTHROPIC_API_KEY: "sk-ant-leak", GITHUB_TOKEN: "x" };
    const env = buildEnv({}, source);
    expect(Object.keys(env).sort()).toEqual(["AWS_CLI_AUTO_PROMPT", "AWS_PAGER", "AWS_PROFILE", "HOME", "PATH"]);
    const r = await exec(node, ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env)))"], { inheritFrom: source, env: { EXTRA_ONE: "1" } });
    const keys = JSON.parse(r.stdout) as string[];
    expect(keys).toContain("EXTRA_ONE");
    expect(keys).not.toContain("ANTHROPIC_API_KEY");
    expect(keys).not.toContain("GITHUB_TOKEN");
  });

  test("rechaza nombres de variable inválidos y argumentos con NUL", async () => {
    expect(() => buildEnv({ "BAD NAME": "x" }, {})).toThrow();
    await expect(exec(node, ["a\0b"])).rejects.toThrow();
  });

  test("timeout mata el proceso", async () => {
    const r = await exec(node, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
  });

  test("binario inexistente se reporta sin lanzar", async () => {
    const r = await exec("definitely-not-a-binary-xyz", []);
    expect(r.exitCode).toBeNull();
    expect(r.spawnError).toBeDefined();
  });
});
