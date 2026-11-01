<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
| Invitaciones de la app `{{ app.key }}`. Con FK a `{{ app.table }}` para quien invita: si esa tabla se creó en una
| migración POSTERIOR a esta (app con user_type existing), la migración falla en voz alta y hay que reordenarla.
| `inviter_id` es null cuando la invitación la emitió el comando de consola (no hay cuenta que invite); si el
| invitador se borra, la invitación se conserva (nullOnDelete). Del token solo se guarda su sha256.
*/
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('{{ app.table }}_invitations', function (Blueprint $table) {
            $table->id();
            $table->string('email');
            $table->string('token_hash', 64)->unique();
            $table->foreignId('inviter_id')->nullable()->constrained('{{ app.table }}')->nullOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();

            $table->index('email');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('{{ app.table }}_invitations');
    }
};
