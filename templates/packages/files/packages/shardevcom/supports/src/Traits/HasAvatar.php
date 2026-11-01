<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Support\Facades\Storage;

trait HasAvatar
{
    /** Disco donde se guardaban los avatares antes de `filesystems.avatars_disk`. */
    private static string $legacyAvatarDisk = 'public';

    /**
     * Accessor de Laravel para obtener la URL pública del avatar.
     * Uso en Blade / API: $user->avatar_public_url
     */
    public function getAvatarPublicUrlAttribute(): string
    {
        $column = $this->getAvatarColumnName();
        $avatar = $this->{$column};

        if (empty($avatar)) {
            return $this->getFallbackAvatarUrl();
        }

        if ($this->isExternalAvatarUrl($avatar)) {
            return $this->optimizeExternalAvatarUrl($avatar);
        }

        $disk = $this->getAvatarDisk();

        // Avatares subidos antes de mover el disco (siguen en el disco local).
        if ($disk !== self::$legacyAvatarDisk && Storage::disk(self::$legacyAvatarDisk)->exists($avatar)) {
            return Storage::disk(self::$legacyAvatarDisk)->url($avatar);
        }

        // En S3 la URL se construye sin consultar el bucket: exists() haría una
        // petición HTTP por cada avatar serializado (listados de usuarios).
        if (config("filesystems.disks.{$disk}.driver") === 's3') {
            return Storage::disk($disk)->url($avatar);
        }

        if (Storage::disk($disk)->exists($avatar)) {
            return Storage::disk($disk)->url($avatar);
        }

        return $this->getFallbackAvatarUrl();
    }

    /**
     * Determina si la URL es de un proveedor externo (Google, Microsoft, etc.).
     */
    protected function isExternalAvatarUrl(string $url): bool
    {
        return filter_var($url, FILTER_VALIDATE_URL) !== false;
    }

    /**
     * Ajusta la resolución del avatar para Google y Microsoft.
     */
    protected function optimizeExternalAvatarUrl(string $url, int $size = 256): string
    {
        // Google Users (lh3.googleusercontent.com, etc.)
        if (str_contains($url, 'googleusercontent.com')) {
            return preg_replace('/=s\d+(-c)?$/i', "=s{$size}-c", $url);
        }

        // Microsoft / Hotmail / Live / Outlook (Graph API)
        if (str_contains($url, 'graph.microsoft.com') || str_contains($url, 'live.com')) {
            return preg_replace('/\d+x\d+/i', "{$size}x{$size}", $url);
        }

        return $url;
    }

    /**
     * Genera la imagen SVG vectorizada por defecto.
     */
    protected function getFallbackAvatarUrl(): string
    {
        $name = $this->{$this->getAvatarNameColumn()} ?? 'User';

        return 'https://api.dicebear.com/9.x/initials/svg?seed=' . urlencode($name);
    }

    /**
     * Nombre de la columna que guarda el avatar en DB (sobrescribible en el Modelo).
     */
    protected function getAvatarColumnName(): string
    {
        return property_exists($this, 'avatarColumn') ? $this->avatarColumn : 'avatar_url';
    }

    /**
     * Nombre de la columna usada para el fallback con iniciales (sobrescribible).
     */
    protected function getAvatarNameColumn(): string
    {
        return property_exists($this, 'avatarNameColumn') ? $this->avatarNameColumn : 'name';
    }

    /**
     * Disco de almacenamiento de Laravel a utilizar (sobrescribible con $avatarDisk).
     * Por defecto `filesystems.avatars_disk` (AVATARS_DISK).
     */
    protected function getAvatarDisk(): string
    {
        return property_exists($this, 'avatarDisk')
            ? $this->avatarDisk
            : (string) config('filesystems.avatars_disk', self::$legacyAvatarDisk);
    }
}
