<?php

namespace Shardevcom\Authentications\Http\Controllers;

use Illuminate\Http\Request;
use Shardevcom\Authentications\Exports\PermissionExport;
use Shardevcom\Authentications\Http\Requests\PermissionRequest;
use Shardevcom\Authentications\Imports\PermissionImport;
use Shardevcom\Supports\Controllers\Controller;
use Shardevcom\Supports\Repositories\PermissionRepository;
use Shardevcom\Supports\Traits\HasBulkOperations;
use Shardevcom\Supports\Traits\HasExport;
use Shardevcom\Supports\Traits\HasImport;

class PermissionController extends Controller
{
    use HasExport, HasImport, HasBulkOperations;

    protected $repository;

    protected ?string $exportClass = PermissionExport::class;
    protected ?string $importClass = PermissionImport::class;
    protected ?string $requestClass = PermissionRequest::class;

    public function __construct(PermissionRepository $repository)
    {
        $this->repository = $repository;
    }

    /**
     * Sincronizar un permiso con un rol mediante el repositorio.
     */
    public function updatePermissionRole(Request $request, string $id)
    {
        return $this->respond('updateRoleAssignment',
            function () use ($id, $request) {
                $validated = $request->validate([
                    'role'    => 'required|string',
                    'enabled' => 'required|boolean',
                ]);
                return [
                    'updated' => $this->repository->updateRoleAssignment(
                        $id,
                        $validated
                    )
                ];
            }
        );
    }
}
