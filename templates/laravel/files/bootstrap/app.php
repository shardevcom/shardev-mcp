<?php

use Illuminate\Auth\AuthenticationException;
use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use League\OAuth2\Server\Exception\OAuthServerException;
use Shardevcom\Supports\Exceptions\UserFacingException;
use Shardevcom\Supports\Middlewares\SecurityHeadersMiddleware;
use Shardevcom\Supports\Responses\JsonResponse;
use Spatie\Csp\AddCspHeaders;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        api: __DIR__ . '/../routes/api.php',
        commands: __DIR__ . '/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(append: [
            AddCspHeaders::class,
            SecurityHeadersMiddleware::class,
        ]);

        // Detrás de un balanceador, lista sus IPs/CIDR en TRUSTED_PROXIES (coma) o `*` si solo él
        // puede alcanzar la app. Sin valor no se confía en ningún proxy.
        $trusted = trim((string) env('TRUSTED_PROXIES', ''));
        if ($trusted !== '') {
            $middleware->trustProxies(at: $trusted === '*' ? '*' : array_map('trim', explode(',', $trusted)));
        }

        // Límite base de 60/min en cada ruta /api/* (limiter `api` en AppServiceProvider).
        $middleware->throttleApi();

        // Las peticiones no autenticadas reciben 401, no una redirección a un login inexistente.
        Authenticate::redirectUsing(fn (Request $request) => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->dontReport([
            OAuthServerException::class,
            UserFacingException::class,
        ]);

        // Todo error de /api/* sale con el mismo formato; solo los UserFacingException muestran su
        // mensaje, el resto devuelve un mensaje genérico (nunca SQL, rutas ni detalles internos).
        $exceptions->render(function (Throwable $e, Request $request) {
            if ($request->is('api/*')) {
                return JsonResponse::fromThrowable($e, report: false);
            }

            return null;
        });

        $exceptions->render(function (OAuthServerException|AuthenticationException $e, Request $request) {
            if ($request->expectsJson()) {
                return response()->json(['message' => 'Unauthenticated', 'status' => 401], 401);
            }

            return null;
        });
    })->create();
