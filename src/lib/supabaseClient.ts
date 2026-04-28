import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://rbxvjmsqpnoncncwglms.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJieHZqbXNxcG5vbmNuY3dnbG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODI5OTMsImV4cCI6MjA4NzE1ODk5M30.NVNiJf1SIcfDgI1mjqPu2ITvIERqWjM4YsNpv8Xvogk';

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || DEFAULT_SUPABASE_URL;
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || DEFAULT_SUPABASE_ANON_KEY;

const DEFAULT_SUPABASE_BUCKET = 'product-images';
export const SUPABASE_BUCKET =
  (import.meta.env.VITE_SUPABASE_BUCKET as string | undefined)?.trim() || DEFAULT_SUPABASE_BUCKET;

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: { persistSession: true },
    })
  : null;

// Isolated client for one-off credential checks that must not alter
// the app's primary authenticated session.
export const createEphemeralSupabaseClient = (): SupabaseClient | null =>
  isSupabaseConfigured()
    ? createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

// Expose client to window during development to aid debugging in DevTools console.
// Do NOT rely on this in production; it's a dev-time convenience.
try {
  if (typeof window !== 'undefined' && import.meta.env?.DEV && supabase) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    window.__supabase = supabase;
  }
} catch {
  // ignore
}
