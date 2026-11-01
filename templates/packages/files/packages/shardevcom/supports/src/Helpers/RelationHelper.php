<?php

namespace Shardevcom\Supports\Helpers;

use Illuminate\Database\Eloquent\Relations\Relation;

class RelationHelper
{

    /**
     * Obtiene los alias (keys) válidos del morphMap.
     * Retorna: ['User', 'Admin', ...]
     */
    public static function getMorphKeys(): array
    {
        return array_keys(Relation::morphMap());
    }

    /**
     * Verifica si un owner_type dado existe dentro del morphMap.
     */
    public static function isValidMorphType(?string $type): bool
    {
        if (!$type) {
            return false;
        }

        $normalized = self::normalizeOwnerType($type); // p. ej. 'admin' -> 'Admin'

        return array_key_exists($normalized, Relation::morphMap());
    }

    /**
     * Devuelve el nombre de la clase base del modelo o string.
     */
    public static function morphType($model): string
    {
        if (is_object($model)) {
            return class_basename(get_class($model));
        }

        return class_basename($model);
    }

    /**
     * Convierte a formato estándar de almacenamiento (Admin, User, etc).
     */
    public static function normalizeOwnerType(string $type): string
    {
        return ucfirst(strtolower($type));
    }

    /**
     * Mantiene versión "key" para validaciones (admin, user).
     */
    public static function keyOwnerType(string $type): string
    {
        return strtolower($type);
    }
}
