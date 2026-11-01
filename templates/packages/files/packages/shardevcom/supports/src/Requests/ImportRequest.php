<?php

namespace Shardevcom\Supports\Requests;

use Illuminate\Http\UploadedFile;

class ImportRequest extends JsonRequest
{
    public function rules(): array
    {
        return [
            'file' => [
                'required',
                'file',
                'max:20480',
                // mimes:xlsx,xls alone is not sufficient — Laravel's
                // mimes rule relies on guessExtension(), which prefers the
                // client-supplied extension. Verify the real content MIME
                // (magic bytes) against the spreadsheet MIME family instead.
                function ($attribute, $value, $fail) {
                    if (! $value instanceof UploadedFile) {
                        return;
                    }

                    $allowedMimes = [
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'application/vnd.ms-excel',
                        'application/zip',
                    ];

                    if (! in_array($value->getMimeType(), $allowedMimes, true)) {
                        $fail('El archivo debe ser un XLSX/XLS válido.');
                    }
                },
            ],
        ];
    }
}
