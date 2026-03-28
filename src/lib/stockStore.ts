import type { StockItem } from '@/types';
import { stockItems as seededStockItems } from '@/data/mockData';
import type { BatchProduction, Recipe } from '@/types';
import { getPosMenuItems, upsertPosMenuItem } from '@/lib/posMenuStore';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';

const STORAGE_KEY = 'mthunzi.stockItems.v1';

function storageKeyForBrand(brandId: string | null) {
  return `${STORAGE_KEY}.${brandId ? String(brandId) : 'none'}`;
}

type Listener = () => void;

let listeners: Listener[] = [];
let state: StockItem[] | null = null;
let initialized = false;
let currentBrandId: string | null = getActiveBrandId();

// Reset cached state on brand change to prevent cross-brand bleed.
subscribeActiveBrandId(() => {
  currentBrandId = getActiveBrandId();
  state = null;
  initialized = false;
  emit();
});

function emit() {
  for (const l of listeners) l();
}

function persist(next: StockItem[]) {
  try {
    localStorage.setItem(storageKeyForBrand(currentBrandId), JSON.stringify(next));
  } catch {
    // ignore
  }
}

function load(): StockItem[] {
  if (state) return state;

  try {
    const raw = localStorage.getItem(storageKeyForBrand(currentBrandId));
    if (raw) {
      const parsed = JSON.parse(raw) as StockItem[];
      if (Array.isArray(parsed)) {
        state = parsed;
        return state;
      }
    }
  } catch {
    // ignore
  }

  state = seededStockItems.map(s => ({ ...s }));
  persist(state);
  return state;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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

    const { data, error } = await supabase.from('stock_items').select('*').eq('brand_id', brandId);
    if (error) {
      console.warn('Failed to fetch stock_items from Supabase', error);
      return;
    }
    if (!data) return;
    // map to StockItem types and coerce numbers
    const items: StockItem[] = data.map((r: any) => ({
      id: r.id,
      code: String(r.item_code ?? r.code ?? r.itemCode ?? ''),
      name: String(r.name ?? ''),
      departmentId: r.department_id ?? r.departmentId ?? null,
      // Normalize textual unit values (e.g., 'g','ml','kg','l') into frontend UnitType
      unitType: (() => {
        const raw = String(r.unit ?? r.unit_type ?? r.unitType ?? '').trim();
        const u = raw.toLowerCase();
        if (u === 'g' || u === 'kg') return 'KG';
        if (u === 'ml' || u === 'l' || u === 'ltr' || u === 'ltrs') return 'LTRS';
        if (u === 'pack') return 'PACK';
        if (u === 'each' || u === '') return 'EACH';
        // If DB already stores a base UnitType like 'KG' or 'LTRS', preserve it
        const up = raw.toUpperCase();
        if (up === 'KG' || up === 'LTRS' || up === 'EACH' || up === 'PACK') return up as any;
        return 'EACH';
      })(),
      lowestCost: typeof r.lowest_cost === 'number' ? r.lowest_cost : (typeof r.lowestCost === 'number' ? r.lowestCost : parseFloat(r.lowest_cost ?? r.lowestCost ?? 0) || 0),
      highestCost: typeof r.highest_cost === 'number' ? r.highest_cost : (typeof r.highestCost === 'number' ? r.highestCost : parseFloat(r.highest_cost ?? r.highestCost ?? 0) || 0),
      currentCost: typeof r.current_cost === 'number' ? r.current_cost : (typeof r.cost_per_unit === 'number' ? r.cost_per_unit : parseFloat(r.current_cost ?? r.cost_per_unit ?? 0) || 0),
      currentStock: typeof r.current_stock === 'number' ? r.current_stock : parseFloat(r.current_stock ?? r.stock_quantity ?? 0) || 0,
      itemsPerPack: r.items_per_pack !== undefined && r.items_per_pack !== null
        ? Number(r.items_per_pack)
        : (r.itemsPerPack !== undefined && r.itemsPerPack !== null ? Number(r.itemsPerPack) : undefined),
      reorderLevel: r.reorder_level !== undefined ? (typeof r.reorder_level === 'number' ? r.reorder_level : parseFloat(r.reorder_level)) : (r.min_stock_level !== undefined ? (typeof r.min_stock_level === 'number' ? r.min_stock_level : parseFloat(r.min_stock_level)) : undefined),
      supplierId: r.supplier_id ?? r.supplierId ?? undefined,
    }));

    state = items;
    persist(state);
    emit();
  } catch (err) {
    console.warn('Error fetching inventory items', err);
  }
}

export function subscribeStockItems(listener: Listener) {
  listeners = [...listeners, listener];

  // lazy init from Supabase on first subscriber
  if (!initialized) {
    initialized = true;
    if (isSupabaseConfigured() && supabase) {
      // fetch once and populate
      if (currentBrandId) void fetchFromDb();
    }
  }

  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

export function getStockItemsSnapshot(): StockItem[] {
  return load();
}

export function getStockItemById(itemId: string): StockItem | undefined {
  return load().find(s => s.id === itemId);
}

export async function addStockItem(item: StockItem) {
  // Try supabase insert
  if (isSupabaseConfigured() && supabase) {
    const resolvedBrandId = (typeof (item as any).brandId === 'string' && (item as any).brandId)
      ? String((item as any).brandId)
      : currentBrandId;
    if (!resolvedBrandId) throw new Error('Missing brand id');

    // Keep payload aligned with the actual DB schema (snake_case columns).
    // NOTE: Some deployed DBs may not yet have `items_per_pack`; do not send it unless set.
    const payload: any = {
      id: item.id,
      // brand_id is nullable in schema but may be required by RLS in some deployments.
      brand_id: resolvedBrandId,
      item_code: item.code,
      name: item.name,
      department_id: item.departmentId ?? null,
      supplier_id: item.supplierId ?? null,
      // Prefer precise textual unit if provided (e.g., 'g','ml'); otherwise store base unitType.
      unit:
        (item as any).unitText && String((item as any).unitText).trim()
          ? String((item as any).unitText).trim()
          : item.unitType,
      current_stock: item.currentStock ?? 0,
      cost_per_unit: item.currentCost ?? 0,
      lowest_cost: item.lowestCost ?? 0,
      highest_cost: item.highestCost ?? 0,
      // Prefer reorder_level; also write min_stock_level for legacy compatibility.
      reorder_level: item.reorderLevel ?? null,
      min_stock_level: item.reorderLevel ?? null,
    };

    if (item.itemsPerPack !== undefined && item.itemsPerPack !== null) {
      payload.items_per_pack = item.itemsPerPack;
    }

    let error: any = null;
    ({ error } = await supabase.from('stock_items').insert(payload));

    // Backward compatibility: if the DB doesn't have `items_per_pack`, retry without it.
    if (error && String(error.code ?? '') === '42703' && String(error.message ?? '').toLowerCase().includes('items_per_pack')) {
      const { items_per_pack: _omit, ...retry } = payload;
      ({ error } = await supabase.from('stock_items').insert(retry as any));
    }

    if (error) {
      // Do not fall back to local when DB rejects the change; it will reappear/disappear on refresh.
      throw error;
    }

    // refresh local state
    await fetchFromDb();
    return item;
  }

  const items = load();
  const next = [...items, item];
  state = next;
  persist(next);
  emit();
  return item;
}

export async function updateStockItem(itemId: string, patch: Partial<StockItem>) {
  if (isSupabaseConfigured() && supabase) {
    if (!currentBrandId) throw new Error('Missing brand id');
    const payload: any = {};
    if (patch.code !== undefined) payload.item_code = patch.code;
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.unitType !== undefined) payload.unit = patch.unitType;
    if (patch.currentCost !== undefined) payload.cost_per_unit = patch.currentCost;
    if (patch.currentStock !== undefined) payload.current_stock = patch.currentStock;
    if (patch.lowestCost !== undefined) payload.lowest_cost = patch.lowestCost;
    if (patch.highestCost !== undefined) payload.highest_cost = patch.highestCost;
    if (patch.reorderLevel !== undefined) {
      payload.reorder_level = patch.reorderLevel;
      payload.min_stock_level = patch.reorderLevel;
    }
    if (patch.itemsPerPack !== undefined) payload.items_per_pack = patch.itemsPerPack;
    if (patch.supplierId !== undefined) payload.supplier_id = patch.supplierId;
    if (patch.departmentId !== undefined) payload.department_id = patch.departmentId;

    let error: any = null;
    ({ error } = await supabase.from('stock_items').update(payload).eq('id', itemId).eq('brand_id', currentBrandId));

    // Backward compatibility: if the DB doesn't have `items_per_pack`, retry without it.
    if (error && String(error.code ?? '') === '42703' && String(error.message ?? '').toLowerCase().includes('items_per_pack')) {
      const { items_per_pack: _omit, ...retry } = payload;
      ({ error } = await supabase.from('stock_items').update(retry as any).eq('id', itemId).eq('brand_id', currentBrandId));
    }
    if (error) {
      console.warn('Supabase update failed', error);
      throw error;
    }

    await fetchFromDb();
    return;
  }

  // Local-only mode (no Supabase)
  const existing = load();
  const next = existing.map((s) => (s.id === itemId ? { ...s, ...patch } : s));
  state = next;
  persist(next);
  emit();
}

export function upsertStockItem(item: StockItem) {
  // simple local upsert; for supabase callers should use addStockItem/updateStockItem
  const existing = load();
  const idx = existing.findIndex(s => s.id === item.id);
  const next = idx >= 0 ? existing.map(s => (s.id === item.id ? { ...s, ...item } : s)) : [item, ...existing];
  state = next;
  persist(next);
  emit();
}

export async function deleteStockItem(itemId: string) {
  // Try Supabase first
  if (isSupabaseConfigured() && supabase) {
    if (!currentBrandId) throw new Error('Missing brand id');
    const { error } = await supabase.from('stock_items').delete().eq('id', itemId).eq('brand_id', currentBrandId);
    if (error) {
      // Do not fall back to local when DB rejects the change; it will come back on refresh.
      throw error;
    }

    await fetchFromDb();
    return true;
  }

  // Fallback to local deletion
  const existing = load();
  const next = existing.filter(s => s.id !== itemId);
  state = next;
  persist(next);
  emit();
  return true;
}

export function applyStockTakeAdjustments(adjustments: Array<{ itemId: string; newQty: number }>) {
  if (!adjustments.length) return;
  const existing = load();
  const byId = new Map(existing.map((s) => [s.id, s] as const));

  let changed = false;
  for (const adj of adjustments) {
    const item = byId.get(adj.itemId);
    if (!item) continue;
    const nextQty = Number.isFinite(adj.newQty) ? adj.newQty : item.currentStock;
    if (!Number.isFinite(nextQty)) continue;
    if (Math.abs((item.currentStock ?? 0) - nextQty) < 1e-9) continue;
    byId.set(item.id, { ...item, currentStock: round2(nextQty) });
    changed = true;
  }

  if (!changed) return;
  const next = existing.map((s) => byId.get(s.id) ?? s);
  state = next;
  persist(next);
  emit();
}

export function applyInternalTransfers(transfers: Array<{ fromItemId: string; toItemId: string; qty: number }> ):
  | { ok: true; results: Array<{ fromBefore: number; fromAfter: number; toBefore: number; toAfter: number; unitCost: number }> }
  | { ok: false; insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> } {
  if (!transfers.length) return { ok: true, results: [] };

  const existing = load();
  const byId = new Map(existing.map((s) => [s.id, s] as const));

  const insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> = [];
  for (const t of transfers) {
    const from = byId.get(t.fromItemId);
    const qty = Number.isFinite(t.qty) ? t.qty : 0;
    if (!from) continue;
    const onHand = Number.isFinite(from.currentStock) ? from.currentStock : 0;
    if (qty > onHand + 1e-9) insufficient.push({ itemId: t.fromItemId, requiredQty: qty, onHandQty: onHand });
  }
  if (insufficient.length) return { ok: false, insufficient };

  const results: Array<{ fromBefore: number; fromAfter: number; toBefore: number; toAfter: number; unitCost: number }> = [];

  for (const t of transfers) {
    const from = byId.get(t.fromItemId);
    const to = byId.get(t.toItemId);
    const qty = Number.isFinite(t.qty) ? t.qty : 0;
    if (!from || !to || qty <= 0) {
      results.push({ fromBefore: 0, fromAfter: 0, toBefore: 0, toAfter: 0, unitCost: 0 });
      continue;
    }

    const fromBefore = Number.isFinite(from.currentStock) ? from.currentStock : 0;
    const toBefore = Number.isFinite(to.currentStock) ? to.currentStock : 0;
    const unitCost = Number.isFinite(from.currentCost) ? from.currentCost : 0;

    const fromAfter = round2(fromBefore - qty);
    const toAfter = round2(toBefore + qty);

    byId.set(from.id, { ...from, currentStock: fromAfter });
    byId.set(to.id, { ...to, currentStock: toAfter });
    results.push({ fromBefore, fromAfter, toBefore, toAfter, unitCost });
  }

  const next = existing.map((s) => byId.get(s.id) ?? s);
  state = next;
  persist(next);
  emit();

  return { ok: true, results };
}

export function applyStockDeductions(deductions: Array<{ itemId: string; qty: number }>):
  | { ok: true; results: Array<{ itemId: string; before: number; after: number; unitCost: number }> }
  | { ok: false; insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> } {
  if (!deductions.length) return { ok: true, results: [] };

  const existing = load();
  const byId = new Map(existing.map((s) => [s.id, s] as const));

  const insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> = [];
  for (const d of deductions) {
    const item = byId.get(d.itemId);
    const qty = Number.isFinite(d.qty) ? d.qty : 0;
    if (!item || qty <= 0) continue;
    const onHand = Number.isFinite(item.currentStock) ? item.currentStock : 0;
    if (qty > onHand + 1e-9) insufficient.push({ itemId: d.itemId, requiredQty: qty, onHandQty: onHand });
  }
  if (insufficient.length) return { ok: false, insufficient };

  const results: Array<{ itemId: string; before: number; after: number; unitCost: number }> = [];
  for (const d of deductions) {
    const item = byId.get(d.itemId);
    const qty = Number.isFinite(d.qty) ? d.qty : 0;
    if (!item || qty <= 0) continue;

    const before = Number.isFinite(item.currentStock) ? item.currentStock : 0;
    const unitCost = Number.isFinite(item.currentCost) ? item.currentCost : 0;
    const after = round2(before - qty);

    byId.set(item.id, { ...item, currentStock: after });
    results.push({ itemId: item.id, before, after, unitCost });
  }

  const next = existing.map((s) => byId.get(s.id) ?? s);
  state = next;
  persist(next);
  emit();

  return { ok: true, results };
}

// Attempt to apply deductions on the remote DB when Supabase is configured.
// Falls back to local `applyStockDeductions` behavior if remote operations fail.
export async function deductStockItemsRemote(deductions: Array<{ itemId: string; qty: number; unit?: string }>):
  Promise<
    | { ok: true; results: Array<{ itemId: string; before: number; after: number; unitCost: number }> }
    | { ok: false; insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> }
  > {
  if (!deductions.length) return { ok: true, results: [] };

  // If Supabase isn't configured, just perform local deduction synchronously.
  if (!isSupabaseConfigured() || !supabase) {
    return applyStockDeductions(deductions);
  }

  try {
    // Try server-side atomic RPC first (preferred). Pass JSON array of { itemId, qty }.
    try {
      console.debug('[stockStore] calling RPC handle_stock_deductions', { deductions });
      let payload: any = null;
      payload = deductions.map(d => ({ stock_item_id: d.itemId, qty: d.qty, unit: d.unit ?? null }));
      console.debug('[stockStore] RPC payload', { payload });
      // Pass the JS object/array directly so PostgREST sends it as JSON, not as a string scalar
      const { data: rpcData, error: rpcErr } = await supabase.rpc('handle_stock_deductions', { p_deductions: payload });
      // Log full RPC response and any error for debugging
      console.debug('[stockStore] RPC response', { rpcData, rpcErr });
      if (rpcErr) {
        console.warn('[stockStore] RPC handle_stock_deductions failed', rpcErr, { payload, rpcData });
      } else if (rpcData && (rpcData as any).ok === true) {
        console.debug('[stockStore] RPC succeeded', rpcData);
        // Refresh local cache
        try { await fetchFromDb(); } catch { /* ignore */ }
        return { ok: true, results: (rpcData as any).results ?? [] } as any;
      } else if (rpcData && (rpcData as any).ok === false) {
        // RPC returned insufficiency info
        console.warn('[stockStore] RPC reported insufficient stock', rpcData);
        // include full rpcData in return for caller to inspect
        return { ok: false, insufficient: (rpcData as any).insufficient ?? [], debug: rpcData } as any;
      }
    } catch (e) {
      console.error('[stockStore] handle_stock_deductions RPC call threw', e, {  });
      // fallthrough to previous multi-step approach
    }

    const ids = deductions.map((d) => d.itemId);
    console.debug('[stockStore] attempting remote deduction (multi-step) for', { deductions, ids });
    // `stock_items` uses `cost_per_unit` column in DB
    const brandId = currentBrandId;
    if (!brandId) return applyStockDeductions(deductions);
    const { data, error } = await supabase
      .from('stock_items')
      .select('id,current_stock,cost_per_unit')
      .eq('brand_id', brandId)
      .in('id', ids as string[]);
    if (error || !data) {
      console.warn('[stockStore] failed to fetch remote stock items, falling back to local', error);
      return applyStockDeductions(deductions);
    }

    console.debug('[stockStore] fetched remote stock rows', data);

    const byId = new Map((data as any[]).map((r) => [String(r.id), r] as const));

    const insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> = [];
    for (const d of deductions) {
      const row = byId.get(d.itemId);
      const onHand = row && typeof row.current_stock === 'number' ? row.current_stock : NaN;
      const qty = Number.isFinite(d.qty) ? d.qty : 0;
      if (!row || !Number.isFinite(onHand)) continue;
      if (qty > onHand + 1e-9) insufficient.push({ itemId: d.itemId, requiredQty: qty, onHandQty: onHand });
    }
    if (insufficient.length) return { ok: false, insufficient };

    // Apply updates serially. Prefer a DB-side RPC/transaction in production.
    const results: Array<{ itemId: string; before: number; after: number; unitCost: number }> = [];
    for (const d of deductions) {
      const row = byId.get(d.itemId);
      if (!row) continue;
      const before = typeof row.current_stock === 'number' ? row.current_stock : 0;
      const after = Math.round((before - d.qty + Number.EPSILON) * 100) / 100;
      const unitCost = typeof row.cost_per_unit === 'number' ? row.cost_per_unit : 0;

      const { data: updData, error: uErr, status: updStatus } = await supabase
        .from('stock_items')
        .update({ current_stock: after })
        .eq('id', d.itemId)
        .eq('brand_id', brandId)
        .select('id,current_stock');
      if (uErr) {
        console.warn('[stockStore] remote update failed for', d.itemId, { status: updStatus, error: uErr });
        // If a remote update fails, abort and fallback to local synchronous deduction
        return applyStockDeductions(deductions);
      }
      console.debug('[stockStore] remote update succeeded', { itemId: d.itemId, before, after, updData });

      results.push({ itemId: d.itemId, before, after, unitCost });
    }

    // Refresh local cache from DB to stay in sync
    try { await fetchFromDb(); } catch { /* ignore */ }

    return { ok: true, results };
  } catch (err) {
    console.warn('[stockStore] remote deduction failed, falling back to local', err);
    return applyStockDeductions(deductions);
  }
}

function syncFinishedGoodCostToPosByCode(code: string, unitCost: number) {
  try {
    const items = getPosMenuItems();
    const match = items.find(i => String(i.code) === String(code));
    if (!match) return;
    if (Math.abs((match.cost ?? 0) - unitCost) < 0.005) return;
    upsertPosMenuItem({ ...match, cost: unitCost });
  } catch {
    // ignore
  }
}

function isValidUUID(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

export async function applyBatchProductionToStock(params: {
  recipe: Recipe;
  batch: BatchProduction;
}):
  Promise<
    | { ok: true }
    | { ok: false; insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> }
  > {
  const { recipe, batch } = params;
  const existing = load();
  const byId = new Map(existing.map(s => [s.id, s] as const));

  const insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> = [];
  for (const ing of batch.ingredientsUsed) {
    const item = byId.get(ing.ingredientId);
    if (!item) continue;
    const required = Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
    const onHand = Number.isFinite(item.currentStock) ? item.currentStock : 0;
    if (required > onHand + 1e-9) {
      insufficient.push({ itemId: ing.ingredientId, requiredQty: required, onHandQty: onHand });
    }
  }
  if (insufficient.length) return { ok: false, insufficient };

  // Deduct ingredients
  for (const ing of batch.ingredientsUsed) {
    const item = byId.get(ing.ingredientId);
    if (!item) continue;
    const required = Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
    const oldQty = Number.isFinite(item.currentStock) ? item.currentStock : 0;
    byId.set(item.id, { ...item, currentStock: round2(oldQty - required) });
  }

  // Ensure finished good exists as a stock item (so batches can increase it)
  const finishedCode = String(recipe.parentItemCode);
  const fallbackFinishedId = `fg-${finishedCode}`;
  const existingFinishedById = byId.get(fallbackFinishedId);
  const existingFinishedByCode = Array.from(byId.values()).find(
    (s) => String(s.code) === finishedCode || String((s as any).item_code) === finishedCode
  );
  const existingFinished = existingFinishedById ?? existingFinishedByCode;
  const finalFinishedId = existingFinished?.id ?? fallbackFinishedId;
  const producedQty = Number.isFinite(batch.actualOutput) ? batch.actualOutput : 0;

  let finishedGood: StockItem | null = null;
  if (producedQty > 0) {
    const oldQty = existingFinished ? (Number.isFinite(existingFinished.currentStock) ? existingFinished.currentStock : 0) : 0;
    const oldCost = existingFinished ? (Number.isFinite(existingFinished.currentCost) ? existingFinished.currentCost : 0) : 0;
    const newQty = round2(oldQty + producedQty);
    const unitCostIn = Number.isFinite(batch.unitCost) ? batch.unitCost : recipe.unitCost;
    const newCost = newQty > 0 ? (oldQty * oldCost + producedQty * unitCostIn) / newQty : unitCostIn;

    const base: StockItem = existingFinished ?? {
      id: finalFinishedId,
      code: finishedCode,
      name: String(recipe.parentItemName),
      departmentId: recipe.finishedGoodDepartmentId ?? 'bakery',
      unitType: recipe.outputUnitType,
      lowestCost: unitCostIn,
      highestCost: unitCostIn,
      currentCost: unitCostIn,
      currentStock: 0,
    };

    const lowest = Number.isFinite(base.lowestCost) ? base.lowestCost : unitCostIn;
    const highest = Number.isFinite(base.highestCost) ? base.highestCost : unitCostIn;

    finishedGood = {
      ...base,
      currentStock: newQty,
      currentCost: round2(newCost),
      lowestCost: round2(Math.min(lowest, unitCostIn)),
      highestCost: round2(Math.max(highest, unitCostIn)),
    };

    if (fallbackFinishedId !== finalFinishedId) {
      byId.delete(fallbackFinishedId);
    }
    byId.set(finalFinishedId, finishedGood);
  }

  const next = Array.from(byId.values());
  state = next;
  persist(next);
  emit();

  // Persist finished good to Supabase if configured
  if (finishedGood && isSupabaseConfigured() && supabase) {
    try {
      const finishedCode = String(recipe.parentItemCode);
      const dbExisting = existing.find((s) => String(s.code) === finishedCode || String((s as any).item_code) === finishedCode);
      const dbId = dbExisting && isValidUUID(dbExisting.id) ? dbExisting.id : generateUUID();

      // Normalize payload to DB shape (uuid id and stable code)
      const dbItem: StockItem = {
        ...finishedGood,
        id: dbId,
        code: finishedCode,
        name: String(recipe.parentItemName),
        unitType: recipe.outputUnitType,
      };

      if (dbExisting && isValidUUID(dbExisting.id)) {
        await updateStockItem(dbId, {
          currentStock: dbItem.currentStock,
          currentCost: dbItem.currentCost,
          lowestCost: dbItem.lowestCost,
          highestCost: dbItem.highestCost,
        });
      } else {
        // Ensure we don't send non-uuid IDs to Supabase
        await addStockItem(dbItem);
      }
    } catch (err) {
      console.warn('Failed to persist finished good to Supabase:', err);
      // Continue anyway - local state is updated
    }
  }

  syncFinishedGoodCostToPosByCode(String(recipe.parentItemCode), batch.unitCost);
  return { ok: true };
}

export async function revertBatchProductionFromStock(params: {
  recipe: Recipe;
  batch: BatchProduction;
}):
  Promise<
    | { ok: true }
    | { ok: false; insufficientFinishedGoods: Array<{ itemId: string; requiredQty: number; onHandQty: number }> }
  > {
  const { recipe, batch } = params;
  const existing = load();
  const byId = new Map(existing.map((s) => [s.id, s] as const));

  const finishedCode = String(recipe.parentItemCode);
  const fallbackFinishedId = `fg-${finishedCode}`;
  const finishedById = byId.get(fallbackFinishedId);
  const finishedByCode = Array.from(byId.values()).find(
    (s) => String(s.code) === finishedCode || String((s as any).item_code) === finishedCode
  );
  const finishedItem = finishedById ?? finishedByCode;
  const producedQty = Number.isFinite(batch.actualOutput) ? batch.actualOutput : 0;

  const insufficientFinishedGoods: Array<{ itemId: string; requiredQty: number; onHandQty: number }> = [];
  if (producedQty > 0 && finishedItem) {
    const onHand = Number.isFinite(finishedItem.currentStock) ? finishedItem.currentStock : 0;
    if (producedQty > onHand + 1e-9) {
      const id = finishedItem.id;
      insufficientFinishedGoods.push({ itemId: id, requiredQty: producedQty, onHandQty: onHand });
      // allow goal: in some scenarios stock may lag due remote sync; still allow revert but clamp to zero.
    }
  }

  // Add ingredients back
  for (const ing of batch.ingredientsUsed) {
    const item = byId.get(ing.ingredientId);
    if (!item) continue;
    const required = Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
    const oldQty = Number.isFinite(item.currentStock) ? item.currentStock : 0;
    byId.set(item.id, { ...item, currentStock: round2(oldQty + required) });
  }

  // Reduce finished goods
  let updatedFinishedGood: StockItem | null = null;
  if (producedQty > 0 && finishedItem) {
    const finishedStockId = finishedItem.id ?? fallbackFinishedId;
    const oldQty = Number.isFinite(finishedItem.currentStock) ? finishedItem.currentStock : 0;
    const newQty = Math.max(0, round2(oldQty - producedQty));
    updatedFinishedGood = { ...finishedItem, currentStock: newQty };

    if (finishedStockId !== fallbackFinishedId) {
      byId.delete(fallbackFinishedId);
    }
    byId.set(finishedStockId, updatedFinishedGood);
  }

  const next = Array.from(byId.values());
  state = next;
  persist(next);
  emit();

  // Persist updated finished good to Supabase if configured
  if (updatedFinishedGood && isSupabaseConfigured() && supabase) {
    try {
      const finishedCode = String(recipe.parentItemCode);
      const dbExisting = existing.find((s) => String(s.code) === finishedCode || String((s as any).item_code) === finishedCode);
      if (dbExisting && isValidUUID(dbExisting.id)) {
        await updateStockItem(dbExisting.id, {
          currentStock: updatedFinishedGood.currentStock,
        });
      } else {
        // No existing DB row to reduce; attempt to find by name or ID and update too.
        const alt = existing.find((s) => String(s.name) === String(recipe.parentItemName) || s.id === updatedFinishedGood.id);
        if (alt && isValidUUID(alt.id)) {
          await updateStockItem(alt.id, { currentStock: updatedFinishedGood.currentStock });
        }
      }
    } catch (err) {
      console.warn('Failed to persist finished good revert to Supabase:', err);
      // Continue anyway - local state is updated
    }
  }

  return { ok: true };
}

export function applyGRVReceiptToStock(params: {
  items: Array<{ itemId: string; quantity: number; unitCost: number }>;
  costMode?: 'weightedAverage' | 'lastPurchase';
}) {
  const costMode = params.costMode ?? 'weightedAverage';

  const existing = load();
  const byId = new Map(existing.map(s => [s.id, s] as const));

  for (const line of params.items) {
    const item = byId.get(line.itemId);
    if (!item) continue;

    const qtyIn = Number.isFinite(line.quantity) ? line.quantity : 0;
    const unitCostIn = Number.isFinite(line.unitCost) ? line.unitCost : 0;
    if (qtyIn <= 0) continue;

    const oldQty = Number.isFinite(item.currentStock) ? item.currentStock : 0;
    const oldCost = Number.isFinite(item.currentCost) ? item.currentCost : 0;

    const newQty = round2(oldQty + qtyIn);

    let newCost = oldCost;
    if (costMode === 'lastPurchase') {
      newCost = unitCostIn;
    } else {
      // Weighted average cost
      const denom = oldQty + qtyIn;
      newCost = denom > 0 ? (oldQty * oldCost + qtyIn * unitCostIn) / denom : unitCostIn;
    }

    const lowest = Number.isFinite(item.lowestCost) ? item.lowestCost : unitCostIn;
    const highest = Number.isFinite(item.highestCost) ? item.highestCost : unitCostIn;

    byId.set(item.id, {
      ...item,
      currentStock: newQty,
      currentCost: round2(newCost),
      lowestCost: round2(Math.min(lowest, unitCostIn)),
      highestCost: round2(Math.max(highest, unitCostIn)),
    });
  }

  const next = existing.map(s => byId.get(s.id) ?? s);
  state = next;
  persist(next);
  emit();
}

export function resetStockToSeed() {
  state = seededStockItems.map(s => ({ ...s }));
  persist(state);
  emit();
}
