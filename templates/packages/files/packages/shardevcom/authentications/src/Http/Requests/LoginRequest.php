<?php

namespace Shardevcom\Authentications\Http\Requests;

use Shardevcom\Supports\Requests\JsonRequest;

class LoginRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ];
    }
}
