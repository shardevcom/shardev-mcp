<?php

namespace Shardevcom\Supports\Helpers;

use Illuminate\Support\Str;

class SafeProperty
{
    /**
     * Obtiene una propiedad o método de forma segura.
     *
     * - Soporta camelCase y snake_case.
     * - Soporta métodos como getXxx() o get_xxx().
     */
    public static function get($object, string $property, string $method = null)
    {
        if (!$object) {
            return null;
        }

        // 1️⃣ Buscar propiedad exacta
        if (property_exists($object, $property)) {
            return $object->{$property};
        }

        // 2️⃣ Buscar versión snake_case
        $snake = str_replace('-', '_', Str::snake($property));
        if (property_exists($object, $snake)) {
            return $object->{$snake};
        }

        // 3️⃣ Buscar versión camelCase
        $camel = Str::camel($property);
        if (property_exists($object, $camel)) {
            return $object->{$camel};
        }

        // 4️⃣ Buscar método exacto
        if ($method && method_exists($object, $method)) {
            return $object->{$method}();
        }

        // 5️⃣ Buscar métodos dinámicos tipo getXxx()
        $getter = 'get' . ucfirst($property);
        if (method_exists($object, $getter)) {
            return $object->{$getter}();
        }

        // 6️⃣ Buscar métodos dinámicos tipo get_xxx()
        $getterSnake = 'get_' . Str::snake($property);
        if (method_exists($object, $getterSnake)) {
            return $object->{$getterSnake}();
        }

        return null;
    }
}
