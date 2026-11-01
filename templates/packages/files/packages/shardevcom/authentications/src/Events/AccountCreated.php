<?php

namespace Shardevcom\Authentications\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Shardevcom\Authentications\Models\Account;

/**
 * Se dispara cuando se crea una cuenta de cualquier app. Otros paquetes reaccionan con un
 * listener (p. ej. crear un perfil o enviar una bienvenida) sin que este paquete los conozca.
 */
class AccountCreated
{
    use Dispatchable;
    use SerializesModels;

    public function __construct(public Account $account) {}
}
