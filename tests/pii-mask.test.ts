import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { maskPersonalData } from "../src/core/pii-mask.js";
import { Redactor } from "../src/core/redact.js";
import { logsDir } from "../src/core/paths.js";
import { createContext } from "../src/ops/context.js";
import { logRead } from "../src/ops/log-read.js";
import { opsLogs } from "../src/ops/logs.js";
import { awsRunner, cwLogs } from "./helpers/aws-fixtures.js";
import { OPS_YAML_SERVICES, cleanup, registerDemoProject, tempPaths } from "./helpers/fixtures.js";

afterEach(cleanup);
const m = (s: string) => maskPersonalData(s);

describe("maskPersonalData", () => {
  test("correos", () => {
    expect(m("login ok juan.perez+x@example.co.uk y ana@demo.io")).toEqual({ text: "login ok [EMAIL] y [EMAIL]", count: 2 });
    expect(m("12345678@demo.com").text).toBe("[EMAIL]");
  });

  test("números largos, teléfonos con + / espacios / guiones y documentos", () => {
    expect(m("tel 3001234567 doc 1020304050 id=12345678").text).toBe("tel [NUMERO] doc [NUMERO] id=[NUMERO]");
    expect(m("llamar +573001234567").text).toBe("llamar [NUMERO]");
    expect(m("+57 300 123 4567").text).toBe("[NUMERO]");
    expect(m("300-123-4567 y 300 123 4567").text).toBe("[NUMERO] y [NUMERO]");
    expect(m("1234567").text).toBe("[NUMERO]");
    expect(m("pedido 20261101").text).toBe("pedido [NUMERO]"); // fecha compacta: indistinguible de un ID
  });

  test("se conserva: ISO, UUID, estados HTTP, puertos, duraciones y números cortos", () => {
    const keep = [
      "2026-11-01T12:00:00Z",
      "2026-11-01T12:00:00.123+00:00",
      "2026-11-01 12:00:00",
      "fecha 2026-11-01",
      "GET /api/x 200 15ms",
      "HTTP/1.1 404 puerto 8080 y 5432 latency=1532ms",
      "10.0.0.12:3000 pid 123456 count=999999",
      "req 9b2f6a1e-1234-4abc-8def-123456789012",
      "version 1.2.3 pi 3.14159265 monto 1234567.89",
      "200 1532",
    ];
    for (const s of keep) expect(m(s), s).toEqual({ text: s, count: 0 });
    // el timestamp inicial de la línea no se toca aunque haya datos personales después
    expect(m("2026-11-01T12:00:00Z user a@b.com").text).toBe("2026-11-01T12:00:00Z user [EMAIL]");
  });

  test("epoch: se conserva con clave de tiempo; sin clave se enmascara", () => {
    expect(m('ts=1761998400 "timestamp": 1761998400123 exp:1761998400').count).toBe(0);
    expect(m("valor 1761998400").text).toBe("valor [NUMERO]");
  });

  test("idempotente y el contador no depende de los valores", () => {
    const once = m("a@b.com 3001234567 +57 300 123 4567, status 200 ok");
    expect(once.count).toBe(3);
    expect(m(once.text)).toEqual({ text: once.text, count: 0 });
    expect(once.text).toBe("[EMAIL] [NUMERO] [NUMERO], status 200 ok");
  });
});

describe("ops_logs aplica el enmascarado solo a su contenido", () => {
  const NOW = new Date("2026-11-01T12:00:00.000Z");
  async function setup(messages: string[]) {
    const paths = await tempPaths();
    await registerDemoProject(paths, "", OPS_YAML_SERVICES());
    const ev = messages.map((message, i) => ({ timestamp: Date.parse("2026-11-01T11:00:00Z") + i * 1000, message }));
    const runner = awsRunner({ "demo-stg": "111111111111", "demo-prod": "222222222222" }, { "logs filter-log-events": cwLogs(ev) });
    return { paths, ctx: createContext(paths, { runner, now: () => NOW }) };
  }

  test("guarda enmascarado, cuenta sin valores, log_read devuelve el texto enmascarado y la cabecera no lleva el filtro", async () => {
    const { ctx, paths } = await setup(["login juan@example.com tel 3001234567 status 200 port 8080", "Authorization: Bearer abcdefghijklmnop1234 sin datos", "limpio"]);
    const o = await opsLogs(ctx, { project: "demo", env: "staging", service: "demo-staging-app", filter: "juan@example.com" });
    expect(o.isError).toBe(false);
    const j = JSON.parse(o.text);
    expect(j.personal_data_masked).toBe(2);
    for (const leaked of ["juan@example.com", "3001234567", "abcdefghijklmnop1234"]) expect(o.text).not.toContain(leaked);
    const disk = await readFile(join(logsDir(paths), j.log_ref), "utf8");
    expect(disk).toContain("login [EMAIL] tel [NUMERO] status 200 port 8080");
    expect(disk).toContain("sin datos");
    expect(disk).toContain("2026-11-01T11:00:00.000Z login"); // timestamp propio intacto
    expect(disk.split("\n")[0]).not.toContain("juan@example.com"); // el filtro no va en la cabecera
    expect(disk).not.toContain("filter");
    const read = await logRead(ctx, { ref: j.log_ref });
    expect(read.text).toContain("[EMAIL]");
    expect(read.text).not.toContain("3001234567");
  });

  test("sin datos personales el contador es 0; el Redactor global y otros logs no cambian", async () => {
    const { ctx } = await setup(["todo normal"]);
    expect(JSON.parse((await opsLogs(ctx, { project: "demo", env: "staging", service: "demo-staging-app" })).text).personal_data_masked).toBe(0);
    // otros logs (LogStore.write directo) no se enmascaran
    const w = await ctx.logs.write("project-create", "contacto ana@demo.io tel 3001234567");
    expect((await logRead(ctx, { ref: w.ref })).text).toContain("ana@demo.io");
    expect(new Redactor().redact("ana@demo.io 3001234567")).toBe("ana@demo.io 3001234567");
  });
});
