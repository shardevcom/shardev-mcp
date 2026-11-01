import { ShardevError } from "../core/errors.js";

/**
 * Renderizador mínimo y estricto, sin dependencias.
 *   {{ var.path }}                 valor escalar (string/number/boolean)
 *   {{#if var}}...{{/if}}          bloque condicional; `{{#if !var}}` lo niega
 * Errores: variable desconocida, bloque sin cerrar o sobrante, etiqueta inválida, valor no escalar.
 * Literales que NO se tocan: `$VAR`, `${VAR}`, `${{ ... }}` (GitHub Actions) y variables de nginx.
 * Para emitir un `{{` literal, escribe `\{{`.
 */

export type Vars = Record<string, unknown>;

export interface RenderOptions {
  /** Recibe las rutas de variable referenciadas en la plantilla (en cualquier rama). */
  used?: Set<string>;
  /** Mapas cuyo miembro ausente vale `false` en vez de ser error (p. ej. "project.feature"). */
  lenientParents?: readonly string[];
}

type Node =
  | { t: "text"; v: string }
  | { t: "var"; name: string }
  | { t: "if"; neg: boolean; name: string; kids: Node[] };

const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const IF_RE = /^#if\s+(!?)\s*([A-Za-z_][A-Za-z0-9_.]*)$/;

const fail = (msg: string): never => {
  throw new ShardevError("invalid_template", msg);
};

function lineOf(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function parse(text: string, name: string): Node[] {
  const root: Node[] = [];
  const stack: Array<{ kids: Node[]; openedAt: number }> = [{ kids: root, openedAt: 0 }];
  let pos = 0;
  let lit = "";
  const flush = (): void => {
    if (lit) {
      stack[stack.length - 1]!.kids.push({ t: "text", v: lit });
      lit = "";
    }
  };
  while (pos < text.length) {
    const open = text.indexOf("{{", pos);
    if (open === -1) {
      lit += text.slice(pos);
      break;
    }
    // `\{{` y `${{` => literal
    if (open > 0 && text[open - 1] === "\\") {
      lit += text.slice(pos, open - 1) + "{{";
      pos = open + 2;
      continue;
    }
    if (open > 0 && text[open - 1] === "$") {
      lit += text.slice(pos, open + 2);
      pos = open + 2;
      continue;
    }
    const close = text.indexOf("}}", open + 2);
    if (close === -1) fail(`${name}: "{{" sin cerrar en la línea ${lineOf(text, open)}`);
    const inner = text.slice(open + 2, close).trim();
    if (inner.includes("{{")) fail(`${name}: "{{" anidado en la línea ${lineOf(text, open)}`);
    const isBlock = inner.startsWith("#") || inner.startsWith("/");
    let segment = text.slice(pos, open);
    let next = close + 2;
    if (isBlock) {
      // Etiqueta sola en su línea: no deja líneas en blanco.
      const lineStart = text.lastIndexOf("\n", open - 1) + 1;
      const before = text.slice(lineStart, open);
      const nl = text.indexOf("\n", close + 2);
      const after = text.slice(close + 2, nl === -1 ? text.length : nl);
      if (/^[ \t]*$/.test(before) && /^[ \t\r]*$/.test(after) && before.length <= segment.length) {
        segment = segment.slice(0, segment.length - before.length);
        next = nl === -1 ? text.length : nl + 1;
      }
    }
    lit += segment;
    pos = next;
    flush();
    const top = stack[stack.length - 1]!;
    if (inner === "/if") {
      if (stack.length === 1) fail(`${name}: "{{/if}}" sin "{{#if}}" (línea ${lineOf(text, open)})`);
      stack.pop();
    } else if (inner.startsWith("#")) {
      const m = IF_RE.exec(inner);
      if (!m) fail(`${name}: bloque inválido "{{${inner}}}" (línea ${lineOf(text, open)}); solo existe {{#if x}}`);
      const node: Node = { t: "if", neg: m![1] === "!", name: m![2]!, kids: [] };
      top.kids.push(node);
      stack.push({ kids: node.kids, openedAt: open });
    } else if (inner.startsWith("/")) {
      fail(`${name}: cierre desconocido "{{${inner}}}" (línea ${lineOf(text, open)})`);
    } else {
      if (!VAR_RE.test(inner)) fail(`${name}: etiqueta inválida "{{${inner}}}" (línea ${lineOf(text, open)})`);
      top.kids.push({ t: "var", name: inner });
    }
  }
  flush();
  if (stack.length > 1) fail(`${name}: "{{#if}}" sin cerrar (línea ${lineOf(text, stack[stack.length - 1]!.openedAt)})`);
  return root;
}

function lookup(vars: Vars, path: string, opts: RenderOptions, where: string): unknown {
  let cur: unknown = vars;
  const parts = path.split(".");
  for (let i = 0; i < parts.length; i++) {
    const k = parts[i]!;
    if (cur !== null && typeof cur === "object" && !Array.isArray(cur) && Object.hasOwn(cur, k)) {
      cur = (cur as Record<string, unknown>)[k];
    } else if (i === parts.length - 1 && opts.lenientParents?.includes(parts.slice(0, i).join("."))) {
      return false;
    } else {
      return fail(`${where}: variable desconocida "${path}"`);
    }
  }
  return cur;
}

const truthy = (v: unknown): boolean => {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.length > 0;
  if (typeof v === "number") return v !== 0;
  return Boolean(v);
};

function check(nodes: Node[], vars: Vars, opts: RenderOptions, where: string): void {
  for (const n of nodes) {
    if (n.t === "text") continue;
    opts.used?.add(n.name);
    lookup(vars, n.name, opts, where);
    if (n.t === "if") check(n.kids, vars, opts, where);
  }
}

function emit(nodes: Node[], vars: Vars, opts: RenderOptions, where: string): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "var") {
      const v = lookup(vars, n.name, opts, where);
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        fail(`${where}: "${n.name}" no es un valor escalar y no se puede interpolar`);
      }
      out += String(v);
    } else if (truthy(lookup(vars, n.name, opts, where)) !== n.neg) out += emit(n.kids, vars, opts, where);
  }
  return out;
}

/** Evalúa una condición `a.b` / `!a.b` (para `when:` de las capas). */
export function evalCondition(expr: string, vars: Vars, opts: RenderOptions = {}, where = "when"): boolean {
  const m = /^(!?)\s*([A-Za-z_][A-Za-z0-9_.]*)$/.exec(expr.trim());
  if (!m) return fail(`${where}: condición inválida "${expr}"`);
  opts.used?.add(m[2]!);
  return truthy(lookup(vars, m[2]!, opts, where)) !== (m[1] === "!");
}

export function render(template: string, vars: Vars, opts: RenderOptions = {}, name = "plantilla"): string {
  const nodes = parse(template, name);
  check(nodes, vars, opts, name); // toda variable, también las de ramas no tomadas, debe existir
  return emit(nodes, vars, opts, name);
}
