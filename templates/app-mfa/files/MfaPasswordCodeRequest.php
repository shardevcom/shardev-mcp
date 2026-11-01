<?php

namespace App\Auth\Mfa;

use Shardevcom\Supports\Requests\JsonRequest;

/** Operaciones sensibles: exigen la contraseña actual Y un código válido. */
class {{ app.model }}MfaPasswordCodeRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'password' => ['required', 'string', 'max:255'],
            'code' => ['required', 'string', 'max:32'],
        ];
    }
}
