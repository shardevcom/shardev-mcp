<?php

namespace Shardevcom\Authentications\Imports;

use Illuminate\Validation\Rule;
use Maatwebsite\Excel\Concerns\SkipsEmptyRows;
use Maatwebsite\Excel\Concerns\ToModel;
use Maatwebsite\Excel\Concerns\WithHeadingRow;
use Maatwebsite\Excel\Concerns\WithValidation;
use Shardevcom\Supports\Models\Permission;

class PermissionImport implements ToModel, WithHeadingRow, WithValidation, SkipsEmptyRows
{
    public function model(array $row)
    {
        // El par (nombre, guard) es único: una fila repetida actualiza en vez de fallar.
        $permission = Permission::firstOrNew([
            'name' => $row['nombre'] ?? $row['name'] ?? null,
            'guard_name' => $row['guard'] ?? $row['guard_name'] ?? (config('supports.permissions.guards')[0] ?? null),
        ]);
        $permission->fill([
            'description' => $row['descripcion'] ?? $row['description'] ?? null,
            'group' => $row['grupo'] ?? $row['group'] ?? null,
        ]);

        return $permission;
    }

    /**
     * Validaciones de cada fila.
     */
    public function rules(): array
    {
        return [
            '*.name' => ['required', 'string', 'max:100'],
            '*.description' => ['nullable', 'string', 'max:255'],
            '*.group' => ['nullable', 'string', 'max:100'],
            '*.guard_name' => ['required', Rule::in(config('supports.permissions.guards', []))],
        ];
    }

    public function customValidationMessages()
    {
        return [
            '*.name.required' => 'El campo nombre es obligatorio.',
                        '*.guard_name.in' => 'El guard no es uno de los guards del proyecto.',
        ];
    }
}
