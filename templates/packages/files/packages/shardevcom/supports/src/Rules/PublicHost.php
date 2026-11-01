<?php

namespace Shardevcom\Supports\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Shardevcom\Supports\Security\PublicHostGuard;

/** Regla de validación: el host debe resolver solo a direcciones públicas. */
class PublicHost implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! PublicHostGuard::isPublic($value)) {
            $fail('El servidor indicado no es un destino público permitido.');
        }
    }
}
