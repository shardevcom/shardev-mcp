<?php

namespace Database\Factories;

use {{ app.model_class }};
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/** @extends Factory<{{ app.model }}> */
class {{ app.model }}Factory extends Factory
{
    protected $model = {{ app.model }}::class;

    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            // Contraseña de pruebas conocida; el hash se calcula una vez por proceso.
            'password' => static::$password ??= Hash::make('password-for-tests'),
            'active' => true,
            'remember_token' => str()->random(10),
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn () => ['active' => false]);
    }

    protected static ?string $password = null;
}
