<?php

use Illuminate\Support\Facades\Route;

/*
| Rutas web. Cada app registra su vista SPA en routes/web/<key>.php; este archivo solo los carga.
*/

foreach (glob(__DIR__ . '/web/*.php') ?: [] as $file) {
    require $file;
}

Route::get('/', fn () => redirect('/{{ project.primary_app }}'));
