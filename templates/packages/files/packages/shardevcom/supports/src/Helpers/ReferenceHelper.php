<?php

namespace Shardevcom\Supports\Helpers;

use Illuminate\Support\Str;

class ReferenceHelper
{
    /**
     * Extrae y normaliza una referencia numérica o textual.
     *
     * - Detecta una referencia numérica en cualquier posición.
     * - Si no hay números, usa el texto completo.
     * - Limpia caracteres no válidos, convierte a ASCII y minúsculas.
     *
     * @param  string|null  $reference
     * @return string|null
     */
    public static function normalize(?string $reference): string
    {
        // 1. Si está vacío, devolvemos el nuevo estándar en mayúsculas 'NONE'
        if (blank($reference)) {
            return 'NONE';
        }

        $line = trim($reference);

        // 2. Buscar la primera secuencia de dígitos (al menos 3 números seguidos)
        preg_match('/\b\d{3,}\b/', $line, $match);

        $ref = $match[0] ?? $line;

        // 3. Limpieza y formateo
        $normalized = Str::of($ref)
            ->ascii()
            ->upper()                             // <--- CAMBIADO: De lower() a upper()
            ->replace([' ', '_'], '-')
            ->replaceMatches('/[^A-Z0-9\-]/', '') // <--- AJUSTADO: Ahora busca de la A a la Z en mayúsculas
            ->replaceMatches('/-+/', '-')
            ->trim('-')
            ->value();

        // 4. Doble verificación por si quedó vacío tras la limpieza
        return empty($normalized) ? 'NONE' : $normalized;
    }
}
