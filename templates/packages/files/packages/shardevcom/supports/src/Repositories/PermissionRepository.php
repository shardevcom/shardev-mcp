<?php

namespace Shardevcom\Supports\Repositories;

use Shardevcom\Repositories\Repository;
use Shardevcom\Supports\Traits\HasAuthorizable;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class PermissionRepository extends Repository
{
    use HasAuthorizable;

    /**
     * Nombre del recurso para el endpoint REST.
     */
    protected string $resource = 'permissions';

    /**
     * Campos por los cuales se puede buscar (en filtros o query global).
     */
    protected array $searchableFields = [
        'name',
        'group',
        'guard_name',
        'description',
    ];

    /**
     * Campos disponibles para filtros precisos (?filter[field]=value).
     */
    protected array $filterableFields = [
        'id',
        'name',
        'group',
        'guard_name',
        'description',
        'created_at',
        'updated_at',
    ];

    /**
     * Campos que se pueden ordenar (?sort=field,-otherfield).
     */
    protected array $sortableFields = [
        'id',
        'name',
        'group',
        'guard_name',
        'created_at',
        'updated_at',
    ];

    /**
     * Relaciones que se pueden incluir usando ?include=permissions,users,...
     */
    protected array $allowedIncludes = [
        'roles'
    ];

    /**
     * Campos que se pueden seleccionar con ?fields=.
     */
    protected array $allowedFields = [
        'id',
        'name',
        'group',
        'guard_name',
        'roles',
        'description',
        'created_at',
        'updated_at',
    ];

    /**
     * Constructor del repositorio.
     */
    public function __construct(Permission $model)
    {
        parent::__construct($model);
    }


    /**
     * Sincroniza un permiso con un rol específico.
     * * @param string|int $permissionId
     * @param string $roleName
     * @param bool $enabled
     * @return Permission
     * @throws \Illuminate\Database\Eloquent\ModelNotFoundException
     */
    /**
     * Sincroniza un permiso con un rol específico, creándolo si no existe.
     * * @param string|int $permissionId  Puede ser un ID real o el string 'new'
     * @param array $data Contiene role, enabled, action, resource, name, guard_name
     * @return \Spatie\Permission\Models\Permission
     */
    public function updateRoleAssignment($permissionId, array $data)
    {
            $roleName = $data['role'];
            $enabled = (bool) $data['enabled'];
            $guardName = $data['guard_name'] ?? 'web';

            // 1. Obtener o Crear el permiso
            // Si el ID es 'new' o no se encuentra, usamos los datos del front para crearlo
            if ($permissionId === 'new' || !$permissionId) {
                $permission = $this->model->firstOrCreate(
                    [
                        'name' => $data['name'],
                        'guard_name' => $guardName
                    ],
                    [
                        'group' => $data['group'],
                        'description' => "Permiso generado automáticamente para " . $data['group'],
                    ]
                );
            } else {
                $permission = $this->model->findOrFail($permissionId);
            }

            // 2. Obtener el Rol (asegurando el mismo guard que el permiso)
            $role = Role::where('name', $roleName)
                ->where('guard_name', $permission->guard_name)
                ->firstOrFail();

            // 3. Sincronizar
            if ($enabled) {
                $role->givePermissionTo($permission);
            } else {
                $role->revokePermissionTo($permission);
            }

            // Limpiar caché de Spatie para que el cambio sea instantáneo
            app(PermissionRegistrar::class)->forgetCachedPermissions();

        return $permission;
    }
}
