/** Diff unificado de líneas, sin dependencias (recorta prefijo/sufijo común y usa LCS para el medio). */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  if (before === after) return "";
  const a = before.split("\n");
  const b = after.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);

  type Op = { k: " " | "-" | "+"; l: string };
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ k: " ", l: a[i]! });
  if (am.length * bm.length > 4_000_000) {
    for (const l of am) ops.push({ k: "-", l });
    for (const l of bm) ops.push({ k: "+", l });
  } else {
    const n = am.length;
    const m = bm.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] = am[i] === bm[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) {
        ops.push({ k: " ", l: am[i]! });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) ops.push({ k: "-", l: am[i++]! });
      else ops.push({ k: "+", l: bm[j++]! });
    }
    while (i < n) ops.push({ k: "-", l: am[i++]! });
    while (j < m) ops.push({ k: "+", l: bm[j++]! });
  }
  for (let i = a.length - suf; i < a.length; i++) ops.push({ k: " ", l: a[i]! });

  // Hunks con contexto.
  const changed = ops.map((o, i) => (o.k === " " ? -1 : i)).filter((i) => i >= 0);
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  let idx = 0;
  while (idx < changed.length) {
    let start = Math.max(0, changed[idx]! - context);
    let end = Math.min(ops.length, changed[idx]! + context + 1);
    let last = idx;
    while (last + 1 < changed.length && changed[last + 1]! - context <= end) {
      last++;
      end = Math.min(ops.length, changed[last]! + context + 1);
    }
    start = Math.min(start, changed[idx]!);
    let aLine = 1;
    let bLine = 1;
    for (let i = 0; i < start; i++) {
      if (ops[i]!.k !== "+") aLine++;
      if (ops[i]!.k !== "-") bLine++;
    }
    const slice = ops.slice(start, end);
    const aCount = slice.filter((o) => o.k !== "+").length;
    const bCount = slice.filter((o) => o.k !== "-").length;
    out.push(`@@ -${aLine},${aCount} +${bLine},${bCount} @@`);
    for (const o of slice) out.push(o.k + o.l);
    idx = last + 1;
  }
  return out.join("\n");
}
