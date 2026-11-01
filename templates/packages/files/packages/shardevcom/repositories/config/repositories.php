<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Global Filters
    |--------------------------------------------------------------------------
    |
    | Default filtering behavior applied to all repositories.
    |
    */
    'filters' => [
        'force_filter' => env('REPOSITORY_FORCE_FILTER', false),
    ],

    /*
    |--------------------------------------------------------------------------
    | Default Fields
    |--------------------------------------------------------------------------
    |
    | Global field, include, sort and search allow-lists.
    |
    */
    'fields' => [
        'allowed_includes' => [],
        'allowed_fields' => [],
        'hidden_fields' => [],
        'filterable_fields' => [],
        'sortable_fields' => [],
        'searchable_fields' => [],
    ],
];
