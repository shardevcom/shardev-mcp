<?php

namespace Shardevcom\Verification;

use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Shardevcom\Verification\Channels\EmailChannel;
use Shardevcom\Verification\Commands\PruneVerificationChallengesCommand;
use Shardevcom\Verification\Contracts\VerificationChannelInterface;

class VerificationServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/verification.php', 'verification');

        $this->app->bind(VerificationChannelInterface::class, EmailChannel::class);
    }

    public function boot(): void
    {
        $this->loadViewsFrom(__DIR__ . '/../resources/views', 'verification');
        $this->loadMigrationsFrom(__DIR__ . '/../database/migrations');

        $this->registerRoutes();
        $this->registerCommands();
        $this->registerPublishing();
    }

    protected function registerRoutes(): void
    {
        Route::group([
            'prefix' => 'api',
            'middleware' => ['api'],
        ], function () {
            $this->loadRoutesFrom(__DIR__ . '/../routes/api.php');
        });
    }

    protected function registerCommands(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([
                PruneVerificationChallengesCommand::class,
            ]);
        }
    }

    protected function registerPublishing(): void
    {
        if (!$this->app->runningInConsole()) {
            return;
        }

        $this->publishes([
            __DIR__ . '/../config/verification.php' => config_path('verification.php'),
        ], 'verification-config');

        $this->publishes([
            __DIR__ . '/../resources/views' => resource_path('views/vendor/verification'),
        ], 'verification-views');
    }
}
