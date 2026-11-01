<?php

namespace Shardevcom\Authentications\Http\Requests;

use Illuminate\Validation\Rule;
use Shardevcom\Supports\Requests\JsonRequest;

class PermissionRequest extends JsonRequest
{
    public function authorize(): bool
    {
        // Solo exige sesión: el permiso real lo comprueba HasAuthorizable en el repositorio.
        return auth()->check();
    }

    public function rules(): array
    {
        $permissionId = $this->route('id') ?? $this->route('permission'); // útil para updates

        return [
            'name' => [
                'required',
                'string',
                'max:100',
                Rule::unique('permissions', 'name')
                    ->ignore($permissionId)
                    ->where(fn ($query) => $query->where('guard_name', $this->input('guard_name'))),
            ],
            'description' => ['nullable', 'string', 'max:255'],
            'group' => ['nullable', 'string', 'max:100'],
            'guard_name' => ['required', Rule::in(config('supports.permissions.guards', []))],
        ];
    }

    public function messages(): array
    {
        return [
            'name.required' => 'El nombre del permiso es obligatorio.',
            'name.unique' => 'Ya existe un permiso con ese nombre en este guard.',
            'guard_name.required' => 'El guard es obligatorio.',
            'guard_name.in' => 'El guard no es uno de los guards del proyecto.',
        ];
    }
}
