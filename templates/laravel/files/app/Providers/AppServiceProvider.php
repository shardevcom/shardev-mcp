<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Shardevcom\Authentications\Support\AppRegistry;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Límite base de toda ruta /api/*: por usuario autenticado o, si no, por IP.
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->getAuthIdentifier() ?: $request->ip());
        });

        // Login: por (email + IP). Sin email en la petición, solo por IP.
        RateLimiter::for('auth-login', function (Request $request) {
            $email = mb_strtolower(trim((string) $request->input('email')));
            $perMinute = (int) config('authentications.login_attempts_per_minute', 6);

            return $email !== ''
                ? Limit::perMinute($perMinute)->by($email . '|' . $request->ip())
                : Limit::perMinute(15)->by('no-email|' . $request->ip());
        });

        // Alias de morph de los modelos de cuenta de cada app (owner_type, notificaciones...).
        Relation::morphMap(collect(AppRegistry::all())
            ->mapWithKeys(fn (array $app) => [class_basename($app['model']) => $app['model']])
            ->all());
    }
}
