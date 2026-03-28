import type { Order, OrderItem, OrderType, PaymentMethod } from '@/types/pos';
import { enqueueOrder } from '@/lib/offlineOrderQueue';
import { flushQueuedOrders } from '@/lib/offlineOrderQueue';
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { ensureRecipesLoaded, getManufacturingRecipesSnapshot } from '@/lib/manufacturingRecipeStore';
import { logSensitiveAction } from '@/lib/systemAuditLog';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';
import { pushDebug } from '@/lib/debugLog';

const STORAGE_KEY = 'mthunzi.orders.v1';

function storageKeyForBrand(brandId: string | null) {
  return `${STORAGE_KEY}.${brandId ? String(brandId) : 'none'}`;
}

let currentBrandId: string | null = getActiveBrandId();

export type StoredOrdersV1 = {
  version: 1;
  orders: Order[];
};

function load(): StoredOrdersV1 {
  const raw = localStorage.getItem(storageKeyForBrand(currentBrandId));
  if (raw) {
    try {
      return JSON.parse(raw) as StoredOrdersV1;
    } catch {
      // ignore
    }
  }
  const init: StoredOrdersV1 = { version: 1, orders: [] };
  localStorage.setItem(storageKeyForBrand(currentBrandId), JSON.stringify(init));
  return init;
}

function save(state: StoredOrdersV1) {
  inMemoryState = state;
  localStorage.setItem(storageKeyForBrand(currentBrandId), JSON.stringify(state));
  emit();
}

type Listener = () => void;
const listeners = new Set<Listener>();
let inMemoryState: StoredOrdersV1 | null = null;

// Reset cached orders when brand changes to prevent cross-brand bleed.
subscribeActiveBrandId(() => {
  currentBrandId = getActiveBrandId();
  inMemoryState = null;
  emit();
});

function emit() {
  for (const l of listeners) l();
}

function getState(): StoredOrdersV1 {
  if (!inMemoryState) inMemoryState = load();
  return inMemoryState;
}

const useRemote = isSupabaseConfigured() && supabase;
let flushWired = false;

async function sendOrderToSupabase(order: Order) {
  if (!useRemote) return;

  const client = supabase!.schema('erp');

  // Hold remote-generated order id when available (erp or public table may return a different id)
  let orderIdForRemote: string | undefined = undefined;

  const payloadOrder: any = {
    id: order.id,
    brand_id: currentBrandId,
    order_no: order.orderNo,
    table_no: order.tableNo ?? null,
    order_type: order.orderType,
    status: order.status,
    staff_id: order.staffId,
    staff_name: order.staffName,
    subtotal: order.subtotal,
    discount_amount: order.discountAmount ?? 0,
    discount_percent: order.discountPercent ?? 0,
    tax: order.tax,
    total: order.total,
    total_cost: order.totalCost,
    gross_profit: order.grossProfit,
    gp_percent: order.gpPercent,
    payment_method: order.paymentMethod ?? null,
    created_at: order.createdAt,
    sent_at: order.sentAt ?? null,
    paid_at: order.paidAt ?? null,
  };

  // Use the in-memory/local order id directly — we only write `pos_order_items`.
  const remoteOrderId = order.id;
  // Prepare items payload
  const itemsPayload = order.items.map((it) => ({
    order_id: remoteOrderId,
    brand_id: currentBrandId,
    menu_item_id: it.menuItemId,
    menu_item_code: it.menuItemCode,
    menu_item_name: it.menuItemName,
    quantity: it.quantity,
    unit_price: it.unitPrice,
    unit_cost: it.unitCost,
    discount_percent: it.discountPercent ?? null,
    total: it.total,
    notes: it.notes ?? null,
    modifiers: it.modifiers ?? null,
    is_voided: it.isVoided,
    void_reason: it.voidReason ?? null,
    sent_to_kitchen: it.sentToKitchen,
    created_at: order.createdAt,
  }));
  // Debug: log if any item quantity is unexpectedly high (possible double-merge)
  const doubled = itemsPayload.filter(i => i.quantity > 100); // arbitrary threshold
  if (doubled.length > 0) {
    console.warn('[orderStore] Unusually high item quantities detected', doubled);
  }

  // Insert items directly into public.pos_order_items
  try {
    // Ensure order header exists in `pos_orders` (upsert)
    try {
      const { data: orderUpsertResult, error: orderUpsertErr } = await supabase!.from('pos_orders').upsert(payloadOrder).select();
      if (orderUpsertErr) {
        console.error('[orderStore] failed to upsert pos_orders', orderUpsertErr);
        throw orderUpsertErr;
      }
    } catch (e) {
      console.error('[orderStore] upsert pos_orders failed', e);
      throw e;
    }
    // Remove any existing items for this order (best-effort)
    try {
      await supabase!.from('pos_order_items').delete().eq('order_id', remoteOrderId);
    } catch {
      // ignore
    }
    const { data: itemsData, error: itemsError } = await supabase!.from('pos_order_items').insert(itemsPayload).select();
    if (itemsError) {
      console.error('[orderStore] failed to insert items into pos_order_items', itemsError);
      throw itemsError;
    }
  } catch (e) {
    console.error('[orderStore] insert to pos_order_items failed', e);
    throw e;
  }

  // Attempt to compute recipe ingredient deductions client-side and call
  // the atomic array RPC to apply stock deductions and insert ledger rows.
  try {
    await ensureRecipesLoaded();
    const recipes = getManufacturingRecipesSnapshot();
    // Call per-item RPC to deduct ingredients for each sold menu item.
    for (const it of order.items) {
      const match = recipes.find((r) => r.parentItemId === String(it.menuItemId) || String(r.parentItemCode) === String(it.menuItemCode));
      if (!match) {
        console.debug('[orderStore] no recipe found for item', it.menuItemId, it.menuItemCode);
        continue;
      }

      try {
        const { data: rpcData, error: rpcErr } = await supabase!.rpc('handle_order_stock_deduction', { p_menu_item_id: it.menuItemId, p_qty_sold: it.quantity });
        if (rpcErr) console.warn('[orderStore] handle_order_stock_deduction rpc failed for', it.menuItemId, rpcErr);
        else console.debug('[orderStore] handle_order_stock_deduction result', rpcData);
      } catch (e) {
        console.warn('[orderStore] deduction rpc exception for', it.menuItemId, e);
      }
    }
  } catch (e) {
    console.warn('[orderStore] deduction processing error', e);
  }
}

async function flushQueueIfPossible() {
  if (!useRemote) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  await flushQueuedOrders(sendOrderToSupabase);
}

function ensureFlushWired() {
  if (flushWired || typeof window === 'undefined') return;
  flushWired = true;
  window.addEventListener('online', () => {
    void flushQueueIfPossible();
  });
  // Attempt one flush on startup
  void flushQueueIfPossible();
}

function nextOrderNo(existing: Order[]) {
  const max = existing.reduce((m, o) => Math.max(m, o.orderNo ?? 0), 0);
  return max > 0 ? max + 1 : 2000;
}

export function getOrders(): Order[] {
  return getState().orders;
}

export function getOrdersSnapshot(): Order[] {
  return getState().orders;
}

export function subscribeOrders(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function upsertOrder(order: Order) {
  const state = getState();
  const idx = state.orders.findIndex(o => o.id === order.id);
  const next = idx >= 0
    ? state.orders.map(o => (o.id === order.id ? order : o))
    : [order, ...state.orders];
  save({ ...state, orders: next });

  try {
    ensureFlushWired();
    if (!useRemote) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void enqueueOrder(order);
      return;
    }
    void sendOrderToSupabase(order).catch(() => enqueueOrder(order));
  } catch {
    // ignore
  }
}
export function addOrder(params: {
  staffId: string;
  staffName: string;
  orderType: OrderType;
  tableNo?: number | null;
  items: OrderItem[];
  subtotal: number;
  discountAmount?: number;
  discountPercent?: number;
  tax: number;
  total: number;
  totalCost: number;
  grossProfit: number;
  gpPercent: number;
  status: Order['status'];
  paymentMethod?: PaymentMethod;
}): Order {
  const state = getState();
  const now = new Date().toISOString();
  const order: Order = {
    id: `ord-${Date.now()}`,
    orderNo: nextOrderNo(state.orders),
    tableId: params.tableNo ? `t${params.tableNo}` : undefined,
    tableNo: params.tableNo ?? undefined,
    orderType: params.orderType,
    status: params.status,
    staffId: params.staffId,
    staffName: params.staffName,
    items: params.items,
    subtotal: params.subtotal,
    discountAmount: params.discountAmount ?? 0,
    discountPercent: params.discountPercent ?? 0,
    tax: params.tax,
    total: params.total,
    totalCost: params.totalCost,
    grossProfit: params.grossProfit,
    gpPercent: params.gpPercent,
    createdAt: now,
    sentAt: params.status === 'sent' ? now : undefined,
    paidAt: params.status === 'paid' ? now : undefined,
    paymentMethod: params.paymentMethod,
  };

  save({ ...state, orders: [order, ...state.orders] });

  try {
    const actionType =
      order.status === 'paid'
        ? ('order_paid' as const)
        : order.status === 'sent'
          ? ('order_sent' as const)
          : order.status === 'ready'
            ? ('order_ready' as const)
            : order.status === 'served'
              ? ('order_served' as const)
              : null;

    if (actionType) {
      void logSensitiveAction({
        userId: params.staffId,
        userName: params.staffName,
        actionType,
        reference: order.id,
        newValue: order.total,
        notes: `Order #${order.orderNo}${order.tableNo ? ` (Table ${order.tableNo})` : ''} • ${order.orderType} • ${order.paymentMethod ?? 'unpaid'}`,
        captureGeo: false,
      });
    }
  } catch {
    // ignore audit failures
  }

  // Offline-first: if the device is offline, queue for sync.
  try {
    ensureFlushWired();
    if (!useRemote) return order;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void enqueueOrder(order);
      return order;
    }

    void sendOrderToSupabase(order).catch(() => enqueueOrder(order));
  } catch {
    // ignore
  }

  return order;
}

export function markOrderSent(orderId: string) {
  const state = getState();
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  const updated: Order = { ...order, status: 'sent', sentAt: new Date().toISOString() };
  save({ ...state, orders: state.orders.map(o => (o.id === orderId ? updated : o)) });
  console.debug('[orderStore] markOrderSent called for', orderId, { orderNo: updated.orderNo, tableNo: updated.tableNo });
  try { pushDebug(`[orderStore] markOrderSent called for ${orderId} orderNo=${updated.orderNo} table=${updated.tableNo}`); } catch {}

  try {
    void logSensitiveAction({
      userId: updated.staffId,
      userName: updated.staffName,
      actionType: 'order_sent',
      reference: updated.id,
      newValue: updated.status,
      notes: `Order #${updated.orderNo} sent to kitchen`,
      captureGeo: false,
    });
  } catch {
    // ignore
  }

  try {
    ensureFlushWired();
    if (!useRemote) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void enqueueOrder(updated);
      return;
    }
    void sendOrderToSupabase(updated).then(() => {
      console.debug('[orderStore] sendOrderToSupabase completed for', updated.id);
      try { pushDebug(`[orderStore] sendOrderToSupabase completed for ${updated.id}`); } catch {}
    }).catch(() => {
      console.debug('[orderStore] sendOrderToSupabase failed; enqueued for', updated.id);
      try { pushDebug(`[orderStore] sendOrderToSupabase failed; enqueued for ${updated.id}`); } catch {}
      enqueueOrder(updated);
    });
  } catch {
    // ignore
  }
}

export function markOrderStarted(orderId: string) {
  const state = getState();
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  const now = new Date().toISOString();
  const updated: Order = { ...order, status: 'in_progress', sentAt: order.sentAt ?? now };
  save({ ...state, orders: state.orders.map(o => (o.id === orderId ? updated : o)) });

  try {
    const stack = (new Error('markOrderStarted stack')).stack ?? '';
    try { pushDebug('[orderStore] markOrderStarted called for ' + orderId + '\n' + stack); } catch {}
  } catch {}

  try {
    void logSensitiveAction({
      userId: updated.staffId,
      userName: updated.staffName,
      actionType: 'order_started',
      reference: updated.id,
      newValue: updated.status,
      notes: `Order #${updated.orderNo} started in kitchen`,
      captureGeo: false,
    });
  } catch {
    // ignore
  }

  try {
    ensureFlushWired();
    if (!useRemote) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void enqueueOrder(updated);
      return;
    }
    void sendOrderToSupabase(updated).catch(() => enqueueOrder(updated));
  } catch {
    // ignore
  }
}

export function markOrderReady(orderId: string) {
  const state = getState();
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;
  // If order is already marked ready, do nothing (avoid duplicate notifications)
  if (order.status === 'ready') {
    console.debug('[orderStore] markOrderReady called but order already ready', orderId);
    try { pushDebug(`[orderStore] markOrderReady skipped for ${orderId} (already ready)`); } catch {}
    return;
  }
  try {
    const stack = (new Error('markOrderReady stack')).stack ?? '';
    try { pushDebug('[orderStore] markOrderReady invoked for ' + orderId + '\n' + stack); } catch {}
  } catch {}
  const now = new Date().toISOString();
  const updated: Order = {
    ...order,
    status: 'ready',
    items: order.items.map(it => ({ ...it, preparedAt: it.preparedAt ?? now })),
  };
  save({ ...state, orders: state.orders.map(o => (o.id === orderId ? updated : o)) });

  try {
    void logSensitiveAction({
      userId: updated.staffId,
      userName: updated.staffName,
      actionType: 'order_ready',
      reference: updated.id,
      newValue: updated.status,
      notes: `Order #${updated.orderNo} marked ready`,
      captureGeo: false,
    });
  } catch {
    // ignore
  }

  try {
    ensureFlushWired();
    if (!useRemote) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void enqueueOrder(updated);
      return;
    }
    void sendOrderToSupabase(updated).catch(() => enqueueOrder(updated));
    // Notify other local tabs/terminals immediately via BroadcastChannel so POS
    // receives an instant 'order_ready' notification even before realtime round-trip.
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        try {
          const bc = new BroadcastChannel('mthunzi.kitchen');
          bc.postMessage({ type: 'order_ready', orderId: updated.id, orderNo: updated.orderNo, tableNo: updated.tableNo });
          bc.close();
        } catch {
          // ignore channel errors
        }
      }
    } catch {
      // ignore
    }
  } catch {
    // ignore
  }
}

export function markOrderServed(orderId: string) {
  const state = getState();
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return;

  const updated: Order = { ...order, status: 'served' };
  save({ ...state, orders: state.orders.map((o) => (o.id === orderId ? updated : o)) });

  try {
    void logSensitiveAction({
      userId: updated.staffId,
      userName: updated.staffName,
      actionType: 'order_served',
      reference: updated.id,
      newValue: updated.status,
      notes: `Order #${updated.orderNo} served`,
      captureGeo: false,
    });
  } catch {
    // ignore
  }

  try {
    ensureFlushWired();
    if (!useRemote) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void enqueueOrder(updated);
      return;
    }
    void sendOrderToSupabase(updated).catch(() => enqueueOrder(updated));
  } catch {
    // ignore
  }
}

// Explicitly insert a brand-scoped ready notification. Call this from the
// Kitchen UI when the user clicks the explicit "Pass" action so that only an
// intentional pass will notify other terminals.
export async function notifyOrderReady(orderId: string) {
  try {
    const state = getState();
    const order = state.orders.find((o) => o.id === orderId);
    if (!order) return;
    if (!useRemote) return;
    const notif = {
      brand_id: currentBrandId,
      type: 'order_ready',
      payload: { orderId: order.id, orderNo: order.orderNo, tableNo: order.tableNo },
    };
    try {
      const { data: notifData, error: notifErr } = await supabase!.from('pos_notifications').insert(notif).select();
      if (notifErr) {
        console.warn('[orderStore] failed to insert pos_notifications', notifErr);
        try { pushDebug('[orderStore] failed to insert pos_notifications: ' + String(notifErr)); } catch {}
      } else {
        try { pushDebug('[orderStore] pos_notifications inserted for ' + order.id); } catch {}
        // Fast same-origin fallback: broadcast the new notification so local POS tabs
        // receive it immediately without waiting for realtime DB events.
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            try {
              const bc = new BroadcastChannel('mthunzi.kitchen');
              const created = Array.isArray(notifData) ? notifData[0] : notifData;
              bc.postMessage({ type: 'pos_notification', notification: created });
              bc.close();
            } catch {
              // ignore channel errors
            }
          }
        } catch {
          // ignore
        }
      }
    } catch (e) {
      console.warn('[orderStore] exception inserting pos_notifications', e);
      try { pushDebug('[orderStore] exception inserting pos_notifications: ' + String(e)); } catch {}
    }
  } catch {
    // ignore
  }
}

export function markOrderItemPrepared(params: { orderId: string; itemId: string; prepared: boolean }) {
  const state = getState();
  const order = state.orders.find((o) => o.id === params.orderId);
  if (!order) return;

  const now = new Date().toISOString();
  const updated: Order = {
    ...order,
    items: order.items.map((it) => {
      if (it.id !== params.itemId) return it;
      return { ...it, preparedAt: params.prepared ? (it.preparedAt ?? now) : undefined };
    }),
  };

  save({ ...state, orders: state.orders.map((o) => (o.id === params.orderId ? updated : o)) });

  try {
    ensureFlushWired();
    if (!useRemote) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void enqueueOrder(updated);
      return;
    }
    void sendOrderToSupabase(updated).catch(() => enqueueOrder(updated));
  } catch {
    // ignore
  }
}

export function clearOrders() {
  save({ version: 1, orders: [] });
}

// Explicit helper to upsert an order row and its items into Supabase using
// snake_case payloads. Returns { data, error } for callers to inspect.
export async function sendOrderPayload(orderData: any, itemsData: any[]) {
  if (!useRemote) return { data: null, error: new Error('no-remote') };
  try {
    // Upsert order (pos_orders)
    const { data: orderUpserted, error: orderErr } = await supabase!.from('pos_orders').upsert(orderData).select();
    if (orderErr) {
      console.error('[orderStore] upsert pos_orders failed', orderErr);
      return { data: null, error: orderErr };
    }
    console.debug('[orderStore] sendOrderPayload upsert result', { orderData, orderUpserted });

    // Remove existing items for this order (best-effort)
    try {
      await supabase!.from('pos_order_items').delete().eq('order_id', orderData.id);
    } catch (e) {
      // ignore
    }

    // Insert provided items
    const { data: itemsInserted, error: itemsErr } = await supabase!.from('pos_order_items').insert(itemsData).select();
    if (itemsErr) {
      console.error('[orderStore] insert pos_order_items failed', itemsErr);
      return { data: null, error: itemsErr };
    }

    console.debug('[orderStore] sendOrderPayload items inserted', { itemsData, itemsInserted });

    return { data: { order: orderUpserted, items: itemsInserted }, error: null };
  } catch (err) {
    console.warn('[orderStore] sendOrderPayload exception', err);
    return { data: null, error: err };
  }
}

// Fetch pos_order_items where sent_to_kitchen = true and their orders,
// normalize snake_case DB rows into the app's `Order` shape and merge
// into the in-memory store (preserving non-kitchen local orders).
export async function fetchAndReplaceOrdersFromSupabase() {
  if (!useRemote) return;
  try {
    // fetch kitchen items
    const { data: items, error: itemsErr } = await supabase!
      .from('pos_order_items')
      .select('*')
      .eq('sent_to_kitchen', true)
      .order('created_at', { ascending: true });

    if (itemsErr) {
      console.warn('[orderStore] fetch kitchen items failed', itemsErr);
      return;
    }

    if (!items || items.length === 0) {
      // nothing to show — keep non-kitchen orders
      const preserved = getState().orders.filter(o => !o.items.some(it => it.sentToKitchen));
      save({ version: 1, orders: preserved });
      return;
    }

    const orderIds = Array.from(new Set(items.map((r: any) => r.order_id)));

    // fetch corresponding orders
    const { data: ordersRows, error: ordersErr } = await supabase!
      .from('pos_orders')
      .select('*')
      .in('id', orderIds);

    if (ordersErr) {
      console.warn('[orderStore] fetch orders failed', ordersErr);
      return;
    }

    const ordersById: Record<string, any> = {};
    for (const r of ordersRows || []) ordersById[String(r.id)] = r;

    // group items by order_id and normalize
    const grouped: Record<string, any[]> = {};
    for (const it of items) {
      const oid = String(it.order_id);
      grouped[oid] = grouped[oid] || [];
      grouped[oid].push(it);
    }

    const fetchedOrders = Object.keys(grouped).map((oid) => {
      const orderRow = ordersById[oid] || { id: oid };
      const itemRows = grouped[oid];

      const itemsNormalized = itemRows.map((it: any) => ({
        id: String(it.id),
        menuItemId: String(it.menu_item_id),
        menuItemCode: it.menu_item_code ?? String(it.menu_item_code ?? ''),
        menuItemName: it.menu_item_name ?? it.menu_item_name,
        quantity: Number(it.quantity) || 0,
        unitPrice: Number(it.unit_price) || 0,
        unitCost: Number(it.unit_cost) || 0,
        discountPercent: it.discount_percent ?? undefined,
        total: Number(it.total) || 0,
        notes: it.notes ?? undefined,
        modifiers: Array.isArray(it.modifiers) ? it.modifiers : (it.modifiers ? JSON.parse(it.modifiers) : undefined),
        isVoided: Boolean(it.is_voided),
        voidReason: it.void_reason ?? undefined,
        sentToKitchen: Boolean(it.sent_to_kitchen),
        kitchenStatus: it.kitchen_status ?? it.kitchenStatus ?? undefined,
        preparedAt: it.prepared_at ?? it.preparedAt ?? undefined,
      }));

      const orderNorm: Order = {
        id: String(orderRow.id),
        orderNo: Number(orderRow.order_no) || 0,
        tableId: orderRow.table_no ? `t${orderRow.table_no}` : undefined,
        tableNo: orderRow.table_no ?? undefined,
        orderType: orderRow.order_type,
        status: orderRow.status,
        staffId: String(orderRow.staff_id ?? ''),
        staffName: orderRow.staff_name ?? '',
        items: itemsNormalized,
        subtotal: Number(orderRow.subtotal) || itemsNormalized.reduce((s, i) => s + i.total, 0),
        discountAmount: Number(orderRow.discount_amount ?? 0) || 0,
        discountPercent: Number(orderRow.discount_percent ?? 0) || 0,
        tax: Number(orderRow.tax ?? 0) || 0,
        total: Number(orderRow.total ?? 0) || 0,
        totalCost: Number(orderRow.total_cost ?? 0) || 0,
        grossProfit: Number(orderRow.gross_profit ?? 0) || 0,
        gpPercent: Number(orderRow.gp_percent ?? 0) || 0,
        createdAt: orderRow.created_at ?? new Date().toISOString(),
        sentAt: orderRow.sent_at ?? undefined,
        paidAt: orderRow.paid_at ?? undefined,
        paymentMethod: orderRow.payment_method ?? undefined,
      } as Order;

      return orderNorm;
    });

    // Preserve non-kitchen local orders and merge
    const preserved = getState().orders.filter(o => !o.items.some(it => it.sentToKitchen));
    const merged = [...fetchedOrders, ...preserved];
    save({ version: 1, orders: merged });
  } catch (e) {
    console.warn('[orderStore] fetchAndReplaceOrdersFromSupabase error', e);
  }
}
