<?php

namespace App\Auth\Mfa;

use Shardevcom\Supports\Requests\JsonRequest;

/** Canjea un desafío de la app `{{ app.key }}` por un token. La app no viene del cliente. */
class {{ app.model }}MfaVerifyRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'challenge' => ['required', 'string', 'min:32', 'max:128'],
            'code' => ['required', 'string', 'max:32'],
        ];
    }
}
