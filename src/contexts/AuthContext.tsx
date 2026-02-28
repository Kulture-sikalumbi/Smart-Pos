import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

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
  const [user, setUser] = useState<User | null>(null);
  const [brand, setBrand] = useState<any | null>(null);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProfileAndBrand = useCallback(async (userId: string) => {
    try {
      // Fetch staff profile and join with brands table
      const { data: staff, error } = await supabase
        .from('staff')
        .select('*, brands(*)')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;

      if (staff) {
        setUser({
          id: staff.user_id ?? staff.id,
          name: staff.full_name ?? staff.display_name ?? 'User',
          email: staff.email,
          role: staff.role,
          is_super_admin: staff.is_super_admin,
          brand_id: staff.brand_id
        });
        setBrand(staff.brands || null);
      }
    } catch (err) {
      console.error("Error fetching profile:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // 1. Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) {
        if (session?.user) {
          fetchProfileAndBrand(session.user.id);
        } else {
          setLoading(false);
        }
      }
    });

    // 2. Listen for Auth Changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_IN' && session?.user) {
        await fetchProfileAndBrand(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setBrand(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
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
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        console.error('signUp error', error);
        return { ok: false, message: error.message ?? String(error) };
      }

      const userId = (data as any)?.user?.id ?? (data as any)?.id ?? null;

      // create staff row (best-effort)
      try {
        const row = {
          user_id: userId,
          email,
          display_name: displayName ?? email.split('@')[0],
          role: 'waitron',
          is_active: true,
        } as any;
        await supabase.from('staff').insert(row);
      } catch (e) {
        console.error('failed to create staff row after signUp', e);
      }

      // check whether a session exists (some Supabase configs require email confirmation)
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = (sessionData as any)?.session ?? null;
        if (session && session.user) {
          // we are signed in
          await refreshProfile();
          return { ok: true };
        }
        // no session -> likely needs email confirmation
        return { ok: false, needsConfirmation: true, message: 'Please confirm your email before signing in.' };
      } catch (e) {
        console.error('error checking session after signUp', e);
        return { ok: true };
      }
    } catch (e: any) {
      console.error('signUp unexpected', e);
      return { ok: false, message: e?.message ?? String(e) };
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    if (!supabase) return false;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
    await supabase.auth.signOut();
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
    try {
      const { data } = await supabase.auth.getSession();
      const authUser = (data as any)?.session?.user ?? null;
      if (authUser) await fetchProfileAndBrand(authUser.id);
      else setLoading(false);
    } catch (err) {
      console.error('refreshProfile error', err);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      brand, 
      loading, 
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