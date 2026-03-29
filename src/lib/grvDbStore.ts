import type { GRV, GRVItem } from '@/types';
import { supabase } from '@/lib/supabaseClient';
import { getStockItemById } from '@/lib/stockStore';

type Listener = () => void;

let listeners: Listener[] = [];
let state: GRV[] = [];
let lastBrandId: string | null = null;

function emit() {
  for (const l of listeners) l();
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computeTotals(items: GRVItem[], applyVat: boolean, vatRate: number) {
  const subtotal = round2(items.reduce((sum, i) => sum + round2(i.quantity * i.unitCost), 0));
  const tax = applyVat ? round2(subtotal * vatRate) : 0;
  const total = round2(subtotal + tax);
  return { subtotal, tax, total };
}

function mapDbRowToGrv(row: any): GRV {
  const items: GRVItem[] = Array.isArray(row?.grv_items)
    ? row.grv_items.map((it: any) => ({
        id: String(it.id),
        itemId: String(it.stock_item_id),
        itemCode: String(it.item_code ?? ''),
        itemName: String(it.item_name ?? ''),
        quantity: Number(it.quantity ?? 0),
        unitCost: Number(it.unit_cost ?? 0),
        totalCost: Number(it.total_cost ?? round2(Number(it.quantity ?? 0) * Number(it.unit_cost ?? 0))),
      }))
    : [];

  return {
    id: String(row.id),
    grvNo: String(row.grv_no ?? ''),
    date: String(row.date ?? new Date().toISOString().slice(0, 10)),
    supplierId: String(row.supplier_id ?? ''),
    supplierName: String(row.supplier_name ?? ''),
    items,
    subtotal: Number(row.subtotal ?? 0),
    tax: Number(row.tax ?? 0),
    total: Number(row.total ?? 0),
    paymentType: (row.payment_type ?? 'account') as GRV['paymentType'],
    status: (row.status ?? 'pending') as GRV['status'],
    receivedBy: String(row.received_by ?? ''),
  };
}

export function subscribeGRVs(listener: Listener) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getGRVsSnapshot(): GRV[] {
  return state;
}

export async function refreshGRVs(brandId: string) {
  if (!supabase) return;
  if (!brandId) return;

  lastBrandId = brandId;

  const { data, error } = await supabase
    .from('grvs')
    .select(
      [
        'id, brand_id, grv_no, date, supplier_id, supplier_name, payment_type, subtotal, tax, total, status, received_by',
        'grv_items(id, stock_item_id, item_code, item_name, quantity, unit_cost, total_cost)',
      ].join(',')
    )
    .eq('brand_id', brandId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;

  state = (data ?? []).map(mapDbRowToGrv);
  emit();
}

export function recomputeLine(item: GRVItem): GRVItem {
  const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
  const unitCost = Number.isFinite(item.unitCost) ? item.unitCost : 0;
  return { ...item, totalCost: round2(quantity * unitCost) };
}

export function makeGRVItemFromStockItem(stockItemId: string): GRVItem | null {
  const si = getStockItemById(stockItemId);
  if (!si) return null;

  return {
    id: crypto.randomUUID(),
    itemId: si.id,
    itemCode: si.code,
    itemName: si.name,
    quantity: 1,
    unitCost: si.currentCost,
    totalCost: round2(si.currentCost),
  };
}

export async function createDraftGRV(params: {
  brandId: string;
  date: string;
  supplierId: string;
  supplierName: string;
  paymentType: GRV['paymentType'];
  receivedBy: string;
  items?: GRVItem[];
  applyVat?: boolean;
  vatRate?: number;
}): Promise<GRV> {
  if (!supabase) throw new Error('Supabase not configured');
  if (!params.brandId) throw new Error('brandId is required');

  const items = (params.items ?? []).map(recomputeLine);
  const applyVat = params.applyVat ?? true;
  const vatRate = params.vatRate ?? 0.16;
  const totals = computeTotals(items, applyVat, vatRate);

  // Prefer server-side transactional RPC which inserts GRV + items atomically.
  if (supabase) {
    try {
      const p_items = items.map((i) => ({
        itemId: i.itemId,
        itemCode: i.itemCode,
        itemName: i.itemName,
        quantity: i.quantity,
        unitCost: i.unitCost,
        totalCost: i.totalCost,
      }));

      const { data: rpcData, error: rpcError } = await supabase.rpc('grv_create', {
        p_brand_id: params.brandId,
        p_date: params.date,
        p_supplier_id: params.supplierId ? params.supplierId : null,
        p_supplier_name: params.supplierName,
        p_payment_type: params.paymentType,
        p_received_by: params.receivedBy,
        p_items: p_items,
      });

      if (rpcError) {
        // If the RPC is missing or not available, fall back to legacy insertion logic.
        const msg = String(rpcError?.message ?? '').toLowerCase();
        const code = String(rpcError?.code ?? '');
        if (code === '42883' || msg.includes('function') && msg.includes('grv_create')) {
          // Fall through to legacy path below
          throw rpcError;
        }
        throw rpcError;
      }

      // RPC returned success; refresh and return the created GRV
      await refreshGRVs(params.brandId);
      const createdId = Array.isArray(rpcData) && rpcData[0] ? String(rpcData[0].grv_id ?? rpcData[0].id ?? '') : '';
      if (createdId) return state.find((g) => g.id === createdId) ?? state[0];
      return state[0];
    } catch (err) {
      // If RPC isn't available (function missing) then continue to legacy insert path below.
      const lower = String((err as any)?.message ?? '').toLowerCase();
      if (!lower.includes('grv_create') && String((err as any)?.code ?? '') !== '42883') {
        throw err;
      }
      // else fall back
    }
  }

  // Legacy fallback: insert parent then items (kept for backward compatibility)
  const { data: grv, error: grvError } = await supabase
    .from('grvs')
    .insert({
      brand_id: params.brandId,
      date: params.date,
      supplier_id: params.supplierId ? params.supplierId : null,
      supplier_name: params.supplierName,
      payment_type: params.paymentType,
      received_by: params.receivedBy,
      apply_vat: applyVat,
      vat_rate: vatRate,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      status: 'pending',
    })
    .select('id, brand_id, grv_no, date, supplier_id, supplier_name, payment_type, subtotal, tax, total, status, received_by')
    .single();

  if (grvError) throw grvError;

  if (items.length) {
    const { error: itemsError } = await supabase.from('grv_items').insert(
      items.map((i) => ({
        grv_id: grv.id,
        stock_item_id: i.itemId,
        item_code: i.itemCode,
        item_name: i.itemName,
        quantity: i.quantity,
        unit_cost: i.unitCost,
        total_cost: i.totalCost,
      }))
    );

    if (itemsError) {
      // Items insert failed — attempt to clean up the parent GRV to avoid orphaned records
      try {
        await supabase.from('grvs').delete().eq('id', grv.id);
      } catch (cleanupErr) {
        console.warn('Failed to cleanup GRV after grv_items insert error', cleanupErr);
      }
      throw itemsError;
    }
  }

  await refreshGRVs(params.brandId);
  return state.find((g) => g.id === String(grv.id)) ?? mapDbRowToGrv({ ...grv, grv_items: items });
}

export async function updateGRV(
  grvId: string,
  patch: Partial<Omit<GRV, 'id' | 'grvNo'>> & { brandId: string; applyVat?: boolean; vatRate?: number }
) {
  if (!supabase) throw new Error('Supabase not configured');
  if (!patch.brandId) throw new Error('brandId is required');

  const nextItems = (patch.items ?? []).map(recomputeLine);
  const applyVat = patch.applyVat ?? true;
  const vatRate = patch.vatRate ?? 0.16;
  const totals = computeTotals(nextItems, applyVat, vatRate);

  const { error: updError } = await supabase
    .from('grvs')
    .update({
      date: patch.date,
      supplier_id: patch.supplierId ? patch.supplierId : null,
      supplier_name: patch.supplierName,
      payment_type: patch.paymentType,
      received_by: patch.receivedBy,
      apply_vat: applyVat,
      vat_rate: vatRate,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    })
    .eq('id', grvId)
    .eq('status', 'pending');

  if (updError) throw updError;

  const { error: delError } = await supabase.from('grv_items').delete().eq('grv_id', grvId);
  if (delError) throw delError;

  if (nextItems.length) {
    const { error: insError } = await supabase.from('grv_items').insert(
      nextItems.map((i) => ({
        grv_id: grvId,
        stock_item_id: i.itemId,
        item_code: i.itemCode,
        item_name: i.itemName,
        quantity: i.quantity,
        unit_cost: i.unitCost,
        total_cost: i.totalCost,
      }))
    );

    if (insError) throw insError;
  }

  await refreshGRVs(patch.brandId);
}

export async function confirmGRV(grvId: string) {
  if (!supabase) throw new Error('Supabase not configured');

  // Try RPC, retry once on transient failure.
  let attempt = 0;
  let lastErr: any = null;
  while (attempt < 2) {
    try {
      const { error } = await supabase.rpc('grv_confirm', { p_grv_id: grvId });
      if (error) throw error;
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      attempt += 1;
      // small delay before retry
      if (attempt < 2) await new Promise((res) => setTimeout(res, 500));
    }
  }

  if (lastErr) throw lastErr;

  if (lastBrandId) await refreshGRVs(lastBrandId);
}

export async function cancelGRV(grvId: string) {
  if (!supabase) throw new Error('Supabase not configured');

  const { error } = await supabase.rpc('grv_cancel', { p_grv_id: grvId });
  if (error) throw error;

  if (lastBrandId) await refreshGRVs(lastBrandId);
}

export async function deleteGRV(grvId: string) {
  if (!supabase) throw new Error('Supabase not configured');

  const { error } = await supabase.rpc('grv_delete_pending', { p_grv_id: grvId });
  if (error) throw error;

  if (lastBrandId) await refreshGRVs(lastBrandId);
}

// DEV/ADMIN escape hatch: delete a GRV regardless of status.
// WARNING: this does NOT roll back stock quantities/costs/ledger.
export async function forceDeleteGRV(grvId: string) {
  if (!supabase) throw new Error('Supabase not configured');

  const { error } = await supabase.rpc('grv_force_delete', { p_grv_id: grvId });
  if (error) throw error;

  if (lastBrandId) await refreshGRVs(lastBrandId);
}
