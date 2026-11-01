<?php

namespace Shardevcom\Supports\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Relations\Relation;

class OwnerTypeCast implements CastsAttributes
{
    /**
     * Al leer de la base de datos (Get).
     */
    public function get($model, string $key, $value, array $attributes)
    {
        if (empty($value)) {
            return null;
        }

        // Resolver mediante el Morph Map nativo de Laravel
        $classname = Relation::getMorphedModel($value) ?? $value;

        if (str_contains($classname, '\\') && !class_exists($classname)) {
            return null;
        }

        return $classname;
    }

    /**
     * Al escribir en la base de datos (Set).
     * Retorna un array con la columna => valor para asegurar que Eloquent lo procese.
     */
    public function set($model, string $key, $value, array $attributes)
    {
        if (empty($value)) {
            return [$key => null];
        }

        $morphMap = Relation::morphMap();

        // ---------------------------------------------------------------------
        // Caso A: El frontend/Request envió un FQCN completo (ej: App\Models\Admin)
        // ---------------------------------------------------------------------
        if (str_contains($value, '\\')) {
            if (class_exists($value)) {
                // Buscamos si la clase tiene un alias corto en el Morph Map
                $alias = array_search($value, $morphMap);
                return [$key => $alias ?: $value];
            }
            return [$key => null];
        }

        // ---------------------------------------------------------------------
        // Caso B: El frontend/Request envió la string limpia (ej: "admin", "user")
        // ---------------------------------------------------------------------
        $valueLower = strtolower(trim($value));

        // 1. Verificamos si el string es una de las LLAVES del Morph Map (ej: 'admin')
        if (array_key_exists($valueLower, $morphMap)) {
            return [$key => $valueLower];
        }

        // 2. Verificamos si pasaron el nombre en un formato que coincide con los VALORES del Morph Map
        // por si acaso el mapeo se hizo con mayúsculas o namespaces particulares
        foreach ($morphMap as $alias => $classname) {
            if (strtolower(class_basename($classname)) === $valueLower) {
                return [$key => $alias];
            }
        }


        // Si llegó hasta aquí y no hay coincidencias, guardamos el string original en minúsculas
        // para no romper inserts sueltos de la base de datos
        return [$key => $valueLower];
    }
}
