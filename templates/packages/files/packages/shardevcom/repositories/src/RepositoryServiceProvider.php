<?php

namespace Shardevcom\Repositories;

use Illuminate\Support\ServiceProvider;
use Shardevcom\Repositories\Console\MakeRepositoryCommand;

class RepositoryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(
            __DIR__.'/../config/repositories.php', 'repositories'
        );

        $this->app->singleton('repositories', fn ($app) => new RepositoryManager($app));
        $this->app->alias('repositories', RepositoryManager::class);
    }

    public function boot(): void
    {
        $this->publishes([
            __DIR__.'/../config/repositories.php' => config_path('repositories.php'),
        ], 'repositories-config');

        if ($this->app->runningInConsole()) {
            $this->commands([
                MakeRepositoryCommand::class,
            ]);
        }
    }
}
