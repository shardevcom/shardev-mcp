<?php

namespace Shardevcom\Supports\Repositories;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class FileRepository
{
    public function upload(string $resource, array $params): array
    {
        /** @var UploadedFile $file */
        $file = $params['file'];
        $metadata = Arr::get($params, 'metadata', []);
        $disk = Arr::get($params, 'storage.disk', 'public');
        $basePath = Arr::get($params, 'storage.path', 'uploads/'.$resource);
        $allowedExtensions = Arr::get(
            $params,
            'storage.allowed_extensions',
            ['jpg', 'jpeg', 'png', 'webp']
        );

        // never trust the client-supplied name/extension. The MIME
        // is verified from the file's actual content (magic bytes) and the
        // stored name is a random UUID, which makes path traversal via ".."
        // impossible. UploadedFile::guessExtension() prefers the client
        // extension, so it is NOT used as the primary content check.
        $allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
        $mime = $file->getMimeType();

        if (! in_array($mime, $allowedMimes, true)) {
            throw new \Shardevcom\Supports\Exceptions\UserFacingException('messages.file_not_allowed', 422);
        }

        $extension = strtolower($file->guessExtension());

        if (! in_array($extension, $allowedExtensions, true)) {
            throw new \Shardevcom\Supports\Exceptions\UserFacingException('messages.file_not_allowed', 422);
        }

        $fileName = Str::uuid().'.'.$extension;
        $path = $file->storeAs($basePath, $fileName, $disk);

        // Los discos S3 usan 'throw' => false: un fallo (credenciales, permisos
        // del bucket) devuelve false en lugar de lanzar. No se debe continuar
        // como si el archivo se hubiera guardado.
        if ($path === false) {
            throw new \RuntimeException("No se pudo guardar el archivo en el disco [{$disk}].");
        }

        return [
            'storeUrl' => $path,
            'publicUrl' => Storage::disk($disk)->url($path),
            'metadata' => $metadata,
        ];
    }

    /**
     * Sube un avatar al disco configurado (filesystems.avatars_disk). El disco y
     * la ruta los decide el servidor; nunca se toman del cliente.
     */
    public function uploadAvatar(UploadedFile $file, array $metadata = []): array
    {
        return $this->upload('avatar', [
            'file' => $file,
            'metadata' => $metadata,
            'storage' => ['disk' => $this->avatarDisk()],
        ]);
    }

    /**
     * Borra un avatar anterior tanto del disco actual como del disco local
     * donde se guardaban antes (`public`).
     */
    public function deleteAvatar(string $path): void
    {
        foreach (array_unique([$this->avatarDisk(), 'public']) as $disk) {
            $this->delete($disk, $path);
        }
    }

    private function avatarDisk(): string
    {
        return (string) config('filesystems.avatars_disk', 'public');
    }

    public function delete(string $disk, string $path): bool
    {
        return Storage::disk($disk)->exists($path) && Storage::disk($disk)->delete($path);
    }
}
