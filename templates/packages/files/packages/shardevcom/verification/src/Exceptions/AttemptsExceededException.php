<?php

namespace Shardevcom\Verification\Exceptions;

class AttemptsExceededException extends VerificationException
{
    public function __construct(string $message = 'messages.verification.attempts_exceeded', int $code = 429)
    {
        parent::__construct($message, $code);
    }
}
