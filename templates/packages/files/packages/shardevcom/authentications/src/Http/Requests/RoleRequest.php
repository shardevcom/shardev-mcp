<?php

namespace Shardevcom\Authentications\Http\Requests;

use Illuminate\Validation\Rule;
use Shardevcom\Supports\Requests\JsonRequest;

class RoleRequest extends JsonRequest
{
    /**
     * Determina si el usuario está autorizado para hacer esta solicitud.
     */
    public function authorize(): bool
    {
        // Solo exige sesión: el permiso real (`create:roles`, ...) lo comprueba HasAuthorizable en el repositorio.
        return auth()->check();
    }

    /**
     * Reglas de validación.
     */
    public function rules(): array
    {
        $roleId = $this->route('id') ?? $this->route('role'); // útil para la edición

        return [
            'name' => [
                'required',
                'string',
                'max:100',
                // El nombre debe ser único por guard
                Rule::unique('roles', 'name')
                    ->ignore($roleId)
                    ->where(fn ($query) => $query->where('guard_name', $this->input('guard_name'))),
            ],
            'guard_name' => ['required', 'string', Rule::in(config('supports.permissions.guards', []))],
            'permissions' => ['nullable', 'array'],
            'permissions.*' => ['integer', 'exists:permissions,id'],
            'description' => ['nullable', 'string', 'max:255'], // opcional si deseas agregar descripción al rol
        ];
    }

    /**
     * Mensajes personalizados (opcional).
     */
    public function messages(): array
    {
        return [
            'name.required' => 'El nombre del rol es obligatorio.',
            'name.unique' => 'Ya existe un rol con este nombre en este guard.',
            'guard_name.required' => 'Debe especificar el guard asociado.',
            'permissions.*.exists' => 'Alguno de los permisos seleccionados no existe.',
        ];
    }
}
