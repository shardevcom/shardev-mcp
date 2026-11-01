<?php

namespace Shardevcom\Supports\Exceptions;

use RuntimeException;
use Throwable;

/**
 * Base class for errors whose message is written for the end user and is
 * therefore safe to return to the client.
 *
 * It is the only signal JsonResponse::fromThrowable() uses to decide what the
 * client sees: a UserFacingException is answered with its own message, status
 * and errors; anything else (TypeError, QueryException, transport failures...)
 * is logged and answered with a generic message, because its getMessage()
 * carries internals — SQL, file paths, provider hosts. INF-08.
 *
 * The message may be a translation key; JsonResponse translates it.
 */
class UserFacingException extends RuntimeException
{
    /**
     * @param array<string, mixed> $errors Machine-readable detail for the client (e.g. ['type' => 'invalid_code']).
     */
    public function __construct(
        string $message = 'messages.unexpected_error',
        int $status = 400,
        protected array $errors = [],
        ?Throwable $previous = null,
    ) {
        parent::__construct($message, $status, $previous);
    }

    /**
     * Message shown to the client (a text or a translation key). Subclasses
     * whose getMessage() is a machine code override this.
     */
    public function getUserMessage(): string
    {
        return $this->getMessage();
    }

    public function getStatusCode(): int
    {
        $status = $this->getCode();

        return $status >= 400 && $status <= 599 ? $status : 400;
    }

    /**
     * @return array<string, mixed>
     */
    public function getErrors(): array
    {
        return $this->errors;
    }
}
