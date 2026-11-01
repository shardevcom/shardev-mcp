<?php

namespace Shardevcom\Supports\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Shardevcom\Supports\Contracts\FileStorageInterface;

class FileStorageService implements FileStorageInterface
{
    protected string $disk;
    protected ?string $cloudfrontUrl;

    public function __construct()
    {
        $this->disk = config('filesystems.default');
        $this->cloudfrontUrl = config('filesystems.cloudfront_url');
    }

    /**
     * @param string $directory
     * @param UploadedFile $file
     * @param string $visibility
     * @return string
     */
    public function upload(
        string $directory,
        UploadedFile $file,
        string $visibility = 'private'
    ): string {
        $filename = $this->generateFilename($file);

        return Storage::disk($this->disk)->putFileAs(
            $directory,
            $file,
            $filename,
            $visibility
        );
    }

    /**
     * @param string $path
     * @return string
     */
    public function url(string $path): string
    {
        if ($this->cloudfrontUrl) {
            return rtrim($this->cloudfrontUrl, '/') . '/' . ltrim($path, '/');
        }

        return Storage::disk($this->disk)->url($path);
    }

    /**
     * @param string $path
     * @param int $minutes
     * @return string}
     */
    public function temporaryUrl(string $path, int $minutes = 10): string
    {
        // Si usas CloudFront público, no necesitas firmar
        if ($this->cloudfrontUrl) {
            return $this->url($path);
        }

        return Storage::disk($this->disk)
            ->temporaryUrl($path, now()->addMinutes($minutes));
    }

    /**
     * @param string $path
     * @return bool}
     */
    public function delete(string $path): bool
    {
        return Storage::disk($this->disk)->delete($path);
    }

    /**
     * @param string $path
     * @return bool
     */
    public function exists(string $path): bool
    {
        return Storage::disk($this->disk)->exists($path);
    }

    /**
     * @param UploadedFile $file
     * @return string
     */
    protected function generateFilename(UploadedFile $file): string
    {
        return Str::uuid() . '.' . $file->getClientOriginalExtension();
    }
}
