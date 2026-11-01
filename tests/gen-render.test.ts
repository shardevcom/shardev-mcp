import { describe, expect, test } from "vitest";
import { render } from "../src/gen/render.js";
import { applyInsert, applyJsonMerge, applyYamlAppend, WiringError } from "../src/gen/wiring.js";
import { unifiedDiff } from "../src/gen/diff.js";

const V = { project: { name: "acme", feature: { on: true, off: false }, list: ["a"], empty: [] as string[] }, n: 0 };

describe("renderer", () => {
  test("variables y bloques if (con negación)", () => {
    expect(render("hola {{ project.name }}!", V)).toBe("hola acme!");
    expect(render("{{#if project.feature.on}}SI{{/if}}{{#if !project.feature.on}}NO{{/if}}", V)).toBe("SI");
    expect(render("{{#if project.empty}}x{{/if}}{{#if project.list}}y{{/if}}{{#if n}}z{{/if}}", V)).toBe("y");
  });
  test("etiquetas de bloque solas en su línea no dejan líneas en blanco", () => {
    expect(render("a\n{{#if project.feature.on}}\nb\n{{/if}}\n{{#if project.feature.off}}\nc\n{{/if}}\nd\n", V)).toBe("a\nb\nd\n");
  });
  test("variable desconocida es error, también en una rama no tomada", () => {
    expect(() => render("{{ nope }}", V)).toThrow(/variable desconocida "nope"/);
    expect(() => render("{{ project.nada }}", V)).toThrow(/desconocida/);
    expect(() => render("{{#if project.feature.off}}{{ ghost }}{{/if}}", V)).toThrow(/desconocida "ghost"/);
    expect(() => render("{{ __proto__ }}", V)).toThrow(/desconocida/);
    expect(() => render("{{ project.constructor }}", V)).toThrow(/desconocida/);
  });
  test("bloques desbalanceados y etiquetas inválidas", () => {
    expect(() => render("{{#if project.name}}x", V)).toThrow(/sin cerrar/);
    expect(() => render("x{{/if}}", V)).toThrow(/sin/);
    expect(() => render("{{ project.name", V)).toThrow(/sin cerrar/);
    expect(() => render("{{#each x}}{{/each}}", V)).toThrow(/inválido/);
    expect(() => render("{{ a b }}", V)).toThrow(/inválida/);
    expect(() => render("{{ project.list }}", V)).toThrow(/escalar/);
  });
  test("$VAR, ${VAR}, variables de nginx y ${{ }} pasan intactos; \\{{ es literal", () => {
    const t = 'proxy_set_header Host $host; set $x "${UPSTREAM}"; echo $HOME ${APP_ENV:-x} ${{ secrets.TOKEN }} \\{{ lit }} {{ project.name }}';
    expect(render(t, V)).toBe('proxy_set_header Host $host; set $x "${UPSTREAM}"; echo $HOME ${APP_ENV:-x} ${{ secrets.TOKEN }} {{ lit }} acme');
  });
  test("registra las variables usadas", () => {
    const used = new Set<string>();
    render("{{ project.name }}{{#if project.feature.on}}{{ n }}{{/if}}", V, { used });
    expect([...used].sort()).toEqual(["n", "project.feature.on", "project.name"]);
  });
  test("lenientParents: miembro ausente de un mapa de features vale false", () => {
    expect(render("{{#if project.feature.zzz}}x{{/if}}ok", { project: { feature: {} } }, { lenientParents: ["project.feature"] })).toBe("ok");
    expect(() => render("{{#if project.other.zzz}}x{{/if}}", { project: { other: {} } }, { lenientParents: ["project.feature"] })).toThrow();
  });
});

describe("cableado: json-merge", () => {
  const pkg = '{\n  "name": "a",\n  "scripts": { "x": "1" },\n  "files": ["a"]\n}\n';
  test("fusiona objetos, une arrays y conserva indentación", () => {
    const out = applyJsonMerge(pkg, { scripts: { y: "2" }, files: ["a", "b"] }, "package.json");
    expect(JSON.parse(out)).toEqual({ name: "a", scripts: { x: "1", y: "2" }, files: ["a", "b"] });
    expect(out.startsWith('{\n  "name"')).toBe(true);
    expect(out.endsWith("\n")).toBe(true);
  });
  test("idempotente: reaplicar es no-op byte a byte", () => {
    const once = applyJsonMerge(pkg, { scripts: { y: "2" } }, "p");
    expect(applyJsonMerge(once, { scripts: { y: "2" } }, "p")).toBe(once);
    expect(applyJsonMerge(pkg, { name: "a" }, "p")).toBe(pkg);
  });
  test("conflicto de escalar, JSON inválido y claves prohibidas fallan", () => {
    expect(() => applyJsonMerge(pkg, { name: "b" }, "p")).toThrow(WiringError);
    expect(() => applyJsonMerge("{ // c\n}", { a: 1 }, "p")).toThrow(/JSON válido/);
    expect(() => applyJsonMerge("[]", { a: 1 }, "p")).toThrow(/no es un objeto/);
    expect(() => applyJsonMerge("{}", JSON.parse('{"__proto__": {"x": 1}}'), "p")).toThrow(/prohibida/);
  });
});

describe("cableado: yaml-append", () => {
  const y = "# ws\npackages:\n  - a # uno\n  - b\n";
  test("añade al final de la lista conservando comentarios", () => {
    const out = applyYamlAppend(y, ["packages"], "c", "ws.yaml");
    expect(out).toContain("# ws");
    expect(out).toContain("# uno");
    expect(out).toMatch(/- c\s*$/);
  });
  test("idempotente; ruta ausente o no-lista es error", () => {
    const once = applyYamlAppend(y, ["packages"], "c", "f");
    expect(applyYamlAppend(once, ["packages"], "c", "f")).toBe(once);
    expect(() => applyYamlAppend(y, ["nope"], "c", "f")).toThrow(/no existe/);
    expect(() => applyYamlAppend("packages: x\n", ["packages"], "c", "f")).toThrow(/no es una lista/);
    expect(() => applyYamlAppend("a: [\n", ["a"], "c", "f")).toThrow(/YAML inválido/);
  });
});

describe("cableado: insert anclado", () => {
  const php = "<?php\nreturn [\n    // anchor\n    'end',\n];\n";
  test("before/after con la indentación del ancla", () => {
    expect(applyInsert(php, { anchor: "// anchor", position: "before", content: "'a',\n'b'," }, "f")).toBe("<?php\nreturn [\n    'a',\n    'b',\n    // anchor\n    'end',\n];\n");
    expect(applyInsert(php, { anchor: "// anchor", position: "after", content: "'a'," }, "f")).toContain("    // anchor\n    'a',\n    'end'");
  });
  test("ancla ausente => error", () => {
    expect(() => applyInsert(php, { anchor: "// nope", position: "before", content: "x" }, "f")).toThrow(/ancla no encontrada/);
  });
  test("ancla ambigua => error con las líneas", () => {
    expect(() => applyInsert("// a\n// a\n", { anchor: "// a", position: "after", content: "x" }, "f")).toThrow(/ambigua.*1, 2/);
  });
  test("idempotente: reaplicar no duplica", () => {
    const e = { anchor: "// anchor", position: "before" as const, content: "'a'," };
    const once = applyInsert(php, e, "f");
    expect(applyInsert(once, e, "f")).toBe(once);
  });
});

describe("diff", () => {
  test("diff unificado con contexto; vacío si no hay cambios", () => {
    expect(unifiedDiff("f", "a\nb\n", "a\nb\n")).toBe("");
    const d = unifiedDiff("f.txt", "1\n2\n3\n4\n5\n", "1\n2\nX\n4\n5\n");
    expect(d).toContain("--- a/f.txt");
    expect(d).toContain("-3\n+X");
    expect(d).toMatch(/@@ -1,\d+ \+1,\d+ @@/);
  });
});
