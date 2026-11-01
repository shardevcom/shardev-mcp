<?php

/*
| Rutas de la API. Cada app del proyecto tiene su archivo en routes/api/<key>.php (prefijo
| /api/<key>, su guard y su throttle); este archivo solo los carga, no hay que editarlo al
| añadir una app.
*/

foreach (glob(__DIR__ . '/api/*.php') ?: [] as $file) {
    require $file;
}
