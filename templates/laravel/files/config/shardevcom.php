<?php

/*
| Fuente única de roles y permisos del proyecto (los aplica `php artisan db:seed`).
|
|   roles:       guard => [roles]
|   permissions: guard => recurso => rol => [acciones]
|
| Los permisos se guardan como "<acción>:<recurso>" (p. ej. "list:roles"). `manage` concede todas
| las acciones del recurso. El backend comprueba estos permisos en cada petición; ocultar algo en
| el frontend nunca es autorización.
*/

return [

    'roles' => [
        // shardev:roles
    ],

    'permissions' => [
        // shardev:permissions
    ],

];
