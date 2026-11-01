<?php

namespace Shardevcom\Supports\Middlewares;

use Closure;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;

class SecureDeviceMiddleware
{

    public function handle($request, Closure $next)
    {
        // Generar un token único
        $sessionId = $request->session()->getId();
        $randomKey = Str::random(40);
        $dynamicToken = Crypt::encryptString($sessionId . '|' . $randomKey);

        // Adjuntar el token a las variables compartidas
        view()->share('deviceToken', $dynamicToken);

        return $next($request);
    }

}
