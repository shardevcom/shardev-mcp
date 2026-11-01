<?php

namespace Shardevcom\Repositories\Tests\Unit;

use Illuminate\Auth\Access\AuthorizationException;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Shardevcom\Repositories\Tests\TestCase;
use Shardevcom\Supports\Helpers\HookHelper;
use stdClass;

/**
 * an exception thrown inside an authorization hook must fail closed
 * (deny), never silently fall back to the unmodified payload — a fallback
 * there would mean "no authorization check ran" (fail-open). Non-authorization
 * hooks keep their original resilience (log + fall back).
 */
class HookHelperFailClosedTest extends TestCase
{
    public static function authorizationHookProvider(): array
    {
        return [
            'applyOnFilter' => ['applyOnFilter', new stdClass(), []],
            'applyOnInsert' => ['applyOnInsert', [], []],
            'applyOnUpdate' => ['applyOnUpdate', [], [new stdClass()]],
            'applyOnUpsert' => ['applyOnUpsert', [], []],
            'applyOnDelete' => ['applyOnDelete', new stdClass(), []],
        ];
    }

    #[DataProvider('authorizationHookProvider')]
    public function test_authorization_hook_exception_fails_closed(string $hook, mixed $payload, array $context): void
    {
        $target = new class
        {
            public function applyOnFilter(object $query): object
            {
                throw new RuntimeException('authorization hook exploded');
            }

            public function applyOnInsert(array $data): array
            {
                throw new RuntimeException('authorization hook exploded');
            }

            public function applyOnUpdate(array $data, object $model): array
            {
                throw new RuntimeException('authorization hook exploded');
            }

            public function applyOnUpsert(array $rows): array
            {
                throw new RuntimeException('authorization hook exploded');
            }

            public function applyOnDelete(object $model): bool
            {
                throw new RuntimeException('authorization hook exploded');
            }
        };

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('authorization hook exploded');

        HookHelper::pipe($target, $hook, $payload, ...$context);
    }

    public function test_non_authorization_hook_exception_still_falls_back(): void
    {
        $target = new class
        {
            public function beforeBuildQuery(object $query): object
            {
                throw new RuntimeException('informational hook exploded');
            }
        };

        $payload = new stdClass();
        $result = HookHelper::pipe($target, 'beforeBuildQuery', $payload);

        $this->assertSame($payload, $result);
    }

    public function test_intentional_authorization_denial_is_never_swallowed(): void
    {
        $target = new class
        {
            public function applyOnFilter(object $query): object
            {
                throw new AuthorizationException('denied');
            }
        };

        $this->expectException(AuthorizationException::class);

        HookHelper::pipe($target, 'applyOnFilter', new stdClass());
    }
}
