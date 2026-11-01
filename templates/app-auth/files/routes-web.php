<?php

use App\Http\Middleware\ViteBuildDirectory;
use Illuminate\Support\Facades\Route;

// Vista SPA de la app `{{ app.key }}` (build `{{ app.build_dir }}`, hot file public/hot-{{ app.key }}).
Route::view('{{ app.key }}/{path?}', '{{ app.key }}')
    ->where('path', '.*')
    ->middleware(ViteBuildDirectory::class . ':{{ app.build_dir }},{{ app.key }}')
    ->name('spa.{{ app.key }}');
