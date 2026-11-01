import type { ReducersMapObject } from '@reduxjs/toolkit';
import { authReducer, type AuthState } from './slices/authSlice';

export interface RootState {
    auth: AuthState;
}

export const rootSlices: ReducersMapObject<RootState> = {
    auth: authReducer,
};
