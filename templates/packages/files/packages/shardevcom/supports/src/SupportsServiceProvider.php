<?php

namespace Shardevcom\Supports;

use Illuminate\Support\ServiceProvider;
use Shardevcom\Supports\Contracts\FileStorageInterface;
use Shardevcom\Supports\Contracts\HeaderCleanerInterface;
use Shardevcom\Supports\Contracts\HeaderSetterInterface;
use Shardevcom\Supports\Contracts\SecurityConfigInterface;
use Shardevcom\Supports\Services\FileStorageService;
use Shardevcom\Supports\Services\Security\HeaderCleaner;
use Shardevcom\Supports\Services\Security\HeaderSetter;
use Shardevcom\Supports\Services\Security\SecurityConfigService;

class SupportsServiceProvider extends ServiceProvider
{
    public function register()
    {
        $this->mergeConfigFrom(__DIR__.'/../config/supports.php', 'supports');
        $this->mergeConfigFrom(__DIR__.'/../config/security.php', 'security');

        $this->app->bind(SecurityConfigInterface::class, SecurityConfigService::class);
        $this->app->bind(HeaderSetterInterface::class, HeaderSetter::class);
        $this->app->bind(HeaderCleanerInterface::class, HeaderCleaner::class);
        $this->app->bind(FileStorageInterface::class, FileStorageService::class);
    }

    public function boot()
    {
        $this->publishes([
            __DIR__.'/../config/supports.php' => config_path('supports.php'),
        ], 'supports-config');
    }
}
