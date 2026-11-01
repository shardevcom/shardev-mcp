<?php

namespace Shardevcom\Authentications\Http\Controllers;

use Shardevcom\Authentications\Exports\RoleExport;
use Shardevcom\Authentications\Http\Requests\RoleRequest;
use Shardevcom\Authentications\Imports\RoleImport;
use Shardevcom\Supports\Controllers\Controller;
use Shardevcom\Supports\Repositories\RoleRepository;
use Shardevcom\Supports\Traits\HasBulkOperations;
use Shardevcom\Supports\Traits\HasExport;
use Shardevcom\Supports\Traits\HasImport;

class RoleController extends Controller
{
    use HasExport, HasImport, HasBulkOperations;

    protected $repository;
    protected ?string $exportClass = RoleExport::class;
    protected ?string $importClass = RoleImport::class;
    protected ?string $requestClass = RoleRequest::class;

    public function __construct(RoleRepository $repository)
    {
        $this->repository = $repository;
    }

}
