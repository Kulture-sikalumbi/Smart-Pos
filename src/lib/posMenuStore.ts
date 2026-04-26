import type { POSCategory, POSMenuItem } from '@/types/pos';
// No hardcoded defaults: rely on remote data or an explicit empty state
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';

const STORAGE_KEY = 'mthunzi.posMenu.v1';

function storageKeyForBrand(brandId: string | null) {
  return `${STORAGE_KEY}.${brandId ? String(brandId) : 'none'}`;
}

type PosMenuStateV1 = {
  version: 1;
  categories: POSCategory[];
  items: POSMenuItem[];
};

const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedState: PosMenuStateV1 | null = null;
let currentBrandId: string | null = getActiveBrandId();

const useRemote = isSupabaseConfigured() && supabase;
let remoteInitStarted = false;

function resetForBrand(nextBrandId: string | null) {
  currentBrandId = nextBrandId;
  cachedRaw = null;
  cachedState = null;
  remoteInitStarted = false;
}

// Reset state when brand changes to prevent cross-brand bleed.
subscribeActiveBrandId(() => {
  resetForBrand(getActiveBrandId());
  notify();
});

// No seeded images or hardcoded menu items. The store uses remote data or explicit local state.

function notify() {
  listeners.forEach((l) => l());
}

async function refreshFromSupabase() {
  if (!useRemote) return;
  try {
    const brandId = currentBrandId;
    if (!brandId) {
      cachedState = { version: 1, categories: [], items: [] };
      cachedRaw = JSON.stringify(cachedState);
      notify();
      return;
    }

    const client = supabase!.schema('erp');

    let catRows: any = null;
    let itemRows: any = null;

    // Prefer the public schema (categories/products) first because many projects
    // migrated away from the legacy `erp` pos_* tables. If public tables are
    // unavailable or the query fails, fall back to the legacy `erp` schema.
      try {
        // Use `departments` as the canonical table for categories in the public schema.
        const resCats = await supabase!
          .from('departments')
          .select('id,name')
          .eq('brand_id', brandId)
          .order('name', { ascending: true });
      if (resCats.error) throw resCats.error;

      // Map products to menu items. Expect `products` to have `id, code, name, category_id, base_price`.
      // include image_storage_path and description so UI can display images and details
      // avoid selecting `image_url` (may not exist) and avoid aliasing to keep PostgREST happy
      const resItems = await supabase!
        .from('products')
        .select('id,code,name,category_id,department_id,base_price,image_storage_path,description,physical_stock_item_id')
        .eq('brand_id', brandId);
      if (resItems.error) throw resItems.error;

      // Normalize rows to the expected shape used below
      catRows = (resCats.data ?? []).map((r: any) => ({ id: r.id, name: r.name, color: null, sort_order: 0 }));
      itemRows = (resItems.data ?? []).map((p: any) => ({
        id: p.id,
        code: p.code ?? '',
        name: p.name,
        // prefer department_id (legacy 'departments' used as categories), fall back to category_id
        category_id: p.department_id ?? p.category_id ?? null,
        price: p.base_price ?? 0,
        cost: null,
        // prefer storage path
        image: p.image_storage_path ?? undefined,
        description: p.description ?? undefined,
        is_available: true,
        modifier_groups: null,
        track_inventory: false,
        physical_stock_item_id: p.physical_stock_item_id ?? null,
      }));
    } catch (pubErr) {
      console.warn('[posMenuStore] refresh using public tables failed, retrying legacy erp schema', pubErr);
      try {
        const resCats = await client
          .from('pos_categories')
          .select('id,name,color,sort_order')
          .eq('brand_id', brandId)
          .order('sort_order', { ascending: true });
        if (resCats.error) throw resCats.error;
        const resItems = await client
          .from('pos_menu_items')
          .select('id,code,name,category_id,price,cost,image,is_available,modifier_groups,track_inventory')
          .eq('brand_id', brandId);
        if (resItems.error) throw resItems.error;
        catRows = resCats.data;
        itemRows = resItems.data;
      } catch (firstErr) {
        throw firstErr;
      }
    }

    const categories: POSCategory[] = (catRows ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      color: (r as any).color ?? undefined,
      sortOrder: Number((r as any).sort_order) || 0,
    }));

    const items: POSMenuItem[] = (itemRows ?? []).map((r) => ({
      id: String(r.id),
      code: String((r as any).code),
      name: String((r as any).name),
      categoryId: String((r as any).category_id),
      price: Number((r as any).price) || 0,
      cost: Number((r as any).cost) || 0,
      image: (r as any).image ?? undefined,
      isAvailable: Boolean((r as any).is_available),
      modifierGroups: ((r as any).modifier_groups as string[] | null) ?? undefined,
      trackInventory: Boolean((r as any).track_inventory),
      physicalStockItemId: (r as any).physical_stock_item_id ?? undefined,
    }));

    cachedState = { version: 1, categories, items };
    cachedRaw = JSON.stringify(cachedState);
    notify();
  } catch (e) {
    // Keep local snapshot if remote fails.
    console.error('[posMenuStore] Failed to load from Supabase', e);
  }
}

function parseRaw(raw: string): PosMenuStateV1 | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PosMenuStateV1>;
    if (parsed.version === 1 && Array.isArray(parsed.categories) && Array.isArray(parsed.items)) {
      return parsed as PosMenuStateV1;
    }
  } catch {
    // ignore
  }
  return null;
}

function seedDefaults(): PosMenuStateV1 {
  return { version: 1, categories: [], items: [] };
}

// No-op: we do not apply seeded images.
function applySeedImagesToState(state: PosMenuStateV1): PosMenuStateV1 {
  return state;
}

function ensureLoaded(): PosMenuStateV1 {
  const active = getActiveBrandId();
  if (active !== currentBrandId) {
    resetForBrand(active);
  }

  // IMPORTANT: `useSyncExternalStore` calls `getSnapshot` multiple times.
  // `getSnapshot` must return the exact same reference unless the store changed.
  // So we keep an in-memory snapshot and do NOT read localStorage during render.
  if (cachedState) return cachedState;

  if (typeof window === 'undefined') {
    const empty = seedDefaults();
    cachedState = empty;
    cachedRaw = JSON.stringify(empty);
    return empty;
  }

  // Remote mode: keep a stable in-memory snapshot and hydrate async.
  if (useRemote) {
    if (!cachedState) {
      const empty = seedDefaults();
      cachedState = empty;
      cachedRaw = JSON.stringify(empty);
    }
    if (!remoteInitStarted) {
      remoteInitStarted = true;
      void refreshFromSupabase();
    }
    return cachedState;
  }

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKeyForBrand(currentBrandId));
  } catch {
    raw = null;
  }

  if (raw) {
    const parsed = parseRaw(raw);
    if (parsed) {
      cachedRaw = raw;
      cachedState = parsed;
      return parsed;
    }
  }

  // No local data: start with empty state and persist that.
  const empty = seedDefaults();
  const emptyRaw = JSON.stringify(empty);
  try {
    localStorage.setItem(storageKeyForBrand(currentBrandId), emptyRaw);
  } catch {
    // ignore
  }
  cachedRaw = emptyRaw;
  cachedState = empty;
  return empty;
}

function save(state: PosMenuStateV1) {
  // Local mode only
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(storageKeyForBrand(currentBrandId), raw);
  } catch {
    // ignore
  }

  cachedRaw = raw;
  cachedState = state;
  notify();
}

export function subscribePosMenu(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPosMenuState(): PosMenuStateV1 {
  return ensureLoaded();
}

export function getPosCategories(): POSCategory[] {
  return ensureLoaded().categories.slice().sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getPosMenuItems(): POSMenuItem[] {
  return ensureLoaded().items.slice();
}

// Referentially-stable snapshot for useSyncExternalStore.
// Do not clone/derive here; returning a fresh array will trigger render loops.
export function getPosMenuItemsSnapshot(): POSMenuItem[] {
  return ensureLoaded().items;
}

export function upsertPosCategory(category: POSCategory) {
  if (useRemote && !currentBrandId) throw new Error('Missing brand id');
  const state = ensureLoaded();
  const idx = state.categories.findIndex((c) => c.id === category.id);
  const next = idx >= 0
    ? state.categories.map((c) => (c.id === category.id ? category : c))
    : [...state.categories, category];

  // Optimistic update
  cachedState = { ...state, categories: next };
  cachedRaw = JSON.stringify(cachedState);
  notify();

  if (!useRemote) {
    save(cachedState);
    return;
  }

  void (async () => {
    try {
      // Try erp.pos_categories first, fall back to public.categories
      try {
        const client = supabase!.schema('erp');
        const { data, error, status } = await client.from('pos_categories').upsert({
          id: category.id,
          brand_id: currentBrandId,
          name: category.name,
          color: category.color ?? null,
          sort_order: category.sortOrder,
          updated_at: new Date().toISOString(),
        }).select();
        if (error) throw { source: 'erp', status, error, data };
        await refreshFromSupabase();
        return;
      } catch (e) {
        // Try public.categories
      }

      const { data: pubData, error: pubErr, status: pubStatus } = await supabase!.from('departments').upsert({
        id: category.id,
        name: category.name,
        brand_id: currentBrandId,
      }).select();
      if (pubErr) {
        console.error('[posMenuStore] upsert category failed (public)', { status: pubStatus, error: pubErr, data: pubData });
      } else {
        await refreshFromSupabase();
      }
    } catch (e) {
      console.error('[posMenuStore] Failed to upsert category', e);
    }
  })();
}

export function deletePosCategory(categoryId: string) {
  if (useRemote && !currentBrandId) throw new Error('Missing brand id');
  const state = ensureLoaded();
  const nextState: PosMenuStateV1 = {
    ...state,
    categories: state.categories.filter((c) => c.id !== categoryId),
    items: state.items.filter((i) => i.categoryId !== categoryId),
  };

  cachedState = nextState;
  cachedRaw = JSON.stringify(nextState);
  notify();

  if (!useRemote) {
    save(nextState);
    return;
  }

  void (async () => {
    try {
      // Try erp schema first
      try {
        const client = supabase!.schema('erp');
        const { data: delItemsData, error: itemsErr, status: delItemsStatus } = await client
          .from('pos_menu_items')
          .delete()
          .eq('category_id', categoryId)
          .eq('brand_id', currentBrandId)
          .select();
        if (itemsErr) {
          console.error('[posMenuStore] delete category items failed (erp)', { status: delItemsStatus, error: itemsErr, data: delItemsData });
          return;
        }
        const { data: delCatData, error: delCatErr, status: delCatStatus } = await client
          .from('pos_categories')
          .delete()
          .eq('id', categoryId)
          .eq('brand_id', currentBrandId)
          .select();
        if (delCatErr) {
          console.error('[posMenuStore] delete category failed (erp)', { status: delCatStatus, error: delCatErr, data: delCatData });
          return;
        }
        await refreshFromSupabase();
        return;
      } catch (e) {
        // fallback to public
      }

      // public fallback: delete products with category then delete category
      const { data: delItemsData, error: itemsErr, status: delItemsStatus } = await supabase!
        .from('products')
        .delete()
        .or(`department_id.eq.${categoryId},category_id.eq.${categoryId}`)
        .eq('brand_id', currentBrandId)
        .select();
      if (itemsErr) {
        console.error('[posMenuStore] delete category items failed (public)', { status: delItemsStatus, error: itemsErr, data: delItemsData });
        return;
      }
      const { data: delCatData, error: delCatErr, status: delCatStatus } = await supabase!
        .from('departments')
        .delete()
        .eq('id', categoryId)
        .eq('brand_id', currentBrandId)
        .select();
      if (delCatErr) {
        console.error('[posMenuStore] delete category failed (public)', { status: delCatStatus, error: delCatErr, data: delCatData });
        return;
      }
      await refreshFromSupabase();
    } catch (e) {
      console.error('[posMenuStore] Failed to delete category', e);
    }
  })();
}

export async function upsertPosMenuItem(item: POSMenuItem): Promise<void> {
  if (useRemote && !currentBrandId) throw new Error('Missing brand id');
  const state = ensureLoaded();
  const idx = state.items.findIndex((i) => i.id === item.id);
  const next = idx >= 0 ? state.items.map((i) => (i.id === item.id ? item : i)) : [item, ...state.items];

  cachedState = { ...state, items: next };
  cachedRaw = JSON.stringify(cachedState);
  notify();

  if (!useRemote) {
    save(cachedState);
    return;
  }

  try {
    // Try legacy erp schema first
    try {
      const client = supabase!.schema('erp');
      const clientPayload: any = {
        id: item.id,
        brand_id: currentBrandId,
        code: item.code,
        name: item.name,
        // set category_id to null when not provided to avoid FK violations
        category_id: (item.categoryId && typeof item.categoryId === 'string') ? item.categoryId : null,
        price: item.price,
        cost: item.cost,
        image: item.image ?? null,
        is_available: item.isAvailable,
        modifier_groups: item.modifierGroups ?? null,
        track_inventory: item.trackInventory ?? false,
        updated_at: new Date().toISOString(),
      };

      const { data, error, status } = await client.from('pos_menu_items').upsert(clientPayload).select();
      if (error) throw { source: 'erp', status, error, data };
      await refreshFromSupabase();
      return;
    } catch (e) {
      // fallback to public.products
    }

    const pubPayload: any = {
      brand_id: currentBrandId,
      code: item.code,
      name: item.name,
      base_price: item.price,
      // Always include description (nullable) to avoid sending undefined
      description: (item as any).description ?? null,
      physical_stock_item_id: (item as any).physicalStockItemId ?? null,
    };
    if (item.image) {
      if (typeof item.image === 'string' && item.image.startsWith('http')) pubPayload.image_url = item.image;
      else pubPayload.image_storage_path = item.image;
    }
    const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (typeof item.id === 'string' && uuidRe.test(item.id)) pubPayload.id = item.id;
    if (item.categoryId && typeof item.categoryId === 'string' && uuidRe.test(item.categoryId)) pubPayload.department_id = item.categoryId;

    // Debug logging: show the payload and server response when an upsert fails
    try {
      console.debug('[posMenuStore] upsert products payload', pubPayload);
      const { data: pubData, error: pubErr, status: pubStatus } = await supabase!.from('products').upsert(pubPayload).select();
      if (pubErr) {
        console.error('[posMenuStore] upsert menu item failed (public)', { status: pubStatus, error: pubErr, data: pubData, payload: pubPayload });
        throw pubErr;
      }
    } catch (e) {
      // Re-throw so callers receive the original error while still logging
      console.error('[posMenuStore] upsert products exception', e, { payload: pubPayload });
      throw e;
    }
    await refreshFromSupabase();
  } catch (e) {
    console.error('[posMenuStore] Failed to upsert menu item', e);
    throw e;
  }
}

export async function deletePosMenuItem(itemId: string): Promise<void> {
  if (useRemote && !currentBrandId) throw new Error('Missing brand id');
  const state = ensureLoaded();
  const nextState: PosMenuStateV1 = { ...state, items: state.items.filter((i) => i.id !== itemId) };

  cachedState = nextState;
  cachedRaw = JSON.stringify(nextState);
  notify();

  if (!useRemote) {
    save(nextState);
    return;
  }

  try {
    try {
      const client = supabase!.schema('erp');
      const { data, error, status } = await client.from('pos_menu_items').delete().eq('id', itemId).eq('brand_id', currentBrandId).select();
      if (error) {
        console.error('[posMenuStore] delete menu item failed (erp)', { status, error, data });
        throw error;
      }
      await refreshFromSupabase();
      return;
    } catch (e) {
      // fallback to public
    }

    const { data, error, status } = await supabase!.from('products').delete().eq('id', itemId).eq('brand_id', currentBrandId).select();
    if (error) {
      console.error('[posMenuStore] delete menu item failed (public)', { status, error, data });
      throw error;
    }
    await refreshFromSupabase();
  } catch (e) {
    console.error('[posMenuStore] Failed to delete menu item', e);
    throw e;
  }
}

export function resetPosMenuToDefaults() {
  if (useRemote && !currentBrandId) throw new Error('Missing brand id');
  const seeded = seedDefaults();

  cachedRaw = JSON.stringify(seeded);
  cachedState = seeded;
  notify();

  if (!useRemote) {
    localStorage.setItem(storageKeyForBrand(currentBrandId), cachedRaw);
    return;
  }

  void (async () => {
    try {
      try {
        const client = supabase!.schema('erp');
        const { data: delItemsData, error: delItemsErr, status: delItemsStatus } = await client
          .from('pos_menu_items')
          .delete()
          .eq('brand_id', currentBrandId)
          .neq('id', '__never__')
          .select();
        if (delItemsErr) console.error('[posMenuStore] reset delete items failed (erp)', { status: delItemsStatus, error: delItemsErr, data: delItemsData });
        const { data: delCatsData, error: delCatsErr, status: delCatsStatus } = await client
          .from('pos_categories')
          .delete()
          .eq('brand_id', currentBrandId)
          .neq('id', '__never__')
          .select();
        if (delCatsErr) console.error('[posMenuStore] reset delete categories failed (erp)', { status: delCatsStatus, error: delCatsErr, data: delCatsData });

        const { data: catData, error: catErr, status: catStatus } = await client.from('pos_categories').insert(
          seeded.categories.map((c) => ({
            id: c.id,
            brand_id: currentBrandId,
            name: c.name,
            color: c.color ?? null,
            sort_order: c.sortOrder,
          }))
        ).select();
        if (catErr) console.error('[posMenuStore] reset insert categories failed (erp)', { status: catStatus, error: catErr, data: catData });

        const { data: itemData, error: itemErr, status: itemStatus } = await client.from('pos_menu_items').insert(
          seeded.items.map((i) => ({
            id: i.id,
            brand_id: currentBrandId,
            code: i.code,
            name: i.name,
            category_id: i.categoryId,
            price: i.price,
            cost: i.cost,
            image: i.image ?? null,
            is_available: i.isAvailable,
            modifier_groups: i.modifierGroups ?? null,
            track_inventory: i.trackInventory ?? false,
          }))
        ).select();
        if (itemErr) console.error('[posMenuStore] reset insert items failed (erp)', { status: itemStatus, error: itemErr, data: itemData });

        await refreshFromSupabase();
        return;
      } catch (e) {
        // fallback to public
      }

      try {
        const { data: delItemsData, error: delItemsErr, status: delItemsStatus } = await supabase!
          .from('products')
          .delete()
          .eq('brand_id', currentBrandId)
          .neq('id', '__never__')
          .select();
        if (delItemsErr) console.error('[posMenuStore] reset delete items failed (public)', { status: delItemsStatus, error: delItemsErr, data: delItemsData });
        const { data: delCatsData, error: delCatsErr, status: delCatsStatus } = await supabase!
          .from('departments')
          .delete()
          .eq('brand_id', currentBrandId)
          .neq('id', '__never__')
          .select();
        if (delCatsErr) console.error('[posMenuStore] reset delete categories failed (public)', { status: delCatsStatus, error: delCatsErr, data: delCatsData });

        const { data: catData, error: catErr, status: catStatus } = await supabase!.from('departments').insert(
          seeded.categories.map((c) => ({ id: c.id, name: c.name, brand_id: currentBrandId }))
        ).select();
        if (catErr) console.error('[posMenuStore] reset insert categories failed (public)', { status: catStatus, error: catErr, data: catData });

        const { data: itemData, error: itemErr, status: itemStatus } = await supabase!.from('products').insert(
          seeded.items.map((i) => ({ id: i.id, code: i.code, name: i.name, category_id: i.categoryId, department_id: i.categoryId, base_price: i.price, brand_id: currentBrandId }))
        ).select();
        if (itemErr) console.error('[posMenuStore] reset insert items failed (public)', { status: itemStatus, error: itemErr, data: itemData });

        await refreshFromSupabase();
      } catch (e) {
        console.error('[posMenuStore] Failed to reset menu in Supabase', e);
      }
    } catch (e) {
      console.error('[posMenuStore] Failed to reset menu in Supabase', e);
    }
  })();
}

// Cross-tab refresh
if (typeof window !== 'undefined' && !useRemote) {
  // Load eagerly once so `getSnapshot()` can stay stable.
  ensureLoaded();

  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;

    const nextRaw = e.newValue;
    if (nextRaw && nextRaw === cachedRaw) return;

    if (nextRaw) {
      const parsed = parseRaw(nextRaw);
      if (parsed) {
        cachedRaw = nextRaw;
        cachedState = parsed;
        notify();
        return;
      }
    }

    // Key removed or invalid data: re-seed.
    const seeded = seedDefaults();
    const raw = JSON.stringify(seeded);
    localStorage.setItem(STORAGE_KEY, raw);
    cachedRaw = raw;
    cachedState = seeded;
    notify();
  });
}
