<?php

namespace Shardevcom\Supports\Contracts;

use Illuminate\Http\UploadedFile;

interface FileStorageInterface
{
    public function upload(
        string $directory,
        UploadedFile $file,
        string $visibility = 'private'
    ): string;

    public function url(string $path): string;

    public function temporaryUrl(string $path, int $minutes = 10): string;

    public function delete(string $path): bool;

    public function exists(string $path): bool;

}
