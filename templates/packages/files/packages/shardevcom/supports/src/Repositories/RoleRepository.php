<?php

namespace Shardevcom\Supports\Repositories;

use Shardevcom\Repositories\Repository;
use Shardevcom\Supports\Traits\HasAuthorizable;
use Spatie\Permission\Models\Role;

class RoleRepository extends Repository
{

    use HasAuthorizable;
    /**
     * Nombre del recurso para el endpoint REST.
     */
    protected string $resource = 'roles';

    /**
     * Campos por los cuales se puede buscar (en filtros o query global).
     */
    protected array $searchableFields = [
        'name',
        'guard_name',
        'description',
    ];

    /**
     * Campos disponibles para filtros precisos (?filter[field]=value).
     */
    protected array $filterableFields = [
        'id',
        'name',
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
        'guard_name',
        'created_at',
        'updated_at',
    ];

    /**
     * Relaciones que se pueden incluir usando ?include=permissions,users,...
     */
    protected array $allowedIncludes = [
        'permissions',
        // 'users', // si deseas incluir usuarios asociados al rol
    ];

    /**
     * Campos que se pueden seleccionar con ?fields=.
     */
    protected array $allowedFields = [
        'id',
        'name',
        'guard_name',
        'description',
        'created_at',
        'updated_at',
    ];

    /**
     * Constructor del repositorio.
     */
    public function __construct(Role $model)
    {
        parent::__construct($model);
    }

    /**
     * Busca un rol por nombre o lo crea si no existe.
     * Requerido por RoleImport::processNormalizedRow().
     */
    public function findOrCreateByName(?string $name): ?Role
    {
        if (empty($name)) {
            return null;
        }

        return $this->model->firstOrCreate(
            ['name' => $name],
            ['guard_name' => 'web']
        );
    }
}
