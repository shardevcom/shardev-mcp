<?php

namespace Shardevcom\Authentications\Events;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class PasswordChanged
{
    use Dispatchable;
    use SerializesModels;

    public function __construct(
        /** Quien cambió su contraseña (cualquier modelo de las apps del proyecto). */
        public Authenticatable $account
    ) {}
}
