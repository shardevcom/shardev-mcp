<?php

/*
| Metadatos del sistema de permisos. Los guards de las apps y su rol por defecto se declaran
| aquí; la matriz recurso => rol => acciones vive en config/shardevcom.php.
*/

return [
    'permissions' => [
        'actions' => ['view', 'list', 'create', 'update', 'remove', 'manage', 'import', 'export'],
        'guards' => [
            // shardev:permission-guards
        ],
        'defaults' => [
            // shardev:permission-defaults
        ],
    ],
];
