import type { StockIssue } from '@/types';
// no local mock seeding for stock issues; rely on DB-backed data
import { getStockItemById } from '@/lib/stockStore';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';
import { pushDebug } from '@/lib/debugLog';

const STORAGE_KEY = 'mthunzi.stockIssues.v2';

type StockIssueStateV1 = {
  version: 1;
  issues: StockIssue[];
};

type Listener = () => void;
const listeners = new Set<Listener>();
const loadingListeners = new Set<Listener>();
let cached: StockIssueStateV1 | null = null;
let currentBrandId: string | null = getActiveBrandId();
let isFetching = false;

// Reset cached issues when brand changes
subscribeActiveBrandId(() => {
  currentBrandId = getActiveBrandId();
  cached = null;
  emit();
});

function emit() {
  for (const l of listeners) l();
}

function emitLoading() {
  for (const l of loadingListeners) l();
}

function load(): StockIssueStateV1 {
  if (cached) return cached;

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StockIssueStateV1>;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.issues)) {
        cached = { version: 1, issues: parsed.issues as StockIssue[] };
        return cached;
      }
    } catch {
      // ignore
    }
  }

  // Default to empty list (do not seed with mock data). Real data will be loaded from Supabase.
  cached = { version: 1, issues: [] };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cached)); } catch {}
  return cached;
}

// Ensure the remote-backed snapshot is loaded. Returns when initial fetch completes.
export async function ensureStockIssuesLoaded() {
  try {
    if (isSupabaseConfigured() && supabase) {
      const brandId = currentBrandId ?? getActiveBrandId();
      if (!brandId) return;
      await fetchFromDb();
    } else {
      // no supabase configured: keep local snapshot (empty)
      return;
    }
  } catch (e) {
    try { pushDebug('[stockIssueStore] ensureStockIssuesLoaded error: ' + String(e)); } catch {}
  }
}

function save(state: StockIssueStateV1) {
  cached = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  emit();
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function subscribeStockIssues(listener: Listener) {
  listeners.add(listener);
  // lazy init from Supabase on first subscriber
  try {
    if (isSupabaseConfigured() && supabase) {
      // fetch remote rows for current brand
      void fetchFromDb();
    }
  } catch {}
  return () => listeners.delete(listener);
}

export function subscribeStockIssuesLoading(listener: Listener) {
  loadingListeners.add(listener);
  try {
    if (isSupabaseConfigured() && supabase) {
      // ensure a fetch is triggered so loading state is emitted
      void fetchFromDb();
    }
  } catch {}
  return () => loadingListeners.delete(listener);
}

export function getStockIssuesLoadingSnapshot() {
  return isFetching;
}

export function getStockIssuesSnapshot(): StockIssue[] {
  return load().issues;
}

function nextIssueNo(existing: StockIssue[]) {
  const max = existing.reduce((m, i) => Math.max(m, Number.isFinite(i.issueNo) ? i.issueNo : 0), 0);
  return max > 0 ? max + 1 : 200;
}

async function fetchFromDb() {
  if (!isSupabaseConfigured() || !supabase) return;
  try {
    // indicate loading and notify subscribers
    isFetching = true;
    emitLoading();

    const brandId = currentBrandId;
    if (!brandId) return;
    const { data, error } = await supabase.from('stock_issues').select('*').eq('brand_id', brandId).order('created_at', { ascending: false }).limit(500);
    if (error) {
      try { pushDebug('[stockIssueStore] fetchFromDb error: ' + String(error)); } catch {}
      return;
    }
    if (!data) return;
    const rows: StockIssue[] = (data as any[]).map((r) => ({
      id: String(r.id),
      date: String(r.date ?? ''),
      issueNo: Number.isFinite(r.issue_no ?? r.issueNo) ? Number(r.issue_no ?? r.issueNo) : undefined,
      stockItemId: String(r.stock_item_id ?? r.stockItemId ?? ''),
      issueType: String(r.issue_type ?? r.issueType ?? 'Wastage') as any,
      qtyIssued: Number(r.qty_issued ?? r.qtyIssued ?? 0),
      unitCostAtTime: Number(r.unit_cost_at_time ?? r.unitCostAtTime ?? 0),
      totalValueLost: Number(r.total_value_lost ?? r.totalValueLost ?? 0),
      notes: r.notes ?? null,
      createdBy: r.created_by ?? r.createdBy ?? null,
      createdAt: r.created_at ?? r.createdAt ?? undefined,
    }));

    cached = { version: 1, issues: rows };
    emit();
  } catch (e) {
    try { pushDebug('[stockIssueStore] fetchFromDb exception: ' + String(e)); } catch {}
  }
  finally {
    isFetching = false;
    emitLoading();
  }
}

export class StockIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockIssueError';
  }
}

export async function createStockIssue(params: {
  brandId?: string | null;
  date: string; // YYYY-MM-DD
  createdBy: string;
  // Accept either UI-shaped lines or DB-shaped lines. UI: { stockItemId, issueType, qtyIssued, unitCostAtTime, notes }
  // DB: { stock_item_id, issue_type, qty_issued, unit_cost_at_time, total_value_lost, notes }
  lines: Array<
    | { stockItemId: string; issueType: StockIssue['issueType']; qtyIssued: number; unitCostAtTime?: number; notes?: string | null }
    | { stock_item_id: string; issue_type?: string; qty_issued: number; unit_cost_at_time?: number; total_value_lost?: number; notes?: string | null }
  >;
}) {
  // Capture active brand immediately to avoid later races.
  const activeBrandAtStart = getActiveBrandId();
  // Determine final brandId early and fail fast if absent to avoid network calls.
  const resolvedBrandId = params.brandId ?? activeBrandAtStart ?? null;
  if (!resolvedBrandId) throw new StockIssueError('No Active Brand Selected');

  const state = load();

  const lines = params.lines
    .map((l: any) => {
      // Support both UI-shaped and DB-shaped incoming lines
      const stockItemId = l.stockItemId ?? l.stock_item_id ?? '';
      const issueType = (l.issueType ?? l.issue_type ?? 'Wastage') as StockIssue['issueType'];
      const qtyIssued = Number.isFinite(l.qtyIssued ?? l.qty_issued) ? (l.qtyIssued ?? l.qty_issued) : 0;
      const unitCostAtTime = Number.isFinite(l.unitCostAtTime ?? l.unit_cost_at_time) ? (l.unitCostAtTime ?? l.unit_cost_at_time) : undefined;
      const notes = l.notes ?? null;
      const totalValueProvided = Number.isFinite(l.totalValueLost ?? l.total_value_lost) ? (l.totalValueLost ?? l.total_value_lost) : undefined;

      return {
        stockItemId,
        issueType,
        qtyIssued,
        unitCostAtTime,
        notes,
        totalValueProvided,
      };
    })
    .filter((l: any) => l.stockItemId && l.qtyIssued > 0);

  if (!lines.length) throw new StockIssueError('Add at least one issue line with quantity.');

  // validate and build createdLines
  const createdLines: StockIssue[] = lines.map((l) => {
    const item = getStockItemById(l.stockItemId);
    if (!item) throw new StockIssueError('Selected stock item not found.');
    if ((l.issueType === 'Theft' || l.issueType === 'Damage') && (!l.notes || !String(l.notes).trim())) {
      throw new StockIssueError('Notes are required for Theft or Damage.');
    }

    const unitCost = typeof l.unitCostAtTime === 'number' ? l.unitCostAtTime : item.currentCost ?? 0;
    const totalValue = typeof l.totalValueProvided === 'number' ? round2(l.totalValueProvided) : round2(l.qtyIssued * unitCost);

    return {
      id: `iss-${crypto.randomUUID()}`,
      date: params.date,
      stockItemId: l.stockItemId,
      issueType: l.issueType,
      qtyIssued: round2(l.qtyIssued),
      unitCostAtTime: round2(unitCost),
      totalValueLost: totalValue,
      notes: l.notes ?? null,
      createdBy: params.createdBy || null,
      createdAt: new Date().toISOString(),
    };
  });

  // Prefer using the DB RPC `process_stock_issue` (security-definer) which atomically
  // updates `stock_items` and inserts `stock_issues`. This avoids making multiple
  // PATCH requests to `stock_items` which can be rejected with 403 if the client
  // lacks direct UPDATE privileges. If the RPC is not permitted, fall back to the
  // previous direct-update approach.
  if (isSupabaseConfigured() && supabase) {
    // Use the resolved brand id determined at function start.
    const brandId = resolvedBrandId as string;

    const rpcLines = createdLines.map((cl) => ({
      id: cl.id,
      brand_id: brandId,
      stock_item_id: cl.stockItemId,
      issue_type: cl.issueType,
      qty_issued: cl.qtyIssued,
      unit_cost_at_time: cl.unitCostAtTime,
      total_value_lost: cl.totalValueLost,
      notes: cl.notes,
    }));

    // Try RPC first. If the RPC fails for any reason we surface the error
    // (do not fall back to manual direct-updates which will also be rejected
    // when the client lacks UPDATE privileges). This ensures the UI sees a
    // clear permission problem instead of repeatedly attempting forbidden
    // PATCH requests.
    try {
      const { error: rpcErr } = await supabase.rpc('process_stock_issue', {
        p_brand_id: brandId,
        p_date: params.date,
        p_created_by: params.createdBy,
        p_lines: rpcLines,
      } as any);

      if (!rpcErr) {
        try { await fetchFromDb(); } catch {}
        return { lines: createdLines };
      }

      try { pushDebug('[stockIssueStore] rpc process_stock_issue error: ' + String(rpcErr)); } catch {}
      const msg = String(rpcErr.message ?? rpcErr ?? 'Unknown RPC error');
      throw new StockIssueError(msg);
    } catch (e) {
      try { pushDebug('[stockIssueStore] rpc process_stock_issue threw: ' + String(e)); } catch {}
      if (e instanceof StockIssueError) throw e;
      throw new StockIssueError(String(e));
    }
  }

  // If Supabase is not configured, persist locally (offline mode)
  save({ ...state, issues: [...createdLines, ...state.issues] });
  return { lines: createdLines };
}

export function deleteStockIssueLine(issueLineId: string) {
  const state = load();
  save({ ...state, issues: state.issues.filter((i) => i.id !== issueLineId) });
}

export function resetStockIssuesToSeed() {
  // Clear to empty (no mock seed)
  save({ version: 1, issues: [] });
}
