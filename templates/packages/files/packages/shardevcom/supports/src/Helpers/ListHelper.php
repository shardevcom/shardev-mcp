<?php

namespace Shardevcom\Supports\Helpers;

/**
 * Normaliza listas que llegan por query string (`include`, `fields`, ...).
 *
 * Acepta indistintamente un array, una cadena separada por comas o una mezcla:
 * `['a', 'b']`, `['a,b']` y `'a,b'` producen `['a', 'b']`. Recorta espacios y
 * descarta los elementos vacíos. No valida contra ninguna allowlist: eso lo
 * hace siempre quien consume la lista.
 */
final class ListHelper
{
    /**
     * @param  array<int|string, mixed>|string|null  $items
     * @return list<mixed>
     */
    public static function normalize(array|string|null $items): array
    {
        if ($items === null) {
            return [];
        }

        return collect((array) $items)
            ->flatMap(fn ($item) => is_string($item) ? explode(',', $item) : [$item])
            ->map(fn ($item) => is_string($item) ? trim($item) : $item)
            ->filter()
            ->values()
            ->all();
    }
}
