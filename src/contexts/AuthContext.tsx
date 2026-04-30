import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { UserRole, RolePermissions } from '@/types/auth';
import { ROLE_PERMISSIONS } from '@/types/auth';
import { isAssignableStaffRole } from '@/types/auth';
import {
  clearAuthRelatedAppCaches,
  loadAuthSnapshot,
  saveAuthSnapshot,
  setActiveUserId,
} from '@/lib/authCache';
import { setActiveBrandId } from '@/lib/activeBrand';
import { ensureCategoriesLoaded, refreshCategories } from '@/lib/categoriesStore';
import { ensureSuppliersLoaded, refreshSuppliers } from '@/lib/suppliersStore';

type AccountUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_super_admin: boolean;
  brand_id?: string | null;
};

export type BrandStaffUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  pin?: string;
  isActive: boolean;
  brand_id?: string | null;
  createdAt?: string;
};

const OPERATOR_KEY_PREFIX = 'pmx.operatorId.v1.';
const STAFF_SESSION_KEY = 'pmx.staff.session.v1';

type StaffSession = {
  v: 1;
  staff: BrandStaffUser;
  brand: any;
  operatorPin?: string;
  cachedAt: number;
};

function loadStaffSession(): StaffSession | null {
  try {
    const raw = localStorage.getItem(STAFF_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StaffSession>;
    if (parsed.v !== 1) return null;
    if (!parsed.staff || typeof (parsed.staff as any).id !== 'string') return null;
    if (!parsed.brand || typeof (parsed.brand as any).id !== 'string') return null;
    return parsed as StaffSession;
  } catch {
    return null;
  }
}

function saveStaffSession(session: StaffSession) {
  try {
    localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

function clearStaffSession() {
  try {
    localStorage.removeItem(STAFF_SESSION_KEY);
  } catch {
    // ignore
  }
}

function isUserRole(role: unknown): role is UserRole {
  return (
    role === 'owner' ||
    role === 'manager' ||
    role === 'front_supervisor' ||
    role === 'cashier' ||
    role === 'waitron' ||
    role === 'kitchen_staff' ||
    role === 'bar_staff'
  );
}

function normalizeRole(role: unknown): UserRole {
  if (isUserRole(role)) return role;
  return 'owner';
}

function resolveBrandIsActive(brandRow: any | null | undefined): boolean {
  if (!brandRow) return true;
  return brandRow.is_active === true;
}

function mapUnderBrandStaffRow(row: any): BrandStaffUser {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    email: String(row.email ?? ''),
    role: normalizeRole(row.role),
    pin: row.pin ?? undefined,
    isActive: Boolean(row.is_active ?? row.isActive ?? true),
    brand_id: row.brand_id ?? null,
    createdAt: row.created_at ?? row.createdAt,
  };
}

interface AuthContextType {
  user: BrandStaffUser | null;
  accountUser: AccountUser | null;
  brand: any | null;
  brandIsActive: boolean; // Whether the current brand is activated
  operatorPin: string | null;
  loading: boolean;
  profileReady: boolean;
  isAuthenticated: boolean;
  signInWithGoogle: () => Promise<void>;
  signUp: (opts: { email: string; password: string; displayName?: string }) => Promise<{ ok: boolean; needsConfirmation?: boolean; message?: string }>;
  login: (email: string, password: string) => Promise<boolean>;
  staffLogin: (email: string, pin: string) => Promise<{ ok: boolean; message?: string; role?: UserRole }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  allUsers: any[];
  operatorUsers: BrandStaffUser[];
  switchUser: (operatorId: string) => void;
  createUser: (u: any) => Promise<any>;
  updateUser: (userId: string, patch: any) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  hasPermission: (perm: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Do not bootstrap auth from app-managed localStorage; Supabase already persists sessions.
  // A stale local cache here can make the app behave like it "needs a cache clear" to recover.
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [user, setUser] = useState<BrandStaffUser | null>(null);
  const [brand, setBrand] = useState<any | null>(null);
  const [brandIsActive, setBrandIsActive] = useState<boolean>(true); // Track brand activation status
  const [allUsers, setAllUsers] = useState<BrandStaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const [operatorPin, setOperatorPin] = useState<string | null>(null);

  // Preload commonly used reference data so screens don't feel "lazy".
  useEffect(() => {
    if (!profileReady) return;
    ensureCategoriesLoaded();
    ensureSuppliersLoaded();
    // Kick a background refresh (best-effort)
    void refreshCategories().catch(() => {});
    void refreshSuppliers().catch(() => {});
  }, [profileReady]);

  // Supabase can emit an initial SIGNED_OUT event during boot (no session).
  // We must not treat that as a real logout, otherwise staff POS sessions restored from
  // localStorage can get wiped on every reload.
  const hadSupabaseSessionRef = useRef(false);
  const sessionCheckDoneRef = useRef(false);

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

      // Fetch staff profile and join with brands table.
      // This project has seen two schemas in the wild:
      //  1) staff.user_id points to auth.users.id
      //  2) staff.id IS auth.users.id (no user_id column)
      let staff: any = null;
      let error: any = null;
      try {
        const res = await withTimeout(
          supabase
            .from('staff')
            .select('*, brands(*)')
            .eq('user_id', userId)
            .maybeSingle(),
          10000
        );
        staff = (res as any)?.data ?? null;
        error = (res as any)?.error ?? null;
      } catch (e) {
        error = e;
      }

      const msg = String((error as any)?.message ?? '');
      const code = String((error as any)?.code ?? '');
      const missingUserIdColumn = Boolean(
        error &&
          (
            code === '42703' ||
            (msg.toLowerCase().includes('user_id') && msg.toLowerCase().includes('does not exist'))
          )
      );

      if (missingUserIdColumn) {
        // Fallback schema: staff.id == auth user id.
        const res = await withTimeout(
          supabase
            .from('staff')
            .select('*, brands(*)')
            .eq('id', userId)
            .maybeSingle(),
          10000
        );
        staff = (res as any)?.data ?? null;
        error = (res as any)?.error ?? null;
      }

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
            if ((staff as any).user_id !== undefined && !staff.user_id) {
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
        // If the join didn't return a brand row but we do have a brand_id, fetch it explicitly.
        let nextBrand = (staff as any).brands || null;
        if (!nextBrand && (staff as any).brand_id) {
          try {
            const { data: brandRow } = await withTimeout(
              supabase.from('brands').select('*').eq('id', (staff as any).brand_id).maybeSingle(),
              12000
            );
            nextBrand = brandRow ?? null;
          } catch {
            // Network/RLS fallback: reuse cached brand payload (if any) so
            // activation state does not get lost to a partial object.
            const snap = loadAuthSnapshot(userId);
            const cachedBrand = (snap?.brand as any) ?? null;
            nextBrand = cachedBrand && cachedBrand.id === (staff as any).brand_id ? cachedBrand : null;
          }
        }

        const { data: sessionData } = await withTimeout(supabase.auth.getSession(), 8000);
        const authUser = (sessionData as any)?.session?.user ?? null;

        const nextAccountUser: AccountUser = {
          // Always use the authenticated user id as the account id.
          id: userId,
          name: staff.full_name ?? staff.display_name ?? staff.name ?? authUser?.user_metadata?.full_name ?? 'User',
          email: staff.email ?? authUser?.email ?? '',
          role: staff.role ?? 'owner',
          is_super_admin: (staff as any).is_super_admin ?? false,
          brand_id: staff.brand_id,
        };

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

        // Keep the authenticated account user separate from the POS/operator user.
        // By default, operator starts as the account user role.
        setAccountUser(nextAccountUser);
        setUser({
          id: nextAccountUser.id,
          name: nextAccountUser.name,
          email: nextAccountUser.email,
          role: normalizeRole(nextAccountUser.role),
          pin: undefined,
          isActive: true,
          brand_id: nextAccountUser.brand_id ?? (nextBrand?.id ?? null),
          createdAt: undefined,
        });
        setBrand(nextBrand);
        setBrandIsActive(resolveBrandIsActive(nextBrand));
        try {
          const targetBrandId = String(nextAccountUser.brand_id ?? (nextBrand?.id ?? '')).trim();
          if (targetBrandId) localStorage.setItem(`${OPERATOR_KEY_PREFIX}${targetBrandId}`, String(nextAccountUser.id));
        } catch {
          // ignore
        }
        setActiveUserId(userId);
        saveAuthSnapshot({
          v: 1,
          userId,
          cachedAt: Date.now(),
          user: nextAccountUser as any,
          brand: nextBrand
            ? {
                id: nextBrand.id ?? null,
                name: nextBrand.name ?? null,
                primary_color_hex: (nextBrand as any).primary_color_hex ?? null,
                is_active: resolveBrandIsActive(nextBrand),
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
    // Only used as a last-resort escape hatch; do not flip the app into "logged out"
    // while we're still determining whether a Supabase session exists.
    timeoutId = setTimeout(() => {
      if (!sessionCheckDoneRef.current) {
        setLoading(false);
        setProfileReady(true);
      }
    }, 12000);

    // 1. Check active session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;

      const userId = session?.user?.id ?? null;
      sessionCheckDoneRef.current = true;
      if (!userId) {
        // No authenticated session — try restoring a staff POS session.
        const restored = loadStaffSession();
        if (restored?.staff && restored?.brand) {
          setAccountUser(null);
          setUser(restored.staff);
          setBrand(restored.brand);
          setBrandIsActive(resolveBrandIsActive(restored.brand));
          setOperatorPin(restored.operatorPin ?? null);
          setLoading(false);
          setProfileReady(true);
          return;
        }

        setActiveUserId(null);
        setUser(null);
        setAccountUser(null);
        setBrand(null);
        setBrandIsActive(true);
        setOperatorPin(null);
        setLoading(false);
        setProfileReady(true);
        return;
      }

      hadSupabaseSessionRef.current = true;

      setActiveUserId(userId);

      // Fast-path: hydrate from local snapshot for this specific session user.
      const snap = loadAuthSnapshot(userId);
      if (snap?.user) {
        // Snapshot stores the account user; operator will be restored from local operator key.
        const acct = snap.user as any;
        setAccountUser(acct);
        const brandData = snap.brand ?? (acct?.brand_id ? ({ id: acct.brand_id } as any) : null);
        setBrand(brandData as any);
        setBrandIsActive(resolveBrandIsActive(brandData));
        setOperatorPin(null);
        // IMPORTANT: also hydrate the active operator immediately so the app doesn't
        // briefly render the public Landing screen before the background refresh completes.
        setUser({
          id: String(acct.id ?? userId),
          name: String(acct.name ?? 'User'),
          email: String(acct.email ?? ''),
          role: normalizeRole(acct.role),
          pin: undefined,
          isActive: true,
          brand_id: acct.brand_id ?? ((snap.brand as any)?.id ?? null),
          createdAt: undefined,
        });
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
        hadSupabaseSessionRef.current = true;
        setActiveUserId(userId);
        setProfileReady(false);
        setOperatorPin(null);
        clearStaffSession();

        const snap = loadAuthSnapshot(userId);
        if (snap?.user) {
          const acct = snap.user as any;
          setAccountUser(acct);
          const brandData = snap.brand ?? (acct?.brand_id ? ({ id: acct.brand_id } as any) : null);
          setBrand(brandData as any);
          setBrandIsActive(resolveBrandIsActive(brandData));
          setUser({
            id: String(acct.id ?? userId),
            name: String(acct.name ?? 'User'),
            email: String(acct.email ?? ''),
            role: normalizeRole(acct.role),
            pin: undefined,
            isActive: true,
            brand_id: acct.brand_id ?? ((snap.brand as any)?.id ?? null),
            createdAt: undefined,
          });
          try {
            const targetBrandId = String(acct.brand_id ?? ((snap.brand as any)?.id ?? '')).trim();
            if (targetBrandId) localStorage.setItem(`${OPERATOR_KEY_PREFIX}${targetBrandId}`, String(acct.id ?? userId));
          } catch {
            // ignore
          }
          setLoading(false);
        }

        await fetchProfileAndBrand(userId);
      } else if (event === 'SIGNED_OUT') {
        // Ignore initial SIGNED_OUT during boot when we never had a Supabase session.
        // This avoids wiping locally-restored staff sessions on reload.
        if (!hadSupabaseSessionRef.current) return;

        setUser(null);
        setAccountUser(null);
        setBrand(null);
        setBrandIsActive(true);
        setOperatorPin(null);
        setLoading(false);
        setProfileReady(true);
        setActiveUserId(null);
        clearAuthRelatedAppCaches();
        clearStaffSession();
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
        if (!brand?.id) {
          setAllUsers([]);
          return;
        }

        const { data, error } = await supabase
          .from('under_brand_staff')
          .select('*')
          .eq('brand_id', brand.id)
          .order('created_at', { ascending: false });

        if (!error && data) {
          const list = (data as any[]).map(mapUnderBrandStaffRow);
          setAllUsers(list);

          // Restore previously selected operator for this brand, if any.
          try {
            const rawId = localStorage.getItem(`${OPERATOR_KEY_PREFIX}${brand.id}`);
            const operatorId = rawId ? String(rawId) : null;
            const canAutoRestoreOperator = !accountUser && Boolean(operatorPin);
            if (operatorId && canAutoRestoreOperator) {
              const match = list.find((u) => u.id === operatorId);
              if (match) setUser(match);
            }
          } catch {
            // ignore
          }
        }
      } catch (e) {
        // ignore
      }
    })();
  }, [brand, accountUser, operatorPin]);

  const operatorUsers: BrandStaffUser[] = React.useMemo(() => {
    // Ensure current operator is always present in the list (even when unauthenticated)
    // so the header dropdown doesn't break.
    const current = user ? [user] : [];

    const acct = accountUser && (brand?.id || accountUser.brand_id) ? {
      id: accountUser.id,
      name: `${accountUser.name} (Admin)`,
      email: accountUser.email,
      role: normalizeRole(accountUser.role),
      pin: undefined,
      isActive: true,
      brand_id: accountUser.brand_id ?? (brand?.id ?? null),
      createdAt: undefined,
    } : null;
    const list = acct ? [acct, ...allUsers] : allUsers;

    // Merge unique by id, preserving order: current -> list
    const seen = new Set<string>();
    const merged: BrandStaffUser[] = [];
    for (const u of [...current, ...list]) {
      if (!u?.id) continue;
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      merged.push(u);
    }
    return merged;
  }, [accountUser, allUsers, brand?.id, user]);

  const switchUser = (operatorId: string) => {
    if (!operatorId) return;

    // Switch back to admin/operator
    if (accountUser && operatorId === accountUser.id) {
      const next: BrandStaffUser = {
        id: accountUser.id,
        name: accountUser.name,
        email: accountUser.email,
        role: normalizeRole(accountUser.role),
        pin: undefined,
        isActive: true,
        brand_id: accountUser.brand_id ?? (brand?.id ?? null),
        createdAt: undefined,
      };
      setUser(next);
      try {
        if (brand?.id) localStorage.setItem(`${OPERATOR_KEY_PREFIX}${brand.id}`, operatorId);
      } catch {
        // ignore
      }
      return;
    }

    const match = allUsers.find((u) => u.id === operatorId);
    if (!match) return;
    setUser(match);
    try {
      if (brand?.id) localStorage.setItem(`${OPERATOR_KEY_PREFIX}${brand.id}`, operatorId);
    } catch {
      // ignore
    }
  };

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

  const staffLogin = async (email: string, pin: string) => {
    if (!supabase) return { ok: false, message: 'Supabase not configured' };
    const cleanEmail = email.trim();
    const cleanPin = pin.trim();
    if (!cleanEmail) return { ok: false, message: 'Enter your staff email.' };
    if (!/^\d{4}$/.test(cleanPin)) return { ok: false, message: 'Enter your 4-digit PIN.' };

    try {
      const { data, error } = await withTimeout(
        supabase.rpc('under_brand_staff_login', { p_email: cleanEmail, p_pin: cleanPin }),
        15000
      );

      if (error) {
        console.error('staffLogin rpc error', error);
        return { ok: false, message: 'Unable to login right now. Please try again.' };
      }

      const row = Array.isArray(data) ? data[0] : (data as any);
      if (!row || !row.brand_id) {
        return {
          ok: false,
          message:
            'Your details did not match any brand staff. Ensure the admin added you to a brand and that your account is active.',
        };
      }

      // Fetch brand if possible, but do not block staff login if the lookup is not available.
      // Some deployments restrict direct brand selects; in that case we still let the staff user in
      // with a minimal brand stub so the POS can operate.
      let brandRow: any = null;
      try {
        const res = await withTimeout(
          supabase.from('brands').select('*').eq('id', row.brand_id).maybeSingle(),
          15000
        );
        brandRow = (res as any)?.data ?? null;
        const brandErr = (res as any)?.error ?? null;
        if (brandErr) {
          console.warn('staffLogin brand lookup warning', brandErr);
        }
      } catch (e) {
        console.warn('staffLogin brand lookup exception', e);
      }

      const nextBrand = brandRow ?? {
        id: String(row.brand_id),
        name: String(row.name ?? 'Brand'),
        primary_color_hex: null,
        is_active: true,
      };

      const staffUser: BrandStaffUser = {
        id: String(row.id),
        name: String(row.name ?? ''),
        email: String(row.email ?? cleanEmail),
        role: normalizeRole(row.role),
        pin: undefined,
        isActive: true,
        brand_id: String(row.brand_id),
        createdAt: undefined,
      };

      setAccountUser(null);
      setUser(staffUser);
      setBrand(nextBrand);
      setBrandIsActive(resolveBrandIsActive(nextBrand));
      setOperatorPin(cleanPin);
      setLoading(false);
      setProfileReady(true);
      try {
        const targetBrandId = String((nextBrand as any)?.id ?? row.brand_id ?? '').trim();
        if (targetBrandId) localStorage.setItem(`${OPERATOR_KEY_PREFIX}${targetBrandId}`, String(staffUser.id));
      } catch {
        // ignore
      }

      saveStaffSession({ v: 1, staff: staffUser, brand: nextBrand, operatorPin: cleanPin, cachedAt: Date.now() });

      return { ok: true, role: staffUser.role };
    } catch (e: any) {
      console.error('staffLogin unexpected', e);
      return { ok: false, message: e?.message ?? 'Login failed' };
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
      // Clear local auth state immediately so the UI returns to the landing page
      // without waiting for the network round trip to Supabase.
      clearAuthRelatedAppCaches();
      setActiveUserId(null);
      setUser(null);
      setAccountUser(null);
      setBrand(null);
      setBrandIsActive(true);
      setAllUsers([]);
      setOperatorPin(null);
      clearStaffSession();

      // Sign out remotely in the background.
      void supabase?.auth.signOut().catch((err) => {
        console.warn('logout signOut warning', err);
      });
    } finally {
      // no-op; state is already cleared above
    }
  };

  // Staff admin CRUD helpers
  const createUser = async (newUser: any) => {
    try {
      if (!supabase) throw new Error('Supabase not configured');
      if (!brand?.id) throw new Error('No active brand');

      const pin = String(newUser.pin ?? '').trim();
      if (!pin) throw new Error('PIN is required');

      const requestedRole = String(newUser.role ?? 'cashier');
      const safeRole: UserRole = isAssignableStaffRole(requestedRole) ? requestedRole : 'cashier';

      const row = {
        brand_id: brand.id,
        name: String(newUser.name ?? '').trim(),
        email: String(newUser.email ?? '').trim(),
        role: safeRole,
        pin,
        is_active: newUser.isActive ?? true,
      } as any;

      if (supabase) {
        const { data, error } = await supabase.from('under_brand_staff').insert(row).select().limit(1);
        if (error) throw error;
        if (data && data[0]) {
          const created = mapUnderBrandStaffRow(data[0]);
          setAllUsers((prev) => [created, ...prev]);
          return created;
        }
      }
      throw new Error('Failed to create staff user');
    } catch (e) {
      console.error('createUser error', e);
      throw e;
    }
  };

  const updateUser = async (userId: string, patch: any) => {
    try {
      if (!supabase) return;

      const dbPatch: any = {};
      if (patch.name !== undefined) dbPatch.name = String(patch.name).trim();
      if (patch.email !== undefined) dbPatch.email = String(patch.email).trim();
      if (patch.role !== undefined) {
        const requestedRole = String(patch.role ?? '');
        dbPatch.role = isAssignableStaffRole(requestedRole) ? requestedRole : 'cashier';
      }
      if (patch.pin !== undefined) dbPatch.pin = String(patch.pin).trim();
      if (patch.isActive !== undefined) dbPatch.is_active = Boolean(patch.isActive);

      const { data, error } = await supabase
        .from('under_brand_staff')
        .update(dbPatch)
        .eq('id', userId)
        .select()
        .limit(1);

      if (error) throw error;
      if (data && data[0]) {
        const updated = mapUnderBrandStaffRow(data[0]);
        setAllUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
      }
    } catch (e) {
      console.error('updateUser error', e);
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      if (!supabase) return;
      const { error } = await supabase.from('under_brand_staff').delete().eq('id', userId);
      if (!error) setAllUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch (e) {
      console.error('deleteUser error', e);
    }
  };

  const hasPermission = (perm: string) => {
    if (!user) return false;
    const perms = ROLE_PERMISSIONS[user.role] as RolePermissions | undefined;
    if (!perms) return false;
    const key = perm as keyof RolePermissions;
    return Boolean(perms[key]);
  };

  const refreshProfile = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const authUser = (data as any)?.session?.user ?? null;
      if (authUser) {
        await fetchProfileAndBrand(authUser.id);
      } else {
        setProfileReady(true);
      }
    } catch (err) {
      console.error('refreshProfile error', err);
      setProfileReady(true);
    }
  };

  // Keep an in-memory active brand id for fast brand-scoped stores.
  // This avoids repeated localStorage reads and prevents cross-brand data bleed.
  const activeBrandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  useEffect(() => {
    setActiveBrandId(activeBrandId || null);
  }, [activeBrandId]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      accountUser,
      brand,
      brandIsActive,
      operatorPin,
      loading, 
      profileReady,
      isAuthenticated: !!user, 
      signInWithGoogle,
      signUp,
      login,
      staffLogin,
      logout,
      refreshProfile,
      allUsers,
      operatorUsers,
      switchUser,
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