# Pruebas

- PHPUnit (`php artisan test`). Tests de feature para rutas+middleware; unitarios para lógica aislada.
- Todo cambio de autorización o seguridad prueba el caso permitido y el rechazado (403/401, no un vacío silencioso). Para propiedad por fila: dos cuentas distintas y el acceso cruzado debe fallar.
- Los tests de `tests/Feature` recorren todas las apps de `config/authentications.php`: al añadir una app se prueban solos.
- `tests/bootstrap.php` genera `APP_KEY` y llaves OAuth aleatorias por ejecución; no pongas secretos en `phpunit.xml`.
- No borres ni saltes un test para que pase; si es inevitable, dilo explícitamente.
- Frontend: no hay herramientas de test; `pnpm run types` y `pnpm run build` son la comprobación mínima.
