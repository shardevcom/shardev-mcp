<?php

namespace Shardevcom\Supports\Models;

use Spatie\Permission\Models\Permission as SpatiePermission;

class Permission extends SpatiePermission
{
    protected $fillable = [
        'name',
        'guard_name',
        'group',
        'description',
    ];

    /**
     * Scope para filtrar por grupo
     */
    public function scopeGroup($query, string $group)
    {
        return $query->where('group', $group);
    }

    /**
     * Accessor para mostrar el grupo con formato
     */
    public function getGroupLabelAttribute(): string
    {
        return ucfirst(str_replace('_', ' ', $this->group ?? 'General'));
    }

}
