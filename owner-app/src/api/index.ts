import type { Api } from './Api';
import { MockApi, mockVariantFromLocation } from './mock';
import { SupabaseApi } from './supabase';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Both env vars set: real backend. Otherwise the in memory mock.
export const isMock = !(url && key);

export const api: Api = isMock ? new MockApi(mockVariantFromLocation()) : new SupabaseApi(url as string, key as string);
