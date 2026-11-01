<?php

namespace App\Models;

use {{ app.factory_class }};
use Shardevcom\Authentications\Models\Account;

/**
 * Cuenta de la app `{{ app.key }}`. `$guard_name` es el guard Bearer: Spatie guarda y
 * busca los roles/permisos de esta cuenta con ese guard.
 */
class {{ app.model }} extends Account
{
    protected $table = '{{ app.table }}';

    protected $guard_name = '{{ app.api_guard }}';

    protected static function newFactory(): {{ app.model }}Factory
    {
        return {{ app.model }}Factory::new();
    }
}
