import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  clearAuthRelatedAppCaches,
  loadAuthSnapshot,
  saveAuthSnapshot,
  setActiveUserId,
} from '@/lib/authCache';

// Simplified User type to match your 'staff' table
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  is_super_admin: boolean;
  brand_id?: string | null;
}

interface AuthContextType {
  user: User | null;
  brand: any | null;
  loading: boolean;
  profileReady: boolean;
  isAuthenticated: boolean;
  signInWithGoogle: () => Promise<void>;
  signUp: (opts: { email: string; password: string; displayName?: string }) => Promise<{ ok: boolean; needsConfirmation?: boolean; message?: string }>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  allUsers: any[];
  createUser: (u: any) => Promise<any>;
  updateUser: (userId: string, patch: any) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  hasPermission: (perm: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Do not bootstrap auth from app-managed localStorage; Supabase already persists sessions.
  // A stale local cache here can make the app behave like it "needs a cache clear" to recover.
  const [user, setUser] = useState<User | null>(null);
  const [brand, setBrand] = useState<any | null>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileReady, setProfileReady] = useState(false);

  const withTimeout = async <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> => {
    let timer: any;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error('timeout')), ms);
    });
    try {
      return (await Promise.race([Promise.resolve(p), timeout])) as T;
    } finally {
      clearTimeout(timer);
    }
  };

  const fetchProfileAndBrand = useCallback(async (userId: string) => {
    let finished = false;
    try {
      if (!supabase) {
        setLoading(false);
        setProfileReady(true);
        finished = true;
        return;
      }

      // Fetch staff profile and join with brands table
      let { data: staff, error } = await withTimeout(
        supabase
          .from('staff')
          .select('*, brands(*)')
          .eq('user_id', userId)
          .maybeSingle(),
        10000
      );

      // If no staff row found by user_id, attempt to find by email and link it to this user
      let firstLinked = false;
      if (!staff) {
        // get auth user email
        const { data: sessionData } = await withTimeout(supabase.auth.getSession(), 8000);
        const authUser = (sessionData as any)?.session?.user ?? null;
        const email = authUser?.email ?? null;
        if (email) {
          const { data: byEmail } = await withTimeout(
            supabase
              .from('staff')
              .select('*, brands(*)')
              .eq('email', email)
              .limit(1)
              .maybeSingle(),
            10000
          );
          if (byEmail) {
            staff = byEmail as any;
            // Attempt to set user_id on the existing staff row (if not set)
            if (!staff.user_id) {
              try {
                await withTimeout(supabase.from('staff').update({ user_id: userId }).eq('id', staff.id), 10000);
                staff.user_id = userId;
                firstLinked = true;
              } catch (e) {
                console.warn('Could not link staff by email to user_id', e);
              }
            }
          }
        }
      }

      if (error) {
        setLoading(false);
        finished = true;
        throw error;
      }

      if (staff) {
        const nextUser: User = {
          id: staff.user_id ?? staff.id,
          name: staff.full_name ?? staff.display_name ?? 'User',
          email: staff.email,
          role: staff.role,
          is_super_admin: (staff as any).is_super_admin ?? false,
          brand_id: staff.brand_id,
        };

        const nextBrand = staff.brands || null;

        // If this was the user's first time logging in and there's no brand yet,
        // make them the owner/admin for the upcoming brand creation flow.
        if (firstLinked && !staff.brand_id) {
          try {
            await withTimeout(supabase.from('staff').update({ role: 'owner' }).eq('id', staff.id), 10000);
            staff.role = 'owner';
          } catch (e) {
            console.warn('Could not promote staff to owner', e);
          }
        }

        setUser(nextUser);
        setBrand(nextBrand);
        setActiveUserId(userId);
        saveAuthSnapshot({
          v: 1,
          userId,
          cachedAt: Date.now(),
          user: nextUser,
          brand: nextBrand
            ? {
                id: nextBrand.id ?? null,
                name: nextBrand.name ?? null,
                primary_color_hex: (nextBrand as any).primary_color_hex ?? null,
              }
            : null,
        });
        setLoading(false);
        setProfileReady(true);
        finished = true;
      } else {
        setLoading(false);
        setProfileReady(true);
        finished = true;
      }
    } catch (err) {
      setLoading(false);
      setProfileReady(true);
      finished = true;
      console.error("Error fetching profile:", err);
    } finally {
      if (!finished) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let timeoutId: any = null;

    // Retire legacy app-managed auth cache (Supabase session is the source of truth)
    try {
      localStorage.removeItem('mthunzi.auth.v1');
    } catch {
      // ignore
    }

    if (!supabase) {
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    // Auth Safety Timeout
    timeoutId = setTimeout(() => {
      if (loading) setLoading(false);
    }, 3000);

    // 1. Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;

      const userId = session?.user?.id ?? null;
      if (!userId) {
        setActiveUserId(null);
        setUser(null);
        setBrand(null);
        setLoading(false);
        setProfileReady(true);
        return;
      }

      setActiveUserId(userId);

      // Fast-path: hydrate from local snapshot for this specific session user.
      const snap = loadAuthSnapshot(userId);
      if (snap?.user) {
        setUser(snap.user as any);
        setBrand(snap.brand ?? null);
        setLoading(false);
      }

      // Always refresh in background to keep permissions/brand up to date.
      fetchProfileAndBrand(userId);
    });

    // 2. Listen for Auth Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_IN' && session?.user) {
        const userId = session.user.id;
        setActiveUserId(userId);
        setProfileReady(false);

        const snap = loadAuthSnapshot(userId);
        if (snap?.user) {
          setUser(snap.user as any);
          setBrand(snap.brand ?? null);
          setLoading(false);
        }

        await fetchProfileAndBrand(userId);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setBrand(null);
        setLoading(false);
        setProfileReady(true);
        setActiveUserId(null);
        clearAuthRelatedAppCaches();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [fetchProfileAndBrand]);

  // Load staff list for the current brand when brand changes
  useEffect(() => {
    (async () => {
      if (!supabase) return;
      try {
        if (brand?.id) {
          const { data, error } = await supabase.from('staff').select('*').eq('brand_id', brand.id);
          if (!error && data) setAllUsers(data as any[]);
        } else {
          setAllUsers([]);
        }
      } catch (e) {
        // ignore
      }
    })();
  }, [brand]);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) throw error;
  };

  const signUp = async (opts: { email: string; password: string; displayName?: string }) => {
    if (!supabase) return { ok: false, message: 'Supabase not configured' };
    try {
      const { email, password, displayName } = opts;

      // Create auth user
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: displayName },
        },
        }),
        20000
      );

      if (error) {
        console.error('signUp error', error);
        return { ok: false, message: error.message ?? String(error) };
      }

      // If signUp returned a session, the user is already authenticated and we can create staff and refresh.
      const signUpSession = (data as any)?.session ?? null;
      if (signUpSession && signUpSession.user) {
        const userId = signUpSession.user.id;
        try {
          await withTimeout(
            supabase
              .from('staff')
              .insert({ user_id: userId, email, full_name: displayName ?? email.split('@')[0], role: 'staff', brand_id: null })
              .select(),
            15000
          );
        } catch (e) {
          console.warn('staff insert warning', e);
        }

        await fetchProfileAndBrand(userId);
        return { ok: true, autoSignedIn: true } as any;
      }

      // No session returned from signUp — likely email confirmation required or auto-login disabled.
      // Create a placeholder staff row (user_id null) so the UI shows the account in staff lists
      // and so it can be linked later when the user signs in.
      try {
        // only insert if no staff with this email exists
        const { data: existing } = await withTimeout(
          supabase.from('staff').select('id').eq('email', email).limit(1).maybeSingle(),
          10000
        );
        if (!existing) {
          await withTimeout(
            supabase
              .from('staff')
              .insert({ user_id: null, email, full_name: displayName ?? email.split('@')[0], role: 'staff', brand_id: null })
              .select(),
            15000
          );
        }
      } catch (e) {
        console.warn('Could not create placeholder staff row after signup', e);
      }

      // Do not attempt signInWithPassword (avoids 400 token requests). Let the UI switch to login.
      // If no session, treat as needs confirmation (or disabled auto-login).
      return { ok: true, autoSignedIn: false, needsConfirmation: true, message: 'Account created. Please check your email (if confirmation is enabled), then sign in.' } as any;
    } catch (e: any) {
      console.error('signUp unexpected', e);
      return { ok: false, message: e?.message ?? String(e) };
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    if (!supabase) return false;
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        20000
      );
      if (error) {
        console.error('login error', error);
        return false;
      }
      const userId = (data as any)?.user?.id ?? null;
      if (!userId) return false;
      await fetchProfileAndBrand(userId);
      return true;
    } catch (e) {
      console.error('login unexpected', e);
      return false;
    }
  };

  const logout = async () => {
    try {
      await supabase?.auth.signOut();
    } finally {
      // Ensure local state/caches are cleared even if signOut fails.
      clearAuthRelatedAppCaches();
      setActiveUserId(null);
    }
    setUser(null);
    setBrand(null);
  };

  // Staff admin CRUD helpers
  const createUser = async (newUser: any) => {
    try {
      const row = {
        user_id: null,
        brand_id: brand?.id ?? null,
        display_name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        is_active: newUser.isActive ?? true,
      } as any;
      if (supabase) {
        const { data, error } = await supabase.from('staff').insert(row).select().limit(1);
        if (!error && data && data[0]) {
          setAllUsers(prev => [data[0], ...prev]);
          return data[0];
        }
      }
      // fallback local
      const created = { ...row, id: `local-${Date.now()}` };
      setAllUsers(prev => [created, ...prev]);
      return created;
    } catch (e) {
      console.error('createUser error', e);
      throw e;
    }
  };

  const updateUser = async (userId: string, patch: any) => {
    try {
      if (supabase) {
        const { data, error } = await supabase.from('staff').update(patch).eq('user_id', userId).select().limit(1);
        if (!error && data && data[0]) {
          setAllUsers(prev => prev.map(u => (u.user_id === userId ? { ...u, ...data[0] } : u)));
          return;
        }
      }
      setAllUsers(prev => prev.map(u => (u.user_id === userId ? { ...u, ...patch } : u)));
    } catch (e) {
      console.error('updateUser error', e);
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      if (supabase) {
        const { error } = await supabase.from('staff').delete().eq('user_id', userId);
        if (!error) setAllUsers(prev => prev.filter(u => u.user_id !== userId));
        return;
      }
      setAllUsers(prev => prev.filter(u => u.user_id !== userId));
    } catch (e) {
      console.error('deleteUser error', e);
    }
  };

  const hasPermission = (perm: string) => {
    if (!user) return false;
    if (user.role === 'owner' || user.role === 'admin') return true;
    if (user.role === 'manager' && perm !== 'manageSettings') return true;
    return false;
  };

  const refreshProfile = async () => {
    setLoading(true);
    setProfileReady(false);
    try {
      const { data } = await supabase.auth.getSession();
      const authUser = (data as any)?.session?.user ?? null;
      if (authUser) await fetchProfileAndBrand(authUser.id);
      else setLoading(false);
    } catch (err) {
      console.error('refreshProfile error', err);
      setLoading(false);
      setProfileReady(true);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      brand, 
      loading, 
      profileReady,
      isAuthenticated: !!user, 
      signInWithGoogle,
      signUp,
      login,
      logout,
      refreshProfile,
      allUsers,
      createUser,
      updateUser,
      deleteUser,
      hasPermission,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};