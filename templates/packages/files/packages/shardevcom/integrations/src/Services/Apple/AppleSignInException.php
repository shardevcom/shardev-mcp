<?php

namespace Shardevcom\Integrations\Services\Apple;

use RuntimeException;

/**
 * Fallo de Sign in with Apple.
 *
 * El mensaje es siempre un texto fijo y el `reason` un código corto: nunca se
 * incluye el id_token, el code, el nonce, el client_secret ni el mensaje de la
 * excepción original. Para diagnóstico solo se conserva la CLASE de la
 * excepción que lo causó (`causeClass`), no la excepción en sí.
 */
class AppleSignInException extends RuntimeException
{
    public const NOT_CONFIGURED = 'not_configured';

    public const INVALID_TOKEN = 'invalid_token';

    public const INVALID_STATE = 'invalid_state';

    public const CANCELLED = 'cancelled';

    public const EXCHANGE_FAILED = 'exchange_failed';

    public const JWKS_UNAVAILABLE = 'jwks_unavailable';

    public const REPLAYED = 'replayed';

    /** Usar las factorías estáticas (mensaje y reason controlados). */
    public function __construct(
        protected string $reason,
        protected ?string $causeClass = null,
        int $status = 0,
    ) {
        parent::__construct("Sign in with Apple failed: {$reason}", $status);
    }

    public static function notConfigured(): self
    {
        return new self(self::NOT_CONFIGURED);
    }

    public static function invalidToken(?string $causeClass = null): self
    {
        return new self(self::INVALID_TOKEN, $causeClass);
    }

    public static function invalidState(): self
    {
        return new self(self::INVALID_STATE);
    }

    public static function cancelled(): self
    {
        return new self(self::CANCELLED);
    }

    public static function exchangeFailed(int $status = 0, ?string $causeClass = null): self
    {
        return new self(self::EXCHANGE_FAILED, $causeClass, $status);
    }

    public static function jwksUnavailable(int $status = 0, ?string $causeClass = null): self
    {
        return new self(self::JWKS_UNAVAILABLE, $causeClass, $status);
    }

    public static function replayed(): self
    {
        return new self(self::REPLAYED);
    }

    public function reason(): string
    {
        return $this->reason;
    }

    public function causeClass(): ?string
    {
        return $this->causeClass;
    }

    /** Apple no está configurado o no responde: el fallo no es del usuario. */
    public function isUnavailable(): bool
    {
        return in_array($this->reason, [self::NOT_CONFIGURED, self::JWKS_UNAVAILABLE], true);
    }

    /**
     * Contexto seguro para logs: código, clase de la causa y status HTTP de
     * Apple. Nada de tokens ni de mensajes de excepción.
     *
     * @return array<string, mixed>
     */
    public function logContext(): array
    {
        return array_filter([
            'reason' => $this->reason,
            'cause' => $this->causeClass,
            'status' => $this->getCode() ?: null,
        ], fn ($value) => $value !== null);
    }
}
