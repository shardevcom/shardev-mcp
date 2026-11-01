import {
    ProcessApiResponse,
    useAppDispatch,
    useAppSelector,
    useData,
    useNavigate,
    usePermissions,
    useStoreContext,
} from '@shardev/common';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { initAuth, setAuth, setLoading, type AuthState } from '@{{ app.key }}/reducers/slices/authSlice';
import { ROUTE } from '@{{ app.key }}/routes/paths';
import type { UserAuth } from '@{{ app.key }}/types';
import { wipeSessionStorage } from '@{{ app.key }}/utils/clearAuthStorage';

export const useAuth = () => {
    const dispatch = useAppDispatch();
    const { store, persist: persistor, purge } = useStoreContext();
    const { authUser, loading } = useAppSelector<AuthState>((state) => state.auth);
    const api = useData();
    const navigate = useNavigate();
    const permissions = usePermissions<UserAuth>();

    const login = useCallback(
        async (email: string, password: string): Promise<boolean> => {
            dispatch(setLoading(true));
            try {
                const response = await api.signIn!<UserAuth>({ email, password });
                if (!response.success || !response.data) {
                    throw new Error(response.message || 'Credenciales inválidas');
                }
                dispatch(setAuth(response.data));
                navigate(ROUTE.HOME);
                return true;
            } catch (error) {
                throw new Error(ProcessApiResponse<UserAuth>(error).message || 'Credenciales inválidas');
            } finally {
                dispatch(setLoading(false));
            }
        },
        [api, dispatch, navigate],
    );

    const logout = useCallback(async () => {
        // Revocación en el servidor (mejor esfuerzo): el token deja de valer aunque se conserve.
        if (authUser?.access_token) {
            try {
                await api.insert('logout', {});
            } catch {
                toast.warning('No se pudo cerrar la sesión en el servidor; se cerró localmente.');
            }
        }
        await wipeSessionStorage({ store, persistor, purge }, () => {
            dispatch(initAuth());
            dispatch({ type: 'RESET_STATE' });
        });
        navigate(ROUTE.SIGNIN);
    }, [api, authUser, dispatch, navigate, persistor, purge, store]);

    const hasPermission = useCallback(
        (action: string, subject?: string): boolean => {
            try {
                return permissions?.can?.(action, subject) ?? false;
            } catch {
                return false;
            }
        },
        [permissions],
    );

    return {
        authUser,
        loading,
        isAuthenticated: !!authUser?.access_token && !!authUser?.id,
        login,
        logout,
        hasPermission,
    };
};
