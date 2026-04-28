import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';

type Listener = () => void;

export type FrontStockRow = {
  id: string;
  brandId: string;
  itemId: string;
  menuItemId?: string;
  producedCode?: string;
  producedName?: string;
  locationTag: string;
  quantity: number;
  unit: string;
  reorderLevel?: number;
  updatedAt: string | null;
  itemCode?: string;
  itemName?: string;
};

const STORAGE_KEY = 'mthunzi.frontStock.v1';

function storageKeyForBrand(brandId: string | null) {
  return `${STORAGE_KEY}.${brandId ? String(brandId) : 'none'}`;
}

let listeners: Listener[] = [];
let state: FrontStockRow[] | null = null;
let initialized = false;
let realtimeUnsub: (() => void) | null = null;
let focusWired = false;
let currentBrandId: string | null = getActiveBrandId();
const STAFF_SESSION_KEY = 'pmx.staff.session.v1';

function getStoredStaffCredentials(): { email: string; pin: string } | null {
  try {
    const raw = localStorage.getItem(STAFF_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    const email = String(parsed?.staff?.email ?? '').trim();
    const pin = String(parsed?.operatorPin ?? '').trim();
    if (!email || !/^\d{4}$/.test(pin)) return null;
    return { email, pin };
  } catch {
    return null;
  }
}

function mapFrontRows(frontRows: any[]): FrontStockRow[] {
  return (frontRows ?? []).map((r: any) => ({
    id: String(r.id),
    brandId: String(r.brand_id),
    itemId: r.item_id ? String(r.item_id) : '',
    producedCode: r.produced_code ? String(r.produced_code) : undefined,
    producedName: r.produced_name ? String(r.produced_name) : undefined,
    locationTag: String(r.location_tag),
    quantity: typeof r.quantity === 'number' ? r.quantity : parseFloat(r.quantity ?? 0) || 0,
    unit: String(r.unit ?? ''),
    reorderLevel: r.reorder_level === null || r.reorder_level === undefined ? undefined : (typeof r.reorder_level === 'number' ? r.reorder_level : parseFloat(r.reorder_level) || 0),
    updatedAt: r.updated_at ? String(r.updated_at) : null,
    itemName: r.item_name ? String(r.item_name) : (r.produced_name ? String(r.produced_name) : undefined),
    itemCode: r.item_code ? String(r.item_code) : (r.produced_code ? String(r.produced_code) : undefined),
  })) as FrontStockRow[];
}

subscribeActiveBrandId(() => {
  currentBrandId = getActiveBrandId();
  state = null;
  initialized = false;
  try { realtimeUnsub?.(); } catch {}
  realtimeUnsub = null;
  focusWired = false;
  emit();
});

function emit() {
  for (const l of listeners) l();
}

function persist(next: FrontStockRow[]) {
  try {
    localStorage.setItem(storageKeyForBrand(currentBrandId), JSON.stringify(next));
  } catch {
    // ignore
  }
}

function load(): FrontStockRow[] {
  if (state) return state;
  try {
    const raw = localStorage.getItem(storageKeyForBrand(currentBrandId));
    if (raw) {
      const parsed = JSON.parse(raw) as FrontStockRow[];
      if (Array.isArray(parsed)) {
        state = parsed;
        return state;
      }
    }
  } catch {
    // ignore
  }
  state = [];
  persist(state);
  return state;
}

async function fetchFromDb() {
  if (!isSupabaseConfigured() || !supabase) return;
  try {
    const brandId = currentBrandId;
    if (!brandId) {
      state = [];
      persist(state);
      emit();
      return;
    }

    const staffCreds = getStoredStaffCredentials();
    let rows: FrontStockRow[] = [];

    if (staffCreds) {
      const { data: staffRows, error: staffErr } = await supabase.rpc('get_front_stock_snapshot_for_staff', {
        p_email: staffCreds.email,
        p_pin: staffCreds.pin,
      });
      if (staffErr) {
        console.warn('[frontStockStore] staff snapshot rpc failed', staffErr);
      } else {
        rows = mapFrontRows(Array.isArray(staffRows) ? staffRows : []);
      }
    }

    if (!rows.length) {
      const { data: frontRows, error: frontErr } = await supabase
        .from('front_stock')
        .select('id, brand_id, item_id, produced_code, produced_name, location_tag, quantity, unit, reorder_level, updated_at')
        .eq('brand_id', brandId);

      if (frontErr) {
        console.warn('[frontStockStore] failed to fetch front_stock', frontErr);
        return;
      }

      rows = mapFrontRows(Array.isArray(frontRows) ? frontRows : []);
    }

    // Join item name/code via a second query to avoid relying on relationship names.
    const itemIds = Array.from(new Set(rows.map((r) => r.itemId))).filter(Boolean);
    if (itemIds.length && rows.some((r) => !r.itemCode || !r.itemName)) {
      const { data: items, error: itemsErr } = await supabase
        .from('stock_items')
        .select('id, item_code, name')
        .eq('brand_id', brandId)
        .in('id', itemIds);

      if (!itemsErr && items) {
        const byId = new Map<string, { code: string; name: string }>();
        for (const it of items as any[]) {
          byId.set(String(it.id), { code: String(it.item_code ?? ''), name: String(it.name ?? '') });
        }
        for (const r of rows) {
          const m = byId.get(r.itemId);
          if (m) {
            r.itemCode = m.code;
            r.itemName = m.name;
          }
        }
      }
    }

    state = rows;
    persist(state);
    emit();
  } catch (e) {
    console.warn('[frontStockStore] unexpected error', e);
  }
}

export async function refreshFrontStock() {
  await fetchFromDb();
}

export function subscribeFrontStock(listener: Listener) {
  listeners = [...listeners, listener];
  if (!initialized) {
    initialized = true;
    if (isSupabaseConfigured() && supabase && currentBrandId) void fetchFromDb();
    // Keep front_stock fresh globally (not just on the FrontOfficeStock page).
    try {
      realtimeUnsub = subscribeToRealtimeFrontStock();
    } catch {
      realtimeUnsub = null;
    }
    // Refresh when tab regains focus/visibility to avoid stale localStorage snapshots.
    if (!focusWired && typeof window !== 'undefined') {
      focusWired = true;
      const onVisibilityOrFocus = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void fetchFromDb();
      };
      window.addEventListener('focus', onVisibilityOrFocus);
      try { document.addEventListener('visibilitychange', onVisibilityOrFocus); } catch {}
    }
  }
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getFrontStockSnapshot(): FrontStockRow[] {
  return load();
}

export function subscribeToRealtimeFrontStock(): (() => void) | null {
  try {
    if (!isSupabaseConfigured() || !supabase) return null;
    const brandId = currentBrandId;
    if (!brandId) return null;
    const channel = (supabase as any).channel(`front-stock.${brandId}`);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'front_stock', filter: `brand_id=eq.${brandId}` },
      async () => {
        try {
          await fetchFromDb();
        } catch (e) {
          console.warn('[frontStockStore] realtime handler failed', e);
        }
      }
    );
    channel.subscribe();
    return () => {
      try {
        if ((supabase as any).removeChannel) (supabase as any).removeChannel(channel);
      } catch {
        // ignore
      }
    };
  } catch (e) {
    console.warn('[frontStockStore] subscribeToRealtimeFrontStock failed', e);
    return null;
  }
}

