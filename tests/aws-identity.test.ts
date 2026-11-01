import { expect, test } from "vitest";
import { getIdentity } from "../src/core/aws-identity.js";
import { fakeRunner } from "./helpers/fixtures.js";

test("identidad ok", async () => {
  const r = await getIdentity("p", "us-east-1", { runner: fakeRunner({ p: "123456789012" }) });
  expect(r).toMatchObject({ state: "ok", account: "123456789012" });
});
test("sesión expirada", async () => {
  expect(await getIdentity("p", "us-east-1", { runner: fakeRunner({ p: "expired" }) })).toMatchObject({ state: "no-session", loginCommand: "aws sso login --profile p" });
});
test("perfil inexistente y CLI ausente son errores, no login", async () => {
  expect(await getIdentity("zz", "us-east-1", { runner: fakeRunner({}) })).toMatchObject({ state: "error" });
  const missing = async () => ({ exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 1, spawnError: "spawn aws ENOENT" });
  expect(await getIdentity("p", "us-east-1", { runner: missing })).toMatchObject({ state: "error" });
});
test("pasa argumentos como array con --profile y sin shell", async () => {
  const runner = fakeRunner({ p: "123456789012" });
  await getIdentity("p", "us-east-1", { runner });
  expect(runner.calls[0]).toEqual(["aws", "sts", "get-caller-identity", "--profile", "p", "--region", "us-east-1", "--output", "json", "--no-cli-pager"]);
});
