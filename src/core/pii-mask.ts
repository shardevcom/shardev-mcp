/**
 * Enmascarado CONSERVADOR de datos personales para el contenido de `ops_logs` (solo ahí; no es el Redactor global).
 * Reduce la exposición, NO anonimiza: no detecta nombres, direcciones postales ni texto libre, y puede dejar pasar
 * formatos de teléfono/ID que no encajen en las reglas de abajo. No hay forma de desactivarlo desde una herramienta.
 *
 * Reglas:
 * - Correos electrónicos => `[EMAIL]`.
 * - Secuencias de 7+ dígitos seguidos (con `+` inicial opcional) => `[NUMERO]`.
 * - Grupos separados por espacio o guion (`+57 300 123 4567`, `300-123-4567`: grupos de 2-4 dígitos tras el primero)
 *   con 9+ dígitos en total => `[NUMERO]`.
 * - Se dejan intactos: fechas/horas ISO 8601, UUID, y números cortos (estados HTTP, puertos, duraciones, conteos < 7 dígitos).
 * - Epoch (10 u 13 dígitos que empiezan por 1) solo se conserva cuando la clave que lo precede indica tiempo
 *   (`ts`, `time`, `timestamp`, `epoch`, `date`, `*_at`, `iat`, `exp`, `nbf`, `duration`...). Un epoch sin esa clave es
 *   indistinguible de un teléfono o documento de 10 dígitos y se enmascara. Los ID numéricos largos (7+ dígitos) también.
 * - Idempotente: `[EMAIL]` y `[NUMERO]` no contienen @ ni dígitos.
 */
export const EMAIL_MASK = "[EMAIL]";
export const NUMBER_MASK = "[NUMERO]";

const ISO = String.raw`(?<![\d])\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const UUID = String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`;
const TIME_KEY = String.raw`(?:ts|time|timestamp|epoch|date|datetime|[a-z_]*_at|[a-z]*At|iat|exp|nbf|duration|elapsed|latency)`;
const EPOCH = String.raw`(?<![\w])${TIME_KEY}["']?\s*[=:]\s*["']?1(?:\d{9}|\d{12})(?!\d)`;
const EMAIL = String.raw`[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`;
const LONG = String.raw`(?<!\w|\d\.)\+?\d{7,}(?!\w|\.\d)`;
const GROUPED = String.raw`(?<!\w|\d\.)\+?\d{1,4}(?:[ -]\d{2,4}){2,}(?!\w|\.\d)`;

const RE = new RegExp(`(?<iso>${ISO})|(?<uuid>${UUID})|(?<epoch>${EPOCH})|(?<email>${EMAIL})|(?<long>${LONG})|(?<grouped>${GROUPED})`, "gi");

export interface MaskResult {
  text: string;
  /** Cuántas coincidencias se enmascararon (nunca los valores). */
  count: number;
}

export function maskPersonalData(input: string): MaskResult {
  let count = 0;
  const text = input.replace(RE, (match, ...rest) => {
    const g = rest[rest.length - 1] as Record<string, string | undefined>;
    if (g.iso !== undefined || g.uuid !== undefined || g.epoch !== undefined) return match;
    if (g.email !== undefined) {
      count++;
      return EMAIL_MASK;
    }
    if (g.grouped !== undefined && match.replace(/\D/g, "").length < 9) return match;
    count++;
    return NUMBER_MASK;
  });
  return { text, count };
}
