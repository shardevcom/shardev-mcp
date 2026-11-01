<?php

namespace Shardevcom\Authentications;

use Illuminate\Support\ServiceProvider;
use Laravel\Passport\Passport;
use Shardevcom\Authentications\Commands\CreateAccount;
use Shardevcom\Authentications\Commands\SetupAuth;

class AuthenticationsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/authentications.php', 'authentications');
    }

    public function boot(): void
    {
        $this->configurePassport();

        if ($this->app->runningInConsole()) {
            $this->commands([SetupAuth::class, CreateAccount::class]);

            $this->publishes([
                __DIR__ . '/../config/authentications.php' => config_path('authentications.php'),
            ], 'authentications-config');
        }
    }

    /** Vida de los tokens explícita (Passport usa un año por defecto). */
    protected function configurePassport(): void
    {
        $t = config('authentications.tokens');

        Passport::tokensExpireIn(now()->addHours($t['access_hours']));
        Passport::refreshTokensExpireIn(now()->addDays($t['refresh_days']));
        Passport::personalAccessTokensExpireIn(now()->addMonths($t['personal_months']));
    }
}
