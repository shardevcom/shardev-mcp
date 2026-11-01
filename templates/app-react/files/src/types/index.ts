import type { AuthUser } from '@shardev/common';

export interface UserAuth extends AuthUser {
    phone?: string | null;
    avatar_url?: string | null;
    avatar_public_url?: string | null;
}

export interface Permission {
    id: string | number;
    name: string;
    guard_name: string;
    group?: string | null;
    description?: string | null;
}

export interface Role {
    id: string | number;
    name: string;
    guard_name: string;
    description?: string | null;
    permissions?: Permission[];
    created_at?: string;
    updated_at?: string;
}
