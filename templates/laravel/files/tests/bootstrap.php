<?php

/*
| Arranque de PHPUnit: crea, en cada ejecución, una APP_KEY y un par de llaves OAuth aleatorios
| (en memoria, por variable de entorno). Sin secretos en phpunit.xml ni archivos de llaves.
*/

require __DIR__ . '/../vendor/autoload.php';

$set = static function (string $name, string $value): void {
    putenv("{$name}={$value}");
    $_ENV[$name] = $value;
    $_SERVER[$name] = $value;
};

$set('APP_KEY', 'base64:' . base64_encode(random_bytes(32)));

$key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
openssl_pkey_export($key, $private);
$set('PASSPORT_PRIVATE_KEY', $private);
$set('PASSPORT_PUBLIC_KEY', openssl_pkey_get_details($key)['key']);
