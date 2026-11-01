<?php

namespace Shardevcom\Verification\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ResendVerificationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'recipient' => ['required', 'email'],
            'purpose' => ['required', 'string', 'max:120'],
            'channel' => ['sometimes', 'string', 'in:email'],
            'context' => ['sometimes', 'array'],
            'meta' => ['sometimes', 'array'],
        ];
    }
}
