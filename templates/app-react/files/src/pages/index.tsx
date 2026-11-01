import { AuthProvider, DataProvider, RouterProvider, useAuthAbilityAdapter, useRestApiAdapter } from '@shardev/common';
import { ThemeProvider } from 'next-themes';
import React, { useMemo } from 'react';
import { Toaster } from '@{{ app.key }}/components/ui/sonner';
import { useEnv } from '@{{ app.key }}/hooks/env';
import { routes } from '@{{ app.key }}/routes';
import type { UserAuth } from '@{{ app.key }}/types';

const ACTIONS = ['view', 'list', 'create', 'update', 'remove', 'manage', 'import', 'export'];

export const PageRouter: React.FC = () => {
    const { apiUrl } = useEnv();
    const apiConfig = useMemo(() => ({ baseURL: apiUrl }), [apiUrl]);
    const adapterRestAPI = useRestApiAdapter(apiConfig);
    // El nombre del guard Bearer de esta app: las rutas protegidas piden sesión de ESTE guard.
    const authAdapter = useAuthAbilityAdapter<UserAuth>('{{ app.api_guard }}', ACTIONS);

    if (!authAdapter) return <>Adapter not found</>;

    return (
        <AuthProvider adapter={authAdapter}>
            <DataProvider adapter={adapterRestAPI}>
                <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="{{ app.key }}-theme">
                    <RouterProvider routes={routes} />
                    <Toaster />
                </ThemeProvider>
            </DataProvider>
        </AuthProvider>
    );
};
