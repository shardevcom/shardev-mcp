import { describe, expect, test } from "vitest";
import { Redactor } from "../src/core/redact.js";

const r = new Redactor();

describe("redact: formas conocidas", () => {
  test.each([
    ["sk-ant-api03-AbCdEfGhIjKlMnOp"],
    ["AIzaSyA1234567890abcdefghijklmnopqrstuv"],
    ["GOCSPX-abcdefghijklmnop12345"],
    ["AKIAIOSFODNN7EXAMPLE"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcDEF123_-xyz"],
  ])("enmascara %s", (secret) => {
    const out = r.redact(`algo ${secret} fin`);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });

  test("Bearer y bloques de clave privada", () => {
    expect(r.redact("Authorization: Bearer abcdef1234567890")).not.toContain("abcdef1234567890");
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\nabc\n-----END RSA PRIVATE KEY-----";
    const out = r.redact(`antes\n${pem}\ndespués`);
    expect(out).not.toContain("MIIBOgIBAAJBAK");
    expect(out).toContain("antes");
    expect(out).toContain("después");
  });
});

describe("redact: NAME=valor", () => {
  test("export con comillas dobles (incidente real)", () => {
    const out = r.redact('export GITHUB_TOKEN="un valor con espacios y sin forma conocida"');
    expect(out).toBe('export GITHUB_TOKEN="[REDACTED]"');
  });
  test("comillas dobles con comilla escapada", () => {
    const out = r.redact('export DB_PASSWORD="ab\\"cd ef"');
    expect(out).not.toContain("cd ef");
    expect(out).not.toContain("ab");
  });
  test("comillas simples", () => {
    expect(r.redact("export API_KEY='p@ss w0rd'")).toBe("export API_KEY='[REDACTED]'");
  });
  test("comilla sin cerrar", () => {
    const out = r.redact('export MY_SECRET="empieza y no cierra');
    expect(out).not.toContain("empieza");
  });
  test("sin comillas, con espacios alrededor del =, y .env", () => {
    expect(r.redact("DB_PASSWORD=hunter2")).toBe("DB_PASSWORD=[REDACTED]");
    expect(r.redact("aws_secret_access_key = wJalrXUtnFEMI")).not.toContain("wJalrXUtnFEMI");
  });
  test("JSON y flags de CLI", () => {
    expect(r.redact('{"client_secret": "abc def", "name": "x"}')).toBe('{"client_secret": "[REDACTED]", "name": "x"}');
    expect(r.redact("tool --password hunter2 --verbose")).toBe("tool --password [REDACTED] --verbose");
    expect(r.redact("tool --token=abc123 ok")).not.toContain("abc123");
  });
  test("no enmascara nombres inocentes", () => {
    expect(r.redact("AUTHOR=Bob REGION=us-east-1 PRIMARYKEY=1")).toBe("AUTHOR=Bob REGION=us-east-1 PRIMARYKEY=1");
  });
  test("es idempotente", () => {
    const once = r.redact('export X_TOKEN="a b"');
    expect(r.redact(once)).toBe(once);
  });
});

describe("redact: nombre: valor y URLs", () => {
  test.each([
    ["db_password: hunter2", "hunter2"],
    ["  api_key: \"con espacios y sin forma\"", "con espacios"],
    ["client_secret: 'abc def'", "abc def"],
    ["2026-11-01 INFO auth token: zzTop99xx", "zzTop99xx"],
    ["- name: x\n  DB_PASSWORD: s3cr3tvalue", "s3cr3tvalue"],
  ])("YAML/log: %s", (line, secret) => {
    const out = r.redact(line);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED]");
  });
  test("valor vacío no se traga la línea siguiente; nombres inocentes intactos", () => {
    expect(r.redact("password:\nregion: us-east-1")).toBe("password:\nregion: us-east-1");
    expect(r.redact("author: Bob\nregion: us-east-1")).toBe("author: Bob\nregion: us-east-1");
  });
  test("credenciales en URLs conservan usuario y host", () => {
    expect(r.redact("DATABASE_URL: mysql://app:pa55w0rd@db.internal:3306/x")).not.toContain("pa55w0rd");
    expect(r.redact("conecta a mysql://app:pa55w0rd@db.internal:3306/x ok")).toBe("conecta a mysql://app:[REDACTED]@db.internal:3306/x ok");
    expect(r.redact("redis://u:p@ss@h:6379")).toBe("redis://u:[REDACTED]@h:6379");
    expect(r.redact("https://example.com/a:b@c")).toBe("https://example.com/a:b@c");
  });
  test("idempotente", () => {
    const once = r.redact("token: abc123def\nmysql://u:pw@h/d");
    expect(r.redact(once)).toBe(once);
  });
});

describe("redact: literales y objetos", () => {
  test("valores registrados se enmascaran en cualquier contexto; los muy cortos se ignoran", () => {
    const x = new Redactor();
    x.register("zq-literal-9981", "ab");
    expect(x.redact("el valor es zq-literal-9981.")).toBe("el valor es [REDACTED].");
    expect(x.redact("ab ab")).toBe("ab ab");
  });
  test("redactValue enmascara claves secretas y strings anidados", () => {
    const out = r.redactValue({ api_key: "x", nested: { note: "TOKEN=abc" }, list: ["Bearer abcdefgh12345"], n: 3 });
    expect(JSON.stringify(out)).not.toMatch(/abc"|abcdefgh12345|"x"/);
    expect((out as { n: number }).n).toBe(3);
  });
});
