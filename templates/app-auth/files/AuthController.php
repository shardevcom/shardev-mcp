<?php

namespace App\Http\Controllers;

use Shardevcom\Authentications\Http\Controllers\AccountAuthController;

/** Login, logout y perfil de la app `{{ app.key }}` (guard `{{ app.api_guard }}`). */
class {{ app.model }}AuthController extends AccountAuthController
{
    protected string $app = '{{ app.key }}';
}
