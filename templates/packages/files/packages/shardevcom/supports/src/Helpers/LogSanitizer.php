<?php

namespace Shardevcom\Supports\Helpers;

use Throwable;

/**
 * Contexto de log seguro para excepciones.
 *
 * Los mensajes de excepción de OAuth/Socialite, JWT, Guzzle o Passport pueden traer
 * tokens, códigos de autorización, JWT, cabeceras Authorization, contraseñas o
 * emails. Nunca se loguea el mensaje crudo: solo la clase de la excepción y un
 * mensaje enmascarado y truncado.
 */
final class LogSanitizer
{
    private const MAX_LENGTH = 300;

    /** @return array{exception: class-string, message: string} */
    public static function exception(Throwable $e): array
    {
        return [
            'exception' => get_class($e),
            'message' => self::sanitize($e->getMessage()),
        ];
    }

    public static function sanitize(string $message): string
    {
        $patterns = [
            // JWT (header.payload.signature)
            '/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/' => '[jwt]',
            // Authorization: Bearer xxx / Basic xxx
            '/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/i' => '$1 [redacted]',
            // clave=valor / "clave":"valor" de secretos
            '/("?(?:access_token|refresh_token|id_token|client_secret|code|code_verifier|password|passwd|secret|token|authorization|api_key|apikey)"?\s*[:=]\s*)"?[^"&\s,}]+"?/i' => '$1[redacted]',
            // emails
            '/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i' => '[email]',
            // cadenas opacas largas (tokens, claves)
            '/\b[A-Za-z0-9_\-]{40,}\b/' => '[opaque]',
            // números largos (documentos, cuentas, tarjetas)
            '/\d{6,}/' => '[number]',
        ];

        $clean = preg_replace(array_keys($patterns), array_values($patterns), $message) ?? '';

        return mb_strimwidth($clean, 0, self::MAX_LENGTH, '…');
    }
}
