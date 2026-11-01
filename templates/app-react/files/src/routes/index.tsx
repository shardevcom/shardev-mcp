import { Navigate, type PermissionAdapter, type RouteConfig } from '@shardev/common';
import React from 'react';
import AppLayout from '@{{ app.key }}/layouts/app';
import AuthLayout from '@{{ app.key }}/layouts/auth';
import { ROUTE } from '@{{ app.key }}/routes/paths';
import type { UserAuth } from '@{{ app.key }}/types';

const SignIn = React.lazy(() => import('@{{ app.key }}/pages/auth/sign-in'));
const HomePage = React.lazy(() => import('@{{ app.key }}/pages/home'));
const ProfilePage = React.lazy(() => import('@{{ app.key }}/pages/profile'));
const RolesPage = React.lazy(() => import('@{{ app.key }}/pages/roles'));
{{#if app.feature.invitations}}
const InvitationsPage = React.lazy(() => import('@{{ app.key }}/pages/invitations'));
const AcceptInvitationPage = React.lazy(() => import('@{{ app.key }}/pages/auth/accept-invitation'));
{{/if}}
const NotFoundPage = React.lazy(() => import('@{{ app.key }}/pages/not-found'));

// Redirigir aquí es comodidad de UX. La autorización real la hace el backend en cada petición.
const needSession = (adapter: PermissionAdapter<UserAuth>) => (!adapter.isAuthenticated('{{ app.api_guard }}') ? ROUTE.SIGNIN : false);

export const routes: RouteConfig[] = [
    {
        path: '/{{ app.key }}',
        id: '{{ app.key }}',
        element: () => <AppLayout />,
        children: [
            { index: true, element: () => <Navigate to="home" /> },
            { path: 'home', id: '{{ app.key }}-home', element: () => <HomePage />, redirectLogic: needSession },
            { path: 'profile', id: '{{ app.key }}-profile', element: () => <ProfilePage />, redirectLogic: needSession },
            {
                path: 'roles',
                id: '{{ app.key }}-roles',
                element: () => <RolesPage />,
                redirectLogic: (adapter: PermissionAdapter<UserAuth>) => needSession(adapter) || (!adapter.can('list', 'roles') ? ROUTE.HOME : false),
            },
{{#if app.feature.invitations}}
            {
                path: 'invitations',
                id: '{{ app.key }}-invitations',
                element: () => <InvitationsPage />,
                redirectLogic: (adapter: PermissionAdapter<UserAuth>) => needSession(adapter) || (!adapter.can('list', 'invitations') ? ROUTE.HOME : false),
            },
{{/if}}
            { path: '*', id: '{{ app.key }}-not-found', element: () => <NotFoundPage /> },
        ],
    },
    {
        path: '/{{ app.key }}/auth',
        id: '{{ app.key }}-auth',
        element: () => <AuthLayout />,
{{#if !app.feature.invitations}}
        children: [{ path: 'signin', id: '{{ app.key }}-signin', element: () => <SignIn /> }],
{{/if}}
{{#if app.feature.invitations}}
        children: [
            { path: 'signin', id: '{{ app.key }}-signin', element: () => <SignIn /> },
            { path: 'accept-invitation', id: '{{ app.key }}-accept-invitation', element: () => <AcceptInvitationPage /> },
        ],
{{/if}}
    },
];
