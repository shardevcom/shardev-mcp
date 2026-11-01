import { useMemo } from 'react';

/** Variables de entorno de Vite de esta app. VITE_API_URL apunta a /api; la app añade su prefijo. */
export const useEnv = () =>
    useMemo(
        () => ({
            appUrl: import.meta.env.VITE_APP_URL || '',
            apiUrl: `${import.meta.env.VITE_API_URL || '/api'}/{{ app.key }}`,
            appName: import.meta.env.VITE_APP_NAME || '{{ project.name }}',
        }),
        [],
    );
