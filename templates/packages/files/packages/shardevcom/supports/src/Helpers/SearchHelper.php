<?php

namespace Shardevcom\Supports\Helpers;

use Illuminate\Contracts\Database\Query\Builder as BuilderContract;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Busqueda de texto sin distinguir mayusculas ni tildes, igual en MySQL y SQLite.
 *
 * MySQL (utf8mb4_unicode_ci) ya ignora mayusculas y tildes en LIKE. SQLite solo
 * ignora mayusculas ASCII, asi que se registra rz_fold() (ASCII + minuscula)
 * para que los tests y entornos locales se comporten igual.
 */
class SearchHelper
{
    /** Minuscula y sin tildes. */
    public static function fold(?string $value): string
    {
        return Str::lower(Str::ascii(trim((string) $value)));
    }

    /** Escapa % _ y el propio caracter de escape ('!') de un patron LIKE. */
    public static function escapeLike(string $value): string
    {
        return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value);
    }

    /**
     * Agrega `$column LIKE %term%` al builder (OR si $or). `$column` debe ser
     * una columna fija del codigo (nunca input del usuario).
     */
    public static function whereContains(BuilderContract $query, string $column, string $term, bool $or = false): BuilderContract
    {
        $pattern = '%'.self::escapeLike(self::fold($term)).'%';
        $method = $or ? 'orWhereRaw' : 'whereRaw';

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::connection()->getPdo()->sqliteCreateFunction(
                'rz_fold',
                fn ($v) => $v === null ? null : self::fold((string) $v),
                1
            );

            return $query->{$method}("rz_fold({$column}) LIKE ? ESCAPE '!'", [$pattern]);
        }

        return $query->{$method}("{$column} LIKE ? ESCAPE '!'", [$pattern]);
    }
}
