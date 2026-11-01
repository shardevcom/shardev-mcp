<?php

namespace Shardevcom\Supports\Services;

use Shardevcom\Supports\Models\Role;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\PermissionRegistrar;

/**
 * Sincroniza los permisos del sistema con la base de datos.
 *
 * FUENTE ÚNICA: lee exclusivamente de config('shardevcom.permissions').
 * No fusiona configs de paquetes — toda la definición de permisos vive en
 * config/shardevcom.php.
 *
 * Flujo:
 *   1. Limpia cache de Spatie
 *   2. Lee guards de config('supports.permissions.guards')
 *   3. Para cada guard, lee recursos de config('shardevcom.permissions.{guard}')
 *   4. Por cada resource → role → action: Permission::firstOrCreate
 *   5. Por cada rol: un único givePermissionTo con todos sus permisos del guard
 *
 * Es idempotente: ejecutar múltiples veces no genera duplicados (Spatie lo garantiza).
 *
 * `$onlyResources` limita la pasada a esos recursos (p. ej. una migración que
 * crea un permiso nuevo): así no se vuelve a conceder un permiso que alguien
 * haya quitado a mano de otro recurso. Vacío = toda la matriz.
 */
class PermissionSyncService
{
    /**
     * Cache de permisos ya procesados en esta pasada de sync() para evitar
     * llamadas duplicadas a Permission::firstOrCreate para la misma tupla
     * (guard, action, resource).
     *
     * @var array<string, Permission>
     */
    private array $created = [];

    /** @param  list<string>  $onlyResources */
    public function sync(array $onlyResources = []): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        $this->created = [];

        $validGuards = config('supports.permissions.guards', ['web', 'adm']);

        foreach ($validGuards as $guard) {
            $resources = config("shardevcom.permissions.{$guard}", []);

            if ($onlyResources !== []) {
                $resources = array_filter(
                    $resources,
                    fn ($value, $key) => in_array(is_string($value) ? $value : $key, $onlyResources, true),
                    ARRAY_FILTER_USE_BOTH,
                );
            }

            if (empty($resources)) {
                continue;
            }

            $this->registerPermissions($resources, $guard);
        }
    }

    protected function registerPermissions(array $resources, string $guard): void
    {
        $validActions = config('supports.permissions.actions', [
            'view', 'create', 'update', 'remove', 'manage', 'import', 'export'
        ]);

        // Roles del guard ya consultados (null = no existe) y permisos a conceder
        // a cada uno. La concesión se hace al final, una vez por rol: cada
        // givePermissionTo() recarga la relación y limpia la caché de Spatie, y
        // llamarlo por permiso hacía que un sync completo tardara ~0.7 s.
        /** @var array<string, Role|null> $roles */
        $roles = [];
        /** @var array<string, array<string, Permission>> $grants */
        $grants = [];

        foreach ($resources as $key => $value) {
            $resource = is_string($value) ? $value : $key;
            $data     = is_string($value) ? null : $value;

            foreach ($this->normalizeRoles($data, $guard) as $roleName => $actions) {
                if (! is_array($actions)) {
                    continue;
                }

                if (! array_key_exists($roleName, $roles)) {
                    $roles[$roleName] = Role::where('name', $roleName)
                        ->where('guard_name', $guard)
                        ->first();
                }

                // Si el rol no existe en BD, se omite para no contaminar la BD.
                if (! $roles[$roleName]) {
                    continue;
                }

                foreach ($actions as $action) {
                    if (! in_array($action, $validActions)) {
                        continue;
                    }

                    $cacheKey = "{$guard}.{$action}.{$resource}";

                    if (! isset($this->created[$cacheKey])) {
                        $this->created[$cacheKey] = Permission::firstOrCreate(
                            ['name' => "{$action}:{$resource}", 'guard_name' => $guard],
                            [
                                'group'       => $resource,
                                'description' => "Permission for {$action} on {$resource}",
                            ]
                        );
                    }

                    $grants[$roleName][$cacheKey] = $this->created[$cacheKey];
                }
            }
        }

        // givePermissionTo es idempotente en Spatie: solo adjunta los que faltan.
        foreach ($grants as $roleName => $permissions) {
            $roles[$roleName]->givePermissionTo(array_values($permissions));
        }
    }

    protected function normalizeRoles($data, string $guard): array
    {
        $defaults      = config("supports.permissions.defaults.{$guard}", []);
        $defaultRole   = $defaults['role'] ?? 'user';
        $defaultActions = $defaults['actions'] ?? [];

        if (is_null($data)) {
            return [$defaultRole => $defaultActions];
        }

        if (is_array($data)) {
            if ($this->isAssoc($data)) {
                return $data;
            }

            return [$defaultRole => $data];
        }

        return [];
    }

    protected function isAssoc(array $array): bool
    {
        if ([] === $array) {
            return false;
        }

        return array_keys($array) !== range(0, count($array) - 1);
    }
}
