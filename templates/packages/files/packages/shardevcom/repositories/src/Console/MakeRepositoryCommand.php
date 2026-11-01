<?php

namespace Shardevcom\Repositories\Console;

use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use InvalidArgumentException;

class MakeRepositoryCommand extends Command
{
    protected $signature = 'make:repository
        {model : Model class name, for example User or App\\Models\\User}
        {name? : Repository class name. Defaults to ModelRepository}
        {--force : Overwrite the repository if it already exists}';

    protected $description = 'Create a repository class for an Eloquent model.';

    public function handle(): int
    {
        $modelClass = $this->qualifyModel((string) $this->argument('model'));
        $repositoryName = $this->qualifyRepositoryName($modelClass, $this->argument('name'));
        $path = app_path('Repositories/'.class_basename($repositoryName).'.php');

        if (File::exists($path) && !$this->option('force')) {
            $this->components->error("Repository already exists: {$path}");

            return self::FAILURE;
        }

        File::ensureDirectoryExists(dirname($path));
        File::put($path, $this->buildClass($repositoryName, $modelClass));

        $this->components->info("Repository created: {$path}");

        return self::SUCCESS;
    }

    private function qualifyModel(string $model): string
    {
        $model = ltrim($model, '\\');

        $candidates = str_contains($model, '\\')
            ? [$model]
            : ["App\\Models\\{$model}", "App\\{$model}"];

        foreach ($candidates as $candidate) {
            if (!class_exists($candidate)) {
                continue;
            }

            if (!is_subclass_of($candidate, Model::class)) {
                throw new InvalidArgumentException("Class [{$candidate}] is not an Eloquent model.");
            }

            return $candidate;
        }

        return $candidates[0];
    }

    private function qualifyRepositoryName(string $modelClass, mixed $name): string
    {
        $name = $name ? (string) $name : class_basename($modelClass).'Repository';
        $name = Str::finish(Str::studly(class_basename($name)), 'Repository');

        return "App\\Repositories\\{$name}";
    }

    private function buildClass(string $repositoryClass, string $modelClass): string
    {
        $class = class_basename($repositoryClass);
        $model = class_basename($modelClass);

        return <<<PHP
<?php

namespace App\Repositories;

use {$modelClass};
use Shardevcom\Repositories\Repository;

class {$class} extends Repository
{
    protected array \$filterableFields = [
        'id',
    ];

    protected array \$sortableFields = [
        'id',
        'created_at',
        'updated_at',
    ];

    protected array \$allowedFields = [
        'id',
        'created_at',
        'updated_at',
    ];

    protected array \$searchableFields = [];

    protected array \$allowedIncludes = [];

    public function __construct(?{$model} \$model = null)
    {
        parent::__construct(\$model ?? new {$model}());
    }
}
PHP;
    }
}
