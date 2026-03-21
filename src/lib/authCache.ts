export type AuthCacheSnapshot = {
  v: 1;
  userId: string;
  cachedAt: number;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    is_super_admin: boolean;
    brand_id?: string | null;
  };
  brand: {
    id?: string | null;
    name?: string | null;
    primary_color_hex?: string | null;
  } | null;
};

const SNAPSHOT_PREFIX = 'pmx.auth.cache.v1.';
const ACTIVE_USER_ID_KEY = 'pmx.auth.activeUserId.v1';

export function setActiveUserId(userId: string | null) {
  try {
    if (userId) localStorage.setItem(ACTIVE_USER_ID_KEY, userId);
    else localStorage.removeItem(ACTIVE_USER_ID_KEY);
  } catch {
    // ignore
  }
}

export function getActiveUserId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_USER_ID_KEY);
  } catch {
    return null;
  }
}

export function loadAuthSnapshot(userId: string): AuthCacheSnapshot | null {
  try {
    const raw = localStorage.getItem(`${SNAPSHOT_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthCacheSnapshot>;
    if (parsed.v !== 1) return null;
    if (!parsed.userId || parsed.userId !== userId) return null;
    if (!parsed.user || typeof parsed.user.email !== 'string') return null;
    return parsed as AuthCacheSnapshot;
  } catch {
    return null;
  }
}

export function saveAuthSnapshot(snapshot: AuthCacheSnapshot) {
  try {
    localStorage.setItem(`${SNAPSHOT_PREFIX}${snapshot.userId}`, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export function getCachedBrandId(): string | null {
  const userId = getActiveUserId();
  if (!userId) return null;
  const snap = loadAuthSnapshot(userId);
  return snap?.user?.brand_id ?? null;
}

export function clearAllAuthSnapshots() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }

    for (const k of keys) {
      if (k === ACTIVE_USER_ID_KEY || k.startsWith(SNAPSHOT_PREFIX)) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}

export function clearAuthRelatedAppCaches() {
  clearAllAuthSnapshots();
  try {
    localStorage.removeItem('pmx.companySettings.v1');
  } catch {
    // ignore
  }
}
