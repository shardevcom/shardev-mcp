<?php

namespace Shardevcom\Authentications\Imports;

use Shardevcom\Supports\Imports\BaseImport;
use Shardevcom\Supports\Repositories\RoleRepository;

class RoleImport extends BaseImport
{
    protected ?string $normalizeKey = 'name';

    public function __construct(RoleRepository $repository)
    {
        parent::__construct($repository);
    }

    public function getTemplateHeaders(): array
    {
        return ['name', 'guard_name', 'permisos'];
    }

    public function getExampleRow(): ?array
    {
        return [
            'name'       => 'operador',
            'guard_name' => config('supports.permissions.guards')[0] ?? 'web',
            'permisos'   => 'view:roles,list:roles',
        ];
    }

    protected function customTransformations(): array
    {
        return [
            'guard_name' => fn ($value) => trim((string) $value) ?: (config('supports.permissions.guards')[0] ?? 'web'),
            // La columna 'permisos' viene como CSV: "list:roles,view:roles,..."
            'permisos' => fn ($value) => !empty($value)
                ? array_map('trim', explode(',', (string) $value))
                : [],
        ];
    }

    /**
     * Roles: busca por nombre y asigna permisos si vienen en la fila.
     */
    protected function processNormalizedRow(array $normalizedRow, int $rowNumber = 0): void
    {
        $permissions = $normalizedRow['permisos'] ?? [];
        unset($normalizedRow['permisos']);

        $entity = null;

        if (!empty($normalizedRow['id'])) {
            $entity = $this->repository->find($normalizedRow['id']);
        }

        if (!$entity && !empty($normalizedRow['name'])) {
            $entity = $this->repository->findOrCreateByName($normalizedRow['name']);
        }

        if ($entity && $entity->exists) {
            $entity->update($normalizedRow);
        } else {
            $entity = $this->repository->insert($normalizedRow);
        }

        if ($entity && !empty($permissions)) {
            $entity->syncPermissions($permissions);
        }
    }
}
