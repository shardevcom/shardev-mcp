<?php

namespace Shardevcom\Authentications\Http\Requests;

use Shardevcom\Supports\Requests\JsonRequest;

/**
 * Solo campos del perfil propio. Nunca roles, active, email ni columnas de propiedad.
 */
class UpdateProfileRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return auth()->check();
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
        ];
    }
}
