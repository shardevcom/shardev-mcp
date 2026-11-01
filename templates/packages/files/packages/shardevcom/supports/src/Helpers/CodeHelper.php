<?php

namespace Shardevcom\Supports\Helpers;

class CodeHelper
{
    /**
     * Genera un fingerprint corto,
     * estable y determinístico.
     */
    public static function fingerprint(
        string $value,
        int $length = 12,
    ): string {

        $normalized = self::normalize(
            $value
        );

        $key = self::getDecodedKey();

        // Hash seguro
        $hash = hash_hmac(
            'sha256',
            $normalized,
            $key,
            true
        );

        // Convertir a Base36
        $code = self::toBase36(
            $hash
        );

        return substr(
            $code,
            0,
            $length
        );
    }

    /**
     * El texto exactamente como lo ve fingerprint() antes del hash (minúsculas,
     * sin tildes, símbolos → espacio, espacios colapsados). Para quien necesite
     * comparar sobre la misma base sin el hash. No cambia el resultado de fingerprint().
     */
    public static function normalized(
        string $value,
    ): string {
        return self::normalize($value);
    }

    /**
     * Letras latinas con tilde u otros signos y su equivalente ASCII, en
     * minúscula (normalize() pasa todo a minúscula antes de aplicarla). Lo que
     * no esté aquí se trata como símbolo y se cambia por un espacio.
     */
    private const TRANSLITERATIONS = [
        'á' => 'a', 'à' => 'a', 'â' => 'a', 'ä' => 'a', 'ã' => 'a', 'å' => 'a',
        'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
        'í' => 'i', 'ì' => 'i', 'î' => 'i', 'ï' => 'i',
        'ó' => 'o', 'ò' => 'o', 'ô' => 'o', 'ö' => 'o', 'õ' => 'o', 'ø' => 'o',
        'ú' => 'u', 'ù' => 'u', 'û' => 'u', 'ü' => 'u',
        'ý' => 'y', 'ÿ' => 'y',
        'ñ' => 'n', 'ç' => 'c',
        'ß' => 'ss', 'æ' => 'ae', 'œ' => 'oe',
    ];

    /**
     * Normalización semántica.
     */
    private static function normalize(
        string $value,
    ): string {

        $value = mb_strtolower($value);

        // quitar tildes con una tabla fija: iconv('ASCII//TRANSLIT') depende de
        // la librería del sistema y en la imagen Alpine convertía "í" en "'i"
        // ("alquería" → "alquer ia"), duplicando marcas.
        $value = strtr($value, self::TRANSLITERATIONS);

        // quitar símbolos
        $value = preg_replace(
            '/[^a-z0-9\s]/',
            ' ',
            $value
        );

        // espacios múltiples
        $value = preg_replace(
            '/\s+/',
            ' ',
            trim($value)
        );

        // tokens
        $tokens = explode(' ', $value);

        $tokens = array_filter($tokens);
        // ordenar palabras
        // sort($tokens);

        return implode(' ', $tokens);
    }

    /**
     * Convierte binario a Base36 Uppercase.
     */
    private static function toBase36(
        string $binary,
    ): string {

        $chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        $hex = bin2hex($binary);

        $decimal = gmp_init(
            $hex,
            16
        );

        $result = '';

        while (
            gmp_cmp($decimal, 0) > 0
        ) {

            $rem = gmp_intval(
                gmp_mod($decimal, 36)
            );

            $result .= $chars[$rem];

            $decimal = gmp_div_q(
                $decimal,
                36
            );
        }

        return strrev($result);
    }

    /**
     * Obtiene APP_KEY decodificada.
     */
    private static function getDecodedKey(): string
    {
        $key = config('app.key');

        if (
            str_starts_with(
                $key,
                'base64:'
            )
        ) {

            return base64_decode(
                substr($key, 7)
            );
        }

        return $key;
    }
}
