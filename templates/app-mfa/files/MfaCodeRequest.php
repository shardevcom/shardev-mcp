<?php

namespace App\Auth\Mfa;

use Shardevcom\Supports\Requests\JsonRequest;

/** Código TOTP para confirmar el alta del segundo factor. */
class {{ app.model }}MfaCodeRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:32'],
        ];
    }
}
