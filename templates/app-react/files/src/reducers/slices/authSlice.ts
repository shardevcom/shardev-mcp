import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { UserAuth } from '@{{ app.key }}/types';

export interface AuthState {
    authUser: UserAuth;
    loading: boolean;
}

export const authInitState: AuthState = {
    authUser: {
        id: '',
        name: '',
        email: '',
        avatar_url: '',
        refresh_token: '',
        access_token: '',
        token_type: '',
        expires_at: '',
        roles: [],
        permissions: [],
    },
    loading: false,
};

export const authSlice = createSlice({
    name: 'auth',
    initialState: authInitState,
    reducers: {
        initAuth: (state) => {
            state.authUser = authInitState.authUser;
            state.loading = false;
        },
        setAuth: (state, action: PayloadAction<UserAuth>) => {
            state.authUser = { ...state.authUser, ...action.payload };
        },
        setLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },
    },
});

export const { initAuth, setAuth, setLoading } = authSlice.actions;
export const authReducer = authSlice.reducer;
