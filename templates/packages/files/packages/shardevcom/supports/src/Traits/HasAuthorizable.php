<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Shardevcom\Supports\Helpers\AuthHelper;

trait HasAuthorizable
{
    /**
     * Determina si debe ignorar filtros/autorización.
     *
     * IMPORTANTE:
     * NO cachear esto porque depende del contexto actual:
     * - usuario autenticado
     * - request
     * - tests
     * - guard
     * - consola
     */
    protected function isCli(): bool
    {
        return !AuthHelper::shouldFilter();
    }

    /**
     * Obtiene el usuario autenticado actual.
     */
    protected function user()
    {
        return AuthHelper::user();
    }

    /**
     * Verifica si el usuario puede administrar el recurso.
     */
    protected function canManage(): bool
    {
        return $this->checkPermission('manage');
    }

    /**
     * Verifica permiso de acción.
     */
    protected function can(string $action): bool
    {
        return $this->checkPermission($action);
    }

    /**
     * Acciones sujetas a filtros.
     */
    public function getFilterActions(): array
    {
        return property_exists($this, 'filterActions')
            ? $this->filterActions
            : ['view', 'list', 'create', 'update', 'remove', 'import', 'export'];
    }

    /**
     * Nombre del recurso.
     */
    public function getResource(): string
    {
        if (property_exists($this, 'resource')) {
            return $this->resource;
        }

        if (
            property_exists($this, 'model')
            && method_exists($this->model, 'getTable')
        ) {
            return $this->model->getTable();
        }

        throw new \RuntimeException(
            "Defina 'protected \$resource' en el repositorio."
        );
    }

    /**
     * Obtiene instancia del modelo.
     */
    protected function getModelInstance(): Model
    {
        if ($this->model instanceof Model) {
            return $this->model;
        }

        if (
            is_string($this->model)
            && class_exists($this->model)
        ) {
            return new $this->model;
        }

        throw new \RuntimeException(
            sprintf(
                'El modelo definido en %s no es válido.',
                static::class
            )
        );
    }

    /**
     * Verifica permisos del usuario sobre el recurso propio del repositorio.
     */
    public function checkPermission(string|array $actions): bool
    {
        return $this->checkPermissionFor($actions, $this->getResource());
    }

    /**
     * Verifica permisos del usuario sobre un recurso externo (puede diferir del
     * recurso propio del repositorio).
     *
     * @param string|array $actions Una o varias acciones a verificar (OR lógico).
     * @param string $resource Nombre del recurso a evaluar.
     */
    public function checkPermissionFor(string|array $actions, string $resource): bool
    {
        $user = AuthHelper::user();
        if (!$user) {
            return false;
        }

        $actions = is_array($actions) ? $actions : [$actions];
        $permVariants = [];

        foreach ($actions as $action) {
            $permVariants[] = "$action-$resource";
            $permVariants[] = "$action:$resource";
            $permVariants[] = "$action $resource";
        }

        return method_exists($user, 'hasAnyPermission') && $user->hasAnyPermission($permVariants);
    }

    /**
     * Verifica que el usuario autenticado tenga permiso para importar un recurso.
     */
    public function authorizeImport(?string $resourceType = null): void
    {
        if ($this->isCli()) {
            return;
        }

        $user = AuthHelper::user();

        if (!$user) {
            abort(403, 'No autenticado.');
        }

        $targetResource = $resourceType ?? $this->getResource();

        if (!$this->checkPermissionFor(['import', 'manage'], $targetResource)) {
            abort(
                403,
                "No tienes permiso para importar el recurso '{$targetResource}'."
            );
        }
    }

    /**
     * Verifica que el usuario autenticado tenga permiso para exportar un recurso.
     */
    public function authorizeExport(?string $resourceType = null): void
    {
        if ($this->isCli()) {
            return;
        }

        $user = AuthHelper::user();

        if (!$user) {
            abort(403, 'No autenticado.');
        }

        $targetResource = $resourceType ?? $this->getResource();

        if (!$this->checkPermissionFor(['export', 'manage'], $targetResource)) {
            abort(
                403,
                "No tienes permiso para exportar el recurso '{$targetResource}'."
            );
        }
    }

    /**
     * Elimina columnas protegidas de ownership del payload.
     */
    protected function stripOwnershipColumns(array $data): array
    {
        $model = $this->getModelInstance();
        $protectedColumns = AuthHelper::ownerColumns();

        if (method_exists($model, 'getOwnerKeyName')) {
            $ownerKey = $model->getOwnerKeyName();
            if ($ownerKey) {
                $protectedColumns[] = $ownerKey;
            }
        }

        if (method_exists($model, 'getOwnerTypeName')) {
            $protectedColumns[] = $model->getOwnerTypeName();
        }

        $protectedColumns = array_values(array_unique(array_filter($protectedColumns)));

        return array_diff_key($data, array_flip($protectedColumns));
    }

    /**
     * Aplica autorización al listado / consulta.
     */
    public function applyOnFilter(Builder &$query): void
    {
        if ($this->isCli()) {
            return;
        }

        $filterActions = $this->getFilterActions();

        // Si el recurso no requiere permisos de consulta/vista, omitir
        if (!in_array('view', $filterActions) && !in_array('list',$filterActions)) {
            return;
        }

        if (!$this->checkPermission(['view', 'list', 'manage'])) {
            abort(
                403,
                'No tienes permiso para acceder a este recurso.'
            );
        }
    }

    /**
     * Reglas antes de insertar.
     */
    public function applyOnInsert(array $data): array
    {
        if ($this->isCli()) {
            return $data;
        }

        if (!$this->can('create') && !$this->canManage()) {
            abort(
                403,
                'No tienes permiso para crear este recurso.'
            );
        }

        if (!$this->canManage() && !$this->canAssignOwnerOnCreate()) {
            $data = $this->stripOwnershipColumns($data);
        }

        return $data;
    }

    /**
     * Roles que pueden asignar el propietario al crear sin tener `manage`.
     */
    protected function canAssignOwnerOnCreate(): bool
    {
        if (!property_exists($this, 'ownerAssignableRoles') || empty($this->ownerAssignableRoles)) {
            return false;
        }

        $user = $this->user();

        return $user
            && method_exists($user, 'hasAnyRole')
            && $user->hasAnyRole($this->ownerAssignableRoles);
    }

    /**
     * Reglas antes de actualizar.
     */
    public function applyOnUpdate(array $data, $model): array
    {
        if ($this->isCli()) {
            return $data;
        }

        if (!$this->can('update') && !$this->canManage()) {
            abort(
                403,
                'No tienes permiso para editar este recurso.'
            );
        }

        if (!$this->canManage()) {
            $user = $this->user();

            if (
                method_exists($model, 'isOwnedBy')
                && $user
                && !$model->isOwnedBy($user)
            ) {
                abort(
                    403,
                    'No tienes permiso para editar este registro.'
                );
            }

            $data = $this->stripOwnershipColumns($data);
        }

        return $data;
    }

    /**
     * Reglas antes de upsert masivo.
     */
    public function applyOnUpsert(array $rows): array
    {
        if ($this->isCli()) {
            return $rows;
        }

        if (!$this->can('create') && !$this->can('update') && !$this->canManage()) {
            abort(
                403,
                'No tienes permiso para realizar actualizaciones masivas.'
            );
        }

        if ($this->canManage()) {
            return $rows;
        }

        $user = $this->user();
        $model = $this->getModelInstance();

        $ownerData = method_exists($model, 'resolveOwnerData') && $user
            ? $model->resolveOwnerData($user)
            : null;

        foreach ($rows as &$row) {
            $row = $this->stripOwnershipColumns((array)$row);

            // Dado que upsert() en Eloquent se salta los eventos del modelo,
            // aseguramos la inyección del owner_id para usuarios sin 'manage'
            if ($ownerData && !empty($ownerData['id']) && method_exists($model, 'getOwnerKeyName')) {
                $ownerKey = $model->getOwnerKeyName();
                if ($ownerKey && $ownerKey !== $model->getKeyName()) {
                    $row[$ownerKey] = $ownerData['id'];

                    if (method_exists($model, 'isPolymorphic') && $model->isPolymorphic()) {
                        $row[$model->getOwnerTypeName()] = $ownerData['type'];
                    }
                }
            }
        }

        return $rows;
    }

    /**
     * Reglas antes de eliminar.
     */
    public function applyOnDelete(bool $canDelete, Model $model): bool
    {
        if ($this->isCli()) {
            return true;
        }

        if ($this->canManage()) {
            return true;
        }

        if (!$this->can('remove')) {
            return false;
        }

        if (method_exists($model, 'isOwnedBy')) {
            return $model->isOwnedBy($this->user());
        }

        return false;
    }
}
