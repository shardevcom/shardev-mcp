<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Vite;

/**
 * Cada app tiene su propio build y su propio hot file. Se declara en la ruta de la vista SPA:
 *
 *   ->middleware(ViteBuildDirectory::class . ':build-adm,adm')
 *
 * (directorio de build dentro de public/, y clave de la app: su hot file es public/hot-<clave>).
 */
class ViteBuildDirectory
{
    public function handle(Request $request, Closure $next, string $dir, string $app)
    {
        Vite::useHotFile(public_path("hot-{$app}"));
        Vite::useBuildDirectory($dir);

        return $next($request);
    }
}
