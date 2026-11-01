<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
| Identidades sociales de la app `{{ app.key }}`. Con FK a `{{ app.table }}`: si esa tabla se creó en una
| migración POSTERIOR a esta (app con user_type existing), la migración falla en voz alta y hay que
| reordenarla; no se crea una versión sin FK, porque un id de cuenta reutilizado heredaría la identidad.
*/
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('{{ app.table }}_social_identities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained('{{ app.table }}')->cascadeOnDelete();
            $table->string('provider', 20);
            $table->string('subject', 255);
            $table->string('email')->nullable();
            $table->boolean('email_verified')->default(false);
            $table->timestamps();

            // Una identidad del proveedor pertenece a una sola cuenta, y una cuenta tiene una por proveedor.
            $table->unique(['provider', 'subject']);
            $table->unique(['account_id', 'provider']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('{{ app.table }}_social_identities');
    }
};
