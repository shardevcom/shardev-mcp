<?php

namespace App\Auth\Mfa;

use Illuminate\Database\Eloquent\Model;

/**
 * Segundo factor (TOTP) de UNA cuenta de la app `{{ app.key }}`. Tabla propia de la app: el factor de una
 * cuenta de otra app es otra fila en otra tabla. `account_id` NO es asignable en masa: lo fija el servicio.
 * El secreto se guarda cifrado (cast `encrypted`, APP_KEY) y nunca se serializa.
 */
class {{ app.model }}Mfa extends Model
{
    protected $table = '{{ app.table }}_mfa';

    protected $fillable = ['secret', 'confirmed_at', 'last_used_step', 'recovery_codes'];

    protected $hidden = ['secret', 'recovery_codes', 'last_used_step'];

    protected function casts(): array
    {
        return [
            'secret' => 'encrypted',
            'recovery_codes' => 'array',
            'confirmed_at' => 'datetime',
            'last_used_step' => 'integer',
        ];
    }
}
