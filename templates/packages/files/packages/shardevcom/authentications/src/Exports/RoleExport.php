<?php

namespace Shardevcom\Authentications\Exports;

use Illuminate\Support\Collection;
use Shardevcom\Supports\Exports\BaseExport;

class RoleExport extends BaseExport
{
    protected array $customHeadings = [
        'ID',
        'Nombre',
        'Guard Name',
        'Descripción',
        'Permisos',
        'Fecha de creación',
        'Última actualización',
    ];

    public function map($row): array
    {
        return [
            data_get($row, 'id'),
            data_get($row, 'name'),
            data_get($row, 'guard_name'),
            data_get($row, 'description'),
            // Permissions es una colección — unir nombres con coma
            data_get($row, 'permissions') instanceof Collection
                ? data_get($row, 'permissions')->pluck('name')->implode(', ')
                : (is_array(data_get($row, 'permissions'))
                    ? collect(data_get($row, 'permissions'))->pluck('name')->implode(', ')
                    : ''),
            data_get($row, 'created_at') instanceof \DateTimeInterface
                ? data_get($row, 'created_at')->format('Y-m-d H:i:s')
                : (data_get($row, 'created_at') ?? ''),
            data_get($row, 'updated_at') instanceof \DateTimeInterface
                ? data_get($row, 'updated_at')->format('Y-m-d H:i:s')
                : (data_get($row, 'updated_at') ?? ''),
        ];
    }
}
