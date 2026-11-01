<?php

namespace Tests\Unit;

use Tests\TestCase;

/** Cada app declarada en config/authentications.php debe tener su par de guards y su provider en config/auth.php. */
class AppsConfigTest extends TestCase
{
    public function test_cada_app_tiene_guard_bearer_guard_de_sesion_y_provider_propios(): void
    {
        $apps = config('authentications.apps');
        $this->assertNotEmpty($apps);

        foreach ($apps as $key => $app) {
            $this->assertSame('passport', config("auth.guards.{$app['guard']}.driver"), "guard Bearer de {$key}");
            $this->assertSame('session', config("auth.guards.{$app['session_guard']}.driver"), "guard de sesión de {$key}");
            $this->assertSame($app['provider'], config("auth.guards.{$app['guard']}.provider"));
            $this->assertSame($app['provider'], config("auth.guards.{$app['session_guard']}.provider"));
            $this->assertSame($app['model'], config("auth.providers.{$app['provider']}.model"));
            $this->assertContains($app['guard'], config('supports.permissions.guards'));
        }
    }

    public function test_los_guards_y_providers_no_se_comparten_entre_apps(): void
    {
        $apps = config('authentications.apps');

        foreach (['guard', 'session_guard', 'provider', 'model'] as $field) {
            $values = array_column($apps, $field);
            $this->assertSame(count($values), count(array_unique($values)), "{$field} duplicado entre apps");
        }
    }
}
