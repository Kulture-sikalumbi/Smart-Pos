import type { Table, TableSection, TableStatus } from '@/types/pos';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';

type Listener = () => void;
const listeners = new Set<Listener>();

type TablesState = {
  brandId: string | null;
  tables: Table[];
  loaded: boolean;
  error?: string | null;
};

let state: TablesState = {
  brandId: getActiveBrandId(),
  tables: [],
  loaded: false,
  error: null,
};

function emit() {
  for (const l of listeners) l();
}

const useRemote = isSupabaseConfigured() && supabase;
let wiredRealtime = false;
let realtimeCleanup: (() => void) | null = null;

function normalizeStatus(raw: any): TableStatus {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'available' || s === 'occupied' || s === 'reserved' || s === 'dirty') return s;
  return 'available';
}

export async function refreshRestaurantTables() {
  const brandId = getActiveBrandId();
  state = { ...state, brandId, loaded: false, error: null };
  emit();

  if (!useRemote || !brandId) {
    state = { ...state, brandId, tables: [], loaded: true, error: !brandId ? 'missing_brand' : 'no_remote' };
    emit();
    return;
  }

  try {
    const { data, error } = await supabase!
      .from('restaurant_tables')
      .select('id, brand_id, table_no, name, section, seats, status, is_active')
      .eq('brand_id', brandId)
      .eq('is_active', true)
      .order('table_no', { ascending: true });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const tables: Table[] = rows.map((r: any) => ({
      id: String(r.id),
      number: Number(r.table_no),
      name: r.name ?? undefined,
      seats: Number(r.seats ?? 4),
      status: normalizeStatus(r.status),
      section: r.section ?? undefined,
      // currentOrderId is computed in UI from orders; keep undefined here.
    }));
    state = { ...state, brandId, tables, loaded: true, error: null };
    emit();
  } catch (e: any) {
    state = { ...state, brandId, tables: [], loaded: true, error: e?.message ?? 'load_failed' };
    emit();
  }
}

export function getRestaurantTablesSnapshot() {
  return state;
}

export function subscribeRestaurantTables(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRestaurantTableSections(): TableSection[] {
  const tables = state.tables;
  return [
    {
      id: 'main',
      name: 'Tables',
      tables: tables.slice().sort((a, b) => a.number - b.number),
    },
  ];
}

function ensureRealtimeWired() {
  if (!useRemote || wiredRealtime) return;
  const brandId = getActiveBrandId();
  if (!brandId) return;
  wiredRealtime = true;

  const channelName = `restaurant_tables.${brandId}`;
  const channel = (supabase as any).channel(channelName);

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'restaurant_tables', filter: `brand_id=eq.${brandId}` },
    async () => {
      await refreshRestaurantTables();
    }
  );

  channel.subscribe();
  realtimeCleanup = () => {
    try {
      if ((supabase as any).removeChannel) (supabase as any).removeChannel(channel);
    } catch {
      // ignore
    }
  };
}

// Auto-refresh and reset on brand changes.
subscribeActiveBrandId(() => {
  state = { ...state, brandId: getActiveBrandId(), tables: [], loaded: false, error: null };
  wiredRealtime = false;
  if (realtimeCleanup) {
    try {
      realtimeCleanup();
    } catch {
      // ignore
    }
  }
  realtimeCleanup = null;
  emit();
  void refreshRestaurantTables();
});

export function initRestaurantTables() {
  ensureRealtimeWired();
  void refreshRestaurantTables();
}

