<?php

namespace Shardevcom\Supports\Helpers;

use Illuminate\Database\Eloquent\Collection;
use Shardevcom\Supports\Models\Role;
use Spatie\Permission\Exceptions\RoleDoesNotExist;

class RoleHelper
{
    /**
     * Resuelve una lista de cualquier representación de rol (ID, objeto, array, nombre)
     * a un array de nombres de roles válidos y existentes en BD.
     *
     * La resolución siempre tiene en cuenta el guard_name.
     *
     * @param mixed $roles
     * @param bool $strictValidation
     * @param string|null $guardName
     * @return array<string>
     */
    public static function resolveNames(
        mixed $roles,
        bool $strictValidation = true,
        ?string $guardName = null
    ): array {
        if (empty($roles)) {
            return [];
        }

        if (!is_array($roles)) {
            $roles = [$roles];
        }

        $resolvedNames = [];

        foreach ($roles as $role) {
            $name = static::resolveSingleRoleName(
                $role,
                $strictValidation,
                $guardName
            );

            if ($name !== null) {
                $resolvedNames[] = $name;
            }
        }

        return array_values(array_unique($resolvedNames));
    }

    /**
     * Resuelve y devuelve solo el primer nombre de rol válido.
     */
    public static function resolveFirstName(
        mixed $roles,
        bool $strictValidation = true,
        ?string $guardName = null
    ): ?string {
        $names = static::resolveNames(
            $roles,
            $strictValidation,
            $guardName
        );

        return $names[0] ?? null;
    }

    /**
     * Convierte la entrada directamente a una colección de modelos Role.
     *
     * La consulta también está limitada por guard_name.
     *
     * @return Collection<int, Role>
     */
    public static function resolveModels(
        mixed $roles,
        ?string $guardName = null
    ): Collection {
        $names = static::resolveNames(
            $roles,
            true,
            $guardName
        );

        $query = Role::query();

        if ($guardName !== null) {
            $query->where('guard_name', $guardName);
        }

        if (empty($names)) {
            return $query->whereRaw('1 = 0')->get();
        }

        return $query
            ->whereIn('name', $names)
            ->get();
    }

    /**
     * Lógica interna para resolver un único elemento a su nombre de rol.
     */
    protected static function resolveSingleRoleName(
        mixed $role,
        bool $strictValidation,
        ?string $guardName = null
    ): ?string {
        try {
            /*
             * Si recibimos un modelo Role, podemos obtener directamente
             * su guard_name y evitar mezclar guards.
             */
            if ($role instanceof Role) {
                if (
                    $guardName !== null &&
                    $role->guard_name !== $guardName
                ) {
                    return null;
                }

                return static::validateOrReturnString(
                    $role->name,
                    $strictValidation,
                    $role->guard_name
                );
            }

            /*
             * 1. Array
             *
             * Soporta:
             * [
             *     'id' => 1,
             *     'name' => 'editor',
             *     'guard_name' => 'web',
             * ]
             */
            if (is_array($role)) {
                $roleGuard = static::extractGuardName($role);

                if (
                    $guardName !== null &&
                    $roleGuard !== null &&
                    $roleGuard !== $guardName
                ) {
                    return null;
                }

                $effectiveGuard = $roleGuard ?? $guardName;

                if (
                    isset($role['name']) &&
                    is_string($role['name']) &&
                    trim($role['name']) !== ''
                ) {
                    return static::validateOrReturnString(
                        trim($role['name']),
                        $strictValidation,
                        $effectiveGuard
                    );
                }

                if (
                    isset($role['id']) &&
                    is_numeric($role['id'])
                ) {
                    return static::resolveById(
                        (int) $role['id'],
                        $effectiveGuard
                    );
                }
            }

            /*
             * 2. Objeto
             *
             * Soporta stdClass, DTOs y otros objetos que expongan:
             *
             * ->id
             * ->name
             * ->guard_name
             */
            if (is_object($role)) {
                $roleGuard = static::extractGuardName($role);

                if (
                    $guardName !== null &&
                    $roleGuard !== null &&
                    $roleGuard !== $guardName
                ) {
                    return null;
                }

                $effectiveGuard = $roleGuard ?? $guardName;

                if (
                    isset($role->name) &&
                    is_string($role->name) &&
                    trim($role->name) !== ''
                ) {
                    return static::validateOrReturnString(
                        trim($role->name),
                        $strictValidation,
                        $effectiveGuard
                    );
                }

                if (
                    isset($role->id) &&
                    is_numeric($role->id)
                ) {
                    return static::resolveById(
                        (int) $role->id,
                        $effectiveGuard
                    );
                }
            }

            /*
             * 3. ID numérico puro
             *
             * Ej:
             * 3
             * "3"
             */
            if (is_numeric($role)) {
                return static::resolveById(
                    (int) $role,
                    $guardName
                );
            }

            /*
             * 4. Nombre string puro
             *
             * Ej:
             * "editor"
             * "admin"
             */
            if (
                is_string($role) &&
                trim($role) !== ''
            ) {
                return static::validateOrReturnString(
                    trim($role),
                    $strictValidation,
                    $guardName
                );
            }
        } catch (RoleDoesNotExist) {
            return null;
        } catch (\Throwable) {
            return null;
        }

        return null;
    }

    /**
     * Resuelve un rol por ID respetando guard_name.
     */
    protected static function resolveById(
        int $id,
        ?string $guardName = null
    ): ?string {
        $query = Role::query()
            ->whereKey($id);

        if ($guardName !== null) {
            $query->where('guard_name', $guardName);
        }

        return $query->value('name');
    }

    /**
     * Valida si el nombre existe para el guard indicado.
     */
    protected static function validateOrReturnString(
        string $roleName,
        bool $strictValidation,
        ?string $guardName = null
    ): ?string {
        if (!$strictValidation) {
            return $roleName;
        }

        $query = Role::query()
            ->where('name', $roleName);

        if ($guardName !== null) {
            $query->where('guard_name', $guardName);
        }

        return $query->value('name');
    }

    /**
     * Obtiene guard_name desde un array u objeto.
     */
    protected static function extractGuardName(mixed $role): ?string
    {
        if (is_array($role)) {
            return isset($role['guard_name']) && is_string($role['guard_name'])
                ? $role['guard_name']
                : null;
        }

        if (is_object($role)) {
            return isset($role->guard_name) && is_string($role->guard_name)
                ? $role->guard_name
                : null;
        }

        return null;
    }
}
