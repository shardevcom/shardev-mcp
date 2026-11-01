<?php

return [


    /*
    |--------------------------------------------------------------------------
    | Rutas de los packages
    |--------------------------------------------------------------------------
    | Aquí puedes configurar las rutas donde se encuentran los packages
    */
    'packages' => [
        'directory' => env('PACKAGES_DIRECTORY', 'packages'),
        'vendor' => env('PACKAGES_VENDOR', 'shardevcom'),
    ],


    /*
    |--------------------------------------------------------------------------
    | Permisos
    |--------------------------------------------------------------------------
    | Aquí puedes configurar los permisos que se asignarán a los roles para gestionar las configuraciones
    */
    // Metadata del sistema de permisos — usada por PermissionSyncService.
    // Los recursos/roles/acciones del sistema viven en config/shardevcom.php.
    'permissions' => [
        'actions'  => ['view', 'list', 'create', 'update', 'remove', 'manage', 'import', 'export'],
        // Los guards y roles por defecto los define el proyecto (config/supports.php, una entrada por app).
        'guards'   => [],
        'defaults' => [],
    ],

    /*
    |--------------------------------------------------------------------------
    | Cache Configuration
    |--------------------------------------------------------------------------
    |
    | Aquí puedes configurar el comportamiento del caché para los repositorios
    |
    */
    'cache' => [
        'enabled' => env('REPOSITORY_CACHE_ENABLED', false),
        'driver' => env('REPOSITORY_CACHE_DRIVER', 'database'),
        'ttl' => env('REPOSITORY_CACHE_TTL', 300), // Tiempo de vida en segundos (1 hora)
        'prefix' => env('REPOSITORY_CACHE_PREFIX', 'repository:'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Filtros Globales
    |--------------------------------------------------------------------------
    |
    | Configuración de filtros que se aplicarán a todos los repositorios
    |
    */
    'filters' => [
        'force_filter' => env('REPOSITORY_FORCE_FILTER', false), // Si es true, requiere al menos un filtro
    ],

    /*
    |--------------------------------------------------------------------------
    | Campos por Defecto
    |--------------------------------------------------------------------------
    |
    | Configuración de campos permitidos por defecto
    |
    */
    'fields' => [
        'allowed_includes' => [],
        'allowed_fields' => [],
        'filterable_fields' => [],
        'sortable_fields' => [],
        'owner_columns' => [
            'owner_id',
            'owner_type',
            'accountable_id',
            'accountable_type'
        ]
    ],

    /*
    |------------------------------------------------------------------------------------
    | Exports Configuration
    |--------------------------------------------------------------------------
    */
    'exports' => [
        /*
        |--------------------------------------------------------------------------
        | Default Export Settings
        |--------------------------------------------------------------------------
        */
        'defaults' => [
            'format' => env('EXPORT_FORMAT', 'xlsx'),
            'disk' => env('EXPORT_DISK', 'local'),
        ],

        /*
        |--------------------------------------------------------------------------
        | Available Export Formats
        |--------------------------------------------------------------------------
        */
        'formats' => [
            'xlsx' => [
                'extension' => 'xlsx',
                'mime_type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'writer_type' => \Maatwebsite\Excel\Excel::XLSX,
            ],
            'xls' => [
                'extension' => 'xls',
                'mime_type' => 'application/vnd.ms-excel',
                'writer_type' => \Maatwebsite\Excel\Excel::XLS,
            ],
            'csv' => [
                'extension' => 'csv',
                'mime_type' => 'text/csv',
                'writer_type' => \Maatwebsite\Excel\Excel::CSV,
            ],
            'pdf' => [
                'extension' => 'pdf',
                'mime_type' => 'application/pdf',
                'writer_type' => \Maatwebsite\Excel\Excel::DOMPDF,
            ]
        ],

        /*
        |--------------------------------------------------------------------------
        | Filename Configuration
        |--------------------------------------------------------------------------
        */
        'filename' => [
            'prefix' => '',
            'suffix' => '_export',
            'date_format' => 'Ymd_His',
            'separator' => '_',
        ],
    ],

];
