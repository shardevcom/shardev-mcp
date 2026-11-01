<?php

namespace App\Auth\Otp;

use Shardevcom\Supports\Requests\JsonRequest;

/** Pide un código para la app `{{ app.key }}`. Solo se lee el correo. */
class {{ app.model }}OtpCodeRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'email', 'max:255'],
        ];
    }
}
