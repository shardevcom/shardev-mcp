# Shardevcom Repositories

Laravel package for creating model-based repositories with filtering, sorting, includes, field selection, pagination, mutations and lifecycle hooks.

## Installation

```bash
composer require shardevcom/repositories
```

Publish the configuration when you need global allow-lists:

```bash
php artisan vendor:publish --tag=repositories-config
```

## Create a Repository

Generate a repository for an Eloquent model:

```bash
php artisan make:repository User
php artisan make:repository App\\Models\\User
```

This creates `app/Repositories/UserRepository.php`:

```php
use Shardevcom\Authentications\Models\User;use Shardevcom\Repositories\Repository;

class UserRepository extends Repository
{
    protected array $filterableFields = ['id', 'email'];
    protected array $sortableFields = ['id', 'created_at'];
    protected array $searchableFields = ['name', 'email'];

    public function __construct(?User $model = null)
    {
        parent::__construct($model ?? new User());
    }
}
```

## Usage

Inject your repository or build one from a model:

```php
use Shardevcom\Authentications\Models\User;use Shardevcom\Repositories\Facades\Repository as Repositories;

$users = Repositories::make(User::class)->fetchMany([
    'filter' => [
        'email' => '*@example.com',
    ],
    'sort' => [
        'field' => 'created_at',
        'order' => 'desc',
    ],
    'pagination' => [
        'perPage' => 15,
        'page' => 1,
    ],
]);
```

## Query Parameters

- `filter`: exact values, `in`, `not_in`, `between`, `null`, `not_null`, comparison operators like `>=10`, and wildcard search with `*` or `%`.
- `sort`: single sort with `field` and `order`, or a list of sorts.
- `include`: relation names allowed by `$allowedIncludes`.
- `fields`: visible fields allowed by `$allowedFields` and excluding `$hiddenFields`.
- `search`: global search across `$searchableFields`.

## Mutations

```php
$repository->create($data);
$repository->update($id, $data);
$repository->delete($id);
$repository->updateMany($items);
$repository->deleteMany($ids);
$repository->updateOrCreate($attributes, $values);
$repository->firstOrCreate($attributes, $values);
$repository->firstOrNew($attributes, $values);
$repository->upsert($rows, $uniqueBy, $updateColumns);
```

## Hooks

Add hook methods to a repository to customize behavior:

```php
protected function beforeUpdate(User $user, array $data): array
{
    return array_merge($data, ['updated_by' => auth()->id()]);
}

protected function applyOnDelete(User $user): bool
{
    return !$user->is_admin;
}
```

Hooks can return the modified value. Returning `null` keeps the current value.

## Testing

```bash
composer install
composer test
```
