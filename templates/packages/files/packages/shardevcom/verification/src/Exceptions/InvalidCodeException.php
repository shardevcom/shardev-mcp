<?php

namespace Shardevcom\Verification\Exceptions;

class InvalidCodeException extends VerificationException
{
    public function __construct(string $message = 'messages.verification.invalid_code', int $code = 422)
    {
        parent::__construct($message, $code);
    }
}
