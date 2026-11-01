<?php

namespace Shardevcom\Repositories\Tests\Unit;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Pagination\LengthAwarePaginator;
use Shardevcom\Repositories\Tests\Repositories\HookedTestRepository;
use Shardevcom\Repositories\Tests\Repositories\NullReturningHookRepository;
use Shardevcom\Repositories\Repository;
use Shardevcom\Repositories\Tests\Models\TestModel;
use Shardevcom\Repositories\Tests\TestCase;


class RepositoryTest extends TestCase
{
    use RefreshDatabase;

    protected Repository $repository;
    protected TestModel $model;

    protected function setUp(): void
    {
        parent::setUp();

        $this->loadMigrationsFrom(__DIR__.'/../migrations');

        $this->model = new TestModel();
        $this->repository = new Repository($this->model);
    }


    public function test_it_can_fetch_all_records()
    {
        TestModel::create(['name' => 'Test 1', 'description' => 'Description 1']);
        TestModel::create(['name' => 'Test 2', 'description' => 'Description 2']);

        $result = $this->repository->fetch();

        $this->assertCount(2, $result);
        $this->assertEquals('Test 1', $result->first()->name);
    }

    public function test_it_can_fetch_with_pagination()
    {
        TestModel::create(['name' => 'Test 1', 'description' => 'Description 1']);
        TestModel::create(['name' => 'Test 2', 'description' => 'Description 2']);

        $result = $this->repository->fetchMany([
            'pagination' => ['perPage' => 1]
        ]);

        $this->assertEquals(1, $result->count());
        $this->assertEquals(2, $result->total());
    }

    public function test_it_can_create_a_record()
    {
        $result = $this->repository->create([
            'name' => 'New Test',
            'description' => 'New Description'
        ]);

        $this->assertDatabaseHas('test_models', [
            'name' => 'New Test',
            'description' => 'New Description'
        ]);
        $this->assertEquals('New Test', $result->name);
    }

    public function test_it_can_update_a_record()
    {
        $model = TestModel::create([
            'name' => 'Original Name',
            'description' => 'Original Description'
        ]);

        $result = $this->repository->update($model->id, [
            'name' => 'Updated Name'
        ]);

        $this->assertDatabaseHas('test_models', [
            'id' => $model->id,
            'name' => 'Updated Name',
            'description' => 'Original Description'
        ]);
        $this->assertEquals('Updated Name', $result->name);
    }

    public function test_it_can_delete_a_record()
    {
        $model = TestModel::create([
            'name' => 'To Delete',
            'description' => 'Will be deleted'
        ]);

        $this->repository->delete($model->id);

        $this->assertDatabaseMissing('test_models', [
            'id' => $model->id
        ]);
    }

    public function test_it_can_build_a_repository_from_the_manager()
    {
        $repository = $this->app->make('repositories')->make(TestModel::class);

        $this->assertInstanceOf(Repository::class, $repository);
        $this->assertSame('test_models', $repository->getResource());
    }

    public function test_it_runs_hook_helper_actions_for_fetch()
    {
        TestModel::create(['name' => 'Visible', 'description' => 'Keep']);
        TestModel::create(['name' => 'Hidden', 'description' => 'Drop']);

        $repository = new HookedTestRepository(new TestModel());
        $result = $repository->fetch();

        $this->assertSame(['Visible'], $result->pluck('name')->all());
        $this->assertSame([
            'beforeFetch',
            'beforeBuildQuery',
            'applyOnFilter',
            'afterBuildQuery',
            'afterFetch',
        ], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_fetch_many()
    {
        TestModel::create(['name' => 'One', 'description' => 'First']);
        TestModel::create(['name' => 'Two', 'description' => 'Second']);

        $repository = new HookedTestRepository(new TestModel());
        $result = $repository->fetchMany(['pagination' => ['perPage' => 1]]);

        $this->assertInstanceOf(LengthAwarePaginator::class, $result);
        $this->assertSame(1, $result->count());
        $this->assertSame([
            'beforeFetchMany',
            'beforeBuildQuery',
            'applyOnFilter',
            'afterBuildQuery',
            'afterFetchMany',
        ], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_find()
    {
        $model = TestModel::create(['name' => 'Find Me', 'description' => 'Original']);

        $repository = new HookedTestRepository(new TestModel());
        $result = $repository->find($model->id);

        $this->assertSame('Find Me', $result->name);
        $this->assertSame([
            'beforeFind',
            'beforeBuildQuery',
            'applyOnFilter',
            'afterBuildQuery',
            'afterFind',
        ], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_insert_and_create()
    {
        $repository = new HookedTestRepository(new TestModel());

        $created = $repository->create(['name' => 'Draft']);

        $this->assertSame('Draft before insert', $created->name);
        $this->assertSame('applied on insert', $created->description);
        $this->assertSame(['beforeInsert', 'applyOnInsert', 'afterInsert'], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_update()
    {
        $model = TestModel::create(['name' => 'Original', 'description' => 'Original']);
        $repository = new HookedTestRepository(new TestModel());

        $updated = $repository->update($model->id, ['name' => 'Changed']);

        $this->assertSame('Changed before update', $updated->name);
        $this->assertSame('applied on update', $updated->description);
        $this->assertSame(['beforeUpdate', 'applyOnUpdate', 'afterUpdate'], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_update_many()
    {
        $first = TestModel::create(['name' => 'First', 'description' => 'Original']);
        $second = TestModel::create(['name' => 'Second', 'description' => 'Original']);
        $repository = new HookedTestRepository(new TestModel());

        $updated = $repository->updateMany([
            ['id' => $first->id, 'name' => 'First Updated'],
            ['id' => $second->id, 'name' => 'Second Updated'],
        ]);

        $this->assertCount(2, $updated);
        $this->assertDatabaseHas('test_models', [
            'id' => $first->id,
            'name' => 'First Updated',
            'description' => 'applied on update',
        ]);
        $this->assertSame([
            'beforeUpdateMany',
            'applyOnUpdate',
            'applyOnUpdate',
            'afterUpdateMany',
        ], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_delete_and_can_block_deletion()
    {
        $model = TestModel::create(['name' => 'Protected', 'description' => 'keep']);
        $repository = new HookedTestRepository(new TestModel());

        $deleted = $repository->delete($model->id);

        $this->assertFalse($deleted);
        $this->assertDatabaseHas('test_models', ['id' => $model->id]);
        $this->assertSame(['beforeDelete', 'applyOnDelete'], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_successful_delete()
    {
        $model = TestModel::create(['name' => 'Disposable', 'description' => 'delete']);
        $repository = new HookedTestRepository(new TestModel());

        $deleted = $repository->delete($model->id);

        $this->assertTrue($deleted);
        $this->assertDatabaseMissing('test_models', ['id' => $model->id]);
        $this->assertSame(['beforeDelete', 'applyOnDelete', 'afterDelete'], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_delete_many()
    {
        $protected = TestModel::create(['name' => 'Protected', 'description' => 'keep']);
        $disposable = TestModel::create(['name' => 'Disposable', 'description' => 'delete']);
        $repository = new HookedTestRepository(new TestModel());

        $count = $repository->deleteMany([$protected->id, $disposable->id]);

        $this->assertSame(1, $count);
        $this->assertDatabaseHas('test_models', ['id' => $protected->id]);
        $this->assertDatabaseMissing('test_models', ['id' => $disposable->id]);
        $this->assertSame([
            'beforeDeleteMany',
            'applyOnDelete',
            'applyOnDelete',
            'afterDeleteMany',
        ], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_upsert()
    {
        $repository = new HookedTestRepository(new TestModel());

        $count = $repository->upsert([
            ['id' => 50, 'name' => 'Upserted'],
        ], ['id'], ['name', 'description']);

        $this->assertSame(1, $count);
        $this->assertDatabaseHas('test_models', [
            'id' => 50,
            'name' => 'Upserted before upsert',
            'description' => 'applied on upsert',
        ]);
        $this->assertSame(['beforeUpsert', 'applyOnUpsert', 'afterUpsert'], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_update_or_create()
    {
        $repository = new HookedTestRepository(new TestModel());

        $model = $repository->updateOrCreate(
            ['name' => 'Lookup'],
            ['description' => 'Created by updateOrCreate']
        );

        $this->assertSame('Lookup', $model->name);
        $this->assertSame('Created by updateOrCreate', $model->description);
        $this->assertSame(['beforeUpdateOrCreate', 'afterUpdateOrCreate'], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_first_or_create()
    {
        $repository = new HookedTestRepository(new TestModel());

        $model = $repository->firstOrCreate(
            ['name' => 'First Or Create'],
            ['description' => 'Created']
        );

        $this->assertSame('First Or Create', $model->name);
        $this->assertSame('Created', $model->description);
        $this->assertSame(['beforeFirstOrCreate', 'afterFirstOrCreate'], $repository->hooks);
    }

    public function test_it_runs_hook_helper_actions_for_first_or_new()
    {
        $repository = new HookedTestRepository(new TestModel());

        $model = $repository->firstOrNew(
            ['name' => 'First Or New'],
            ['description' => 'Unsaved']
        );

        $this->assertFalse($model->exists);
        $this->assertSame('First Or New', $model->name);
        $this->assertSame(['beforeFirstOrNew', 'afterFirstOrNew'], $repository->hooks);
    }

    public function test_hook_helper_keeps_the_default_value_when_a_hook_returns_null()
    {
        $model = TestModel::create(['name' => 'Original', 'description' => 'Original']);
        $repository = new NullReturningHookRepository(new TestModel());

        $updated = $repository->update($model->id, ['name' => 'Changed']);

        $this->assertSame('Changed', $updated->name);
        $this->assertSame('Original', $updated->description);
        $this->assertSame(['beforeUpdate', 'applyOnUpdate'], $repository->hooks);
    }
}




