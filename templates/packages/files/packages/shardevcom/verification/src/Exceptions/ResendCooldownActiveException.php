<?php

namespace Shardevcom\Verification\Exceptions;

class ResendCooldownActiveException extends VerificationException
{
    public function __construct(string $message = 'messages.verification.resend_cooldown', int $code = 429)
    {
        parent::__construct($message, $code);
    }

    /**
     * La espera entre códigos responde 429, no el 422 del resto de errores de
     * verificación: es la espera real del login y de /api/verification/*. Las
     * SPAs no deciden por ese código (leen success y message), y el cambio de
     * correo de adm la sigue envolviendo en su 400.
     */
    public function getStatusCode(): int
    {
        return 429;
    }
}
