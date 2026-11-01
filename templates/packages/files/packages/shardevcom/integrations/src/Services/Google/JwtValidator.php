<?php

namespace Shardevcom\Integrations\Services\Google;

use Exception;
use Illuminate\Support\Facades\Log;
use Shardevcom\Supports\Helpers\LogSanitizer;

class JwtValidator
{
    public function __construct(
        private GoogleSecurityTokenValidator $tokenValidator
    ) {
    }

    public function validateAndDecode(string $jwt): array
    {
        try {
            $decoded = $this->tokenValidator->validateSecurityEventToken($jwt);

            // (array) $decoded solo castea el nivel superior — los claims
            // anidados (ej. "events") quedan como stdClass, y el resto del
            // pipeline hace acceso tipo array ($eventData['sub']) sobre ellos.
            // El round-trip por JSON castea recursivamente.
            return json_decode(json_encode($decoded), true);

        } catch (Exception $e) {
            Log::error('JWT validation failed: ' . LogSanitizer::sanitize($e->getMessage()));
            throw new Exception('Invalid JWT: ' . $e->getMessage(), 400);
        }
    }
}
