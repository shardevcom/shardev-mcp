<?php

namespace Shardevcom\Authentications\Http\Requests;

use Illuminate\Validation\Rules\Password;
use Shardevcom\Supports\Requests\JsonRequest;

class ChangePasswordRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return auth()->check();
    }

    public function rules(): array
    {
        return [
            'current_password' => ['required', 'string', 'max:255'],
            'new_password' => ['required', 'string', 'max:255', Password::min(10)],
        ];
    }
}
