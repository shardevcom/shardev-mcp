<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Http\Request;
use Maatwebsite\Excel\Facades\Excel;
use Shardevcom\Supports\Exports\ExportFormat;
use Shardevcom\Supports\Responses\JsonResponse;

trait HasExport
{
    public function export(Request $request)
    {
        // 1. AUTORIZACIÓN: Interrumpe la ejecución si el usuario no tiene permisos
        if (method_exists($this->repository, 'authorizeExport')) {
            $this->repository->authorizeExport();
        }

        // 2. Verificar configuración de la clase exportadora
        if (empty($this->exportClass) || ! class_exists($this->exportClass)) {
            abort(404, 'Export class configuration invalid or not found.');
        }

        // 3. Procesar y descargar el archivo
        return JsonResponse::execute($this->repository, 'export', function () use ($request) {
            $export = ExportFormat::resolve(
                resource: $this->repository->getResource(),
                format: $request->input('format')
            );

            return Excel::download(
                new $this->exportClass($this->repository, $request->all()),
                fileName: $export['filename'],
                writerType: $export['writer_type']
            );
        });
    }
}
