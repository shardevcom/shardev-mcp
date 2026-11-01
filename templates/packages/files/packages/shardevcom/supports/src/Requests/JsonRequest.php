<?php

namespace Shardevcom\Supports\Requests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Shardevcom\Supports\Responses\JsonResponse;

abstract class JsonRequest extends FormRequest
{
    protected function failedValidation(Validator $validator)
    {
        throw new HttpResponseException(JsonResponse::validationError($validator->errors()->toArray()));
    }
}
