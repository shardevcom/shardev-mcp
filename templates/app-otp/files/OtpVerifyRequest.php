<?php

namespace App\Auth\Otp;

use Shardevcom\Supports\Requests\JsonRequest;

/** Canjea un código de la app `{{ app.key }}`. La app y el propósito no vienen del cliente. */
class {{ app.model }}OtpVerifyRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'email', 'max:255'],
            'code' => ['required', 'string', 'min:4', 'max:12'],
        ];
    }
}
