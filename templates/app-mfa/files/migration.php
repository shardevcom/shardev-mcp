<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
| Segundo factor de la app `{{ app.key }}`. Con FK a `{{ app.table }}`: si esa tabla se creó en una migración
| POSTERIOR a esta (app con user_type existing), la migración falla en voz alta y hay que reordenarla; no se
| crea una versión sin FK, porque un id de cuenta reutilizado heredaría el factor (y el desafío) de otra cuenta.
| La cuenta no cambia: el opt-in por cuenta es una fila aquí, no una columna en `{{ app.table }}`.
*/
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('{{ app.table }}_mfa', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained('{{ app.table }}')->cascadeOnDelete();
            $table->text('secret'); // cifrado (cast encrypted)
            $table->timestamp('confirmed_at')->nullable(); // null = pendiente: no protege nada todavía
            $table->unsignedBigInteger('last_used_step')->nullable(); // último paso TOTP aceptado (anti-repetición)
            $table->text('recovery_codes')->nullable(); // JSON de hashes; se muestran una sola vez
            $table->timestamps();

            $table->unique('account_id');
        });

        Schema::create('{{ app.table }}_mfa_challenges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('account_id')->constrained('{{ app.table }}')->cascadeOnDelete();
            $table->string('token_hash', 64)->unique(); // sha256 del valor opaco que recibe el cliente
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamps();

            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('{{ app.table }}_mfa_challenges');
        Schema::dropIfExists('{{ app.table }}_mfa');
    }
};
