import type { Recipe, RecipeIngredient, StockItem, UnitType } from '@/types';
// No seeded recipes: production data should be stored in the database
import { getStockItemsSnapshot } from '@/lib/stockStore';
import { getPosMenuItems, upsertPosMenuItem } from '@/lib/posMenuStore';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';

const STORAGE_KEY = 'mthunzi.manufacturing.recipes.v1';

type Listener = () => void;

let listeners: Listener[] = [];
let state: Recipe[] | null = null;
let currentBrandId: string | null = getActiveBrandId();

subscribeActiveBrandId(() => {
  currentBrandId = getActiveBrandId();
  state = null;
  emit();
});

function emit() {
  for (const l of listeners) l();
}

function persist(_next: Recipe[]) {
  // Persistence now handled by Supabase; keep noop for API compatibility
}

async function fetchFromDb() {
  if (!isSupabaseConfigured() || !supabase) return;

    try {
    // Read metadata from `manufacturing_recipes` and ingredients from
    // `manufacturing_recipe_ingredients`. Legacy `recipes` table is no longer used.
    const brandId = currentBrandId;
    if (!brandId) {
      state = [];
      emit();
      return;
    }

    let metas: any[] | null = null;
    let metaErr: any = null;
    ({ data: metas, error: metaErr } = await supabase.from('manufacturing_recipes').select('*').eq('brand_id', brandId));

    if (metaErr && String(metaErr.message ?? '').toLowerCase().includes('brand_id')) {
      // schema may not have brand_id on manufacturing_recipes; fall back to non-tenant filtered table
      ({ data: metas, error: metaErr } = await supabase.from('manufacturing_recipes').select('*'));
    }

    if (metaErr) {
      console.warn('Failed to fetch manufacturing_recipes', metaErr);
      return;
    }

    const stockSnapshot = getStockItemsSnapshot();
    const results: Recipe[] = [];

    for (const m of metas ?? []) {
      const ingredients: RecipeIngredient[] = [];

      try {
        const { data: ingRows, error: ingErr } = await supabase
          .from('manufacturing_recipe_ingredients')
          .select('quantity_used, unit, stock_item_id, stock_items(id,name,item_code,unit,cost_per_unit)')
          .eq('manufacturing_recipe_id', m.id)
          .eq('brand_id', brandId);

        if (ingErr) {
          console.warn('Failed to fetch manufacturing_recipe_ingredients for', m.id, ingErr);
        } else {
          for (const r of (ingRows ?? []) as any[]) {
            const si = r.stock_items;
            const stock = stockSnapshot.find((s) => s.id === (si?.id ?? r.stock_item_id));
            // Determine unit string stored on the ingredient row or fallback to stock unit
            const unitStr = (r.unit ?? si?.unit ?? stock?.unitType ?? 'each').toString();
            // Map textual unit to UnitType used by frontend
            const mapUnitToUnitType = (u: string): UnitType => {
              const uu = String(u ?? '').toLowerCase();
              if (uu === 'g' || uu === 'kg') return 'KG';
              if (uu === 'ml' || uu === 'l' || uu === 'ltr' || uu === 'ltrs') return 'LTRS';
              if (uu === 'pack') return 'PACK';
              return 'EACH';
            };

            ingredients.push({
              id: safeId('ri'),
              ingredientId: si?.id ?? r.stock_item_id,
              ingredientCode: si?.item_code ?? (stock?.code ?? ''),
              ingredientName: si?.name ?? (stock?.name ?? ''),
              requiredQty: Number(r.quantity_used) ?? 0,
              unit: unitStr?.toString(),
              unitType: mapUnitToUnitType(unitStr) as UnitType,
              unitCost: Number(si?.cost_per_unit ?? stock?.currentCost ?? 0),
            } as any);
          }
        }
      } catch (e) {
        console.warn('Failed to fetch manufacturing_recipe_ingredients for', m.id, e);
      }
      
      

      // determine whether this metadata row is tied to a product or standalone
      const hasProduct = !!m.product_id;
      const pid = hasProduct ? String(m.product_id) : undefined;

      // try to fetch a product record for friendly name/code when available
      let parentName = '';
      try {
        if (hasProduct && pid) {
          const { data: prod } = await supabase
            .from('products')
            .select('id,name,base_price')
            .eq('id', pid)
            .eq('brand_id', brandId)
            .maybeSingle();
          if (prod) parentName = prod.name ?? '';
        }
      } catch {
        // ignore
      }

      const recipeId = hasProduct && pid ? `prod-${pid}` : `meta-${String(m.id)}`;
      const parentItemId = hasProduct && pid ? pid : String(m.id);
      const parentItemCode = String(m.code ?? m.product_code ?? pid ?? m.id);
      const parentItemName = parentName || String(m.name ?? m.code ?? m.product_code ?? (pid ?? m.id));

      const recipe: Recipe = {
        id: recipeId,
        parentItemId: parentItemId,
        parentItemCode: parentItemCode,
        parentItemName: parentItemName,
        finishedGoodDepartmentId: m.finished_department_id ?? (m.finished_department ?? undefined) ?? '',
        outputQty: Number(m.output_qty) || 1,
        outputUnitType: (m.unit_type as UnitType) ?? 'EACH',
        ingredients,
        totalCost: 0,
        unitCost: 0,
      };

      results.push(recomputeRecipe(recipe, stockSnapshot));
    }

    state = results;
    persist(state);
    emit();
  } catch (err) {
    console.warn('Failed to fetch/assemble recipes from Supabase', err);
  }
}

function seed(): Recipe[] { return []; }

function ensureRemoteLoaded() {
  if (!state && isSupabaseConfigured() && supabase) {
    void fetchFromDb();
  }
}

function load(): Recipe[] {
  if (state) return state;
  ensureRemoteLoaded();
  // If Supabase is not configured or fetch is pending, return empty list to avoid crashes.
  state = [];
  return state;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function safeId(prefix: string) {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uuid}`;
}

function recomputeRecipe(recipe: Recipe, stockItems: StockItem[]): Recipe {
  const byId = new Map(stockItems.map((s) => [s.id, s] as const));
  // helper: map UnitType -> textual unit
  const mapUnitTypeToUnit = (u: UnitType | undefined): string => {
    switch (u) {
      case 'KG': return 'kg';
      case 'LTRS': return 'l';
      case 'PACK': return 'pack';
      case 'EACH':
      default:
        return 'each';
    }
  };

  const adjustUnitCost = (stockCost: number, stockUnitType: UnitType | undefined, ingredientUnitText?: string) => {
    const ing = String(ingredientUnitText ?? '').toLowerCase();
    const su = stockUnitType;
    if (!isFinite(stockCost)) return 0;
    if (ing === 'g' && su === 'KG') return stockCost / 1000;
    if (ing === 'kg' && su === 'KG') return stockCost;
    if (ing === 'ml' && su === 'LTRS') return stockCost / 1000;
    if ((ing === 'l' || ing === 'ltr' || ing === 'ltrs') && su === 'LTRS') return stockCost;
    // default: no conversion
    return stockCost;
  };

  const nextIngredients: RecipeIngredient[] = recipe.ingredients.map((i) => {
    const s = byId.get(i.ingredientId);
    // allow an explicit textual unit on the ingredient (e.g., 'g','ml')
    const ingUnitText = (i as any).unit ?? (s ? ((s as any).unit ?? mapUnitTypeToUnit(s?.unitType)) : undefined);
    const unitCost = s ? adjustUnitCost(s.currentCost, s?.unitType, ingUnitText) : i.unitCost;
    return {
      ...i,
      ingredientCode: s?.code ?? i.ingredientCode,
      ingredientName: s?.name ?? i.ingredientName,
      unitType: (s?.unitType ?? i.unitType) as UnitType,
      unitCost: round2(Number.isFinite(unitCost) ? unitCost : 0),
      requiredQty: Number.isFinite(i.requiredQty) ? i.requiredQty : 0,
    };
  });

  const totalCost = nextIngredients.reduce((sum, i) => sum + (Number.isFinite(i.requiredQty) ? i.requiredQty : 0) * (Number.isFinite(i.unitCost) ? i.unitCost : 0), 0);
  const outputQty = Number.isFinite(recipe.outputQty) && recipe.outputQty > 0 ? recipe.outputQty : 1;
  const unitCost = totalCost / outputQty;

  return {
    ...recipe,
    ingredients: nextIngredients,
    totalCost: round2(totalCost),
    unitCost: round2(unitCost),
  };
}

function syncRecipeCostToPos(recipe: Recipe) {
  try {
    const items = getPosMenuItems();
    const match = items.find((i) => String(i.code) === String(recipe.parentItemCode));
    if (!match) return;
    if (Math.abs((match.cost ?? 0) - recipe.unitCost) < 0.005) return;
    upsertPosMenuItem({ ...match, cost: recipe.unitCost });
  } catch {
    // ignore
  }
}

export function subscribeManufacturingRecipes(listener: Listener) {
  listeners = [...listeners, listener];
  // lazy load from Supabase when available
  if (!state && isSupabaseConfigured() && supabase) {
    void fetchFromDb();
  }

  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getManufacturingRecipesSnapshot(): Recipe[] {
  return load();
}

// Ensure remote recipes are loaded; returns after fetchFromDb completes when possible.
export async function ensureRecipesLoaded(): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    try {
      await fetchFromDb();
    } catch {
      // ignore
    }
  }
}

export function getManufacturingRecipeById(recipeId: string): Recipe | undefined {
  return load().find((r) => r.id === recipeId);
}

export async function upsertManufacturingRecipe(input: Omit<Recipe, 'id' | 'totalCost' | 'unitCost'> & { id?: string }) {
  const stockItems = getStockItemsSnapshot();

  const base: Recipe = {
    ...(input as Recipe),
    id: input.id && input.id.trim() ? input.id : safeId('recipe'),
    totalCost: 0,
    unitCost: 0,
  };

  const computed = recomputeRecipe(base, stockItems);

  const existing = load();
  const idx = existing.findIndex((r) => r.id === computed.id);
  const next = idx >= 0 ? existing.map((r) => (r.id === computed.id ? computed : r)) : [computed, ...existing];

  state = next;
  persist(next);
  emit();

  syncRecipeCostToPos(computed);

  // Try to persist to Supabase for canonical storage (recipes table maps product_id -> stock_item_id)
  if (isSupabaseConfigured() && supabase) {
    try {
      const brandId = currentBrandId;
      if (!brandId) throw new Error('Missing brand id');

      // For a one-to-one recipe relation, prefer product_id when parentItemId is a UUID
      let resolvedProductId: string | undefined = undefined;
      const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
      if (computed.parentItemId && uuidRe.test(String(computed.parentItemId))) {
        resolvedProductId = String(computed.parentItemId);
      }

      // In compatible schema, we may store link to product; but fallback to product_code for lookups.
      // Do not rely on products being present in this code path.
      const meta = {
        brand_id: brandId,
        product_id: resolvedProductId ?? null,
        product_code: computed.parentItemCode ?? null,
        name: computed.parentItemName ?? null,
        code: computed.parentItemCode ?? null,
        output_qty: computed.outputQty ?? 1,
        unit_type: computed.outputUnitType ?? 'EACH',
        finished_department_id: computed.finishedGoodDepartmentId ?? null,
      };

      // Strategy:
      // 1. Try to find an existing metadata row by (in order): explicit meta id, product_code, product_id.
      // 2. If found, `update` that row. Otherwise `insert` a new row.
      let upsertRes: any = null;
      try {
        const selectCols = 'id,product_id,product_code,name,code,output_qty,unit_type,finished_department_id';

        // Helper to find existing meta id
        let foundMetaId: string | undefined = undefined;

        // If input.id follows our `meta-<uuid>` pattern, prefer that as the metadata id
        if (input.id && typeof input.id === 'string' && input.id.startsWith('meta-')) {
          const possible = input.id.replace(/^meta-/, '');
          if (possible) foundMetaId = possible;
        }

        // If not found yet, try to locate by product_code
        if (!foundMetaId && computed.parentItemCode) {
          try {
            const { data: existing, error: exErr } = await supabase
              .from('manufacturing_recipes')
              .select('id')
              .eq('product_code', computed.parentItemCode)
              .eq('brand_id', brandId)
              .maybeSingle();
            if (!exErr && existing && (existing as any).id) foundMetaId = String((existing as any).id);
          } catch (e) {
            // ignore
          }
        }

        // If still not found, try by product_id when resolvedProductId present
        if (!foundMetaId && resolvedProductId) {
          try {
            const { data: existing2, error: ex2 } = await supabase
              .from('manufacturing_recipes')
              .select('id')
              .eq('product_id', resolvedProductId)
              .eq('brand_id', brandId)
              .maybeSingle();
            if (!ex2 && existing2 && (existing2 as any).id) foundMetaId = String((existing2 as any).id);
          } catch (e) {
            // ignore
          }
        }

        if (foundMetaId) {
          // update existing metadata row (with optional brand scoping)
          try {
            upsertRes = await supabase.from('manufacturing_recipes').update(meta).eq('id', foundMetaId).eq('brand_id', brandId).select(selectCols);
            if (upsertRes?.error && String(upsertRes.error.message ?? '').toLowerCase().includes('brand_id')) {
              upsertRes = await supabase.from('manufacturing_recipes').update(meta).eq('id', foundMetaId).select(selectCols);
            }
            if (upsertRes?.error) console.warn('manufacturing_recipes update error', upsertRes.error, upsertRes);
          } catch (e) {
            console.warn('manufacturing_recipes update exception', e);
          }
        } else {
          // insert new metadata row (with optional brand scoping)
          try {
            upsertRes = await supabase.from('manufacturing_recipes').insert([meta]).select(selectCols);
            if (upsertRes?.error && String(upsertRes.error.message ?? '').toLowerCase().includes('brand_id')) {
              const { data: retryData, error: retryErr } = await supabase.from('manufacturing_recipes').insert([{ ...meta, brand_id: undefined }]).select(selectCols);
              upsertRes = { data: retryData, error: retryErr };
            }
            if (upsertRes?.error) console.warn('manufacturing_recipes insert error', upsertRes.error, upsertRes);
          } catch (e) {
            console.warn('manufacturing_recipes insert exception', e);
          }
        }

      } catch (e) {
        console.warn('manufacturing_recipes upsert/insert failed', e);
      }

      // Extract meta id from response
      let metaId: string | undefined = undefined;
      if (upsertRes && upsertRes.data && Array.isArray(upsertRes.data) && upsertRes.data[0]) {
        metaId = String(upsertRes.data[0].id ?? upsertRes.data[0].product_id ?? upsertRes.data[0].id);
      }

      // If we couldn't get an id from public, try legacy erp schema as a fallback
      if (!metaId) {
        try {
          const up2 = await supabase!.schema('erp').from('manufacturing_recipes').upsert([meta]).select();
          if (up2 && up2.data && Array.isArray(up2.data) && up2.data[0]) metaId = String(up2.data[0].id ?? up2.data[0].product_id ?? up2.data[0].id);
        } catch (e) {
          // ignore
        }
      }

      // Persist ingredient rows into `manufacturing_recipe_ingredients` referencing manufacturing_recipes.id
      if (metaId) {
        // Delete existing ingredient rows for this meta to keep things idempotent
        try {
          const { error: delErr } = await supabase.from('manufacturing_recipe_ingredients').delete().eq('manufacturing_recipe_id', metaId);
          if (delErr) console.warn('Failed to delete existing manufacturing_recipe_ingredients', delErr);
        } catch (e) {
          // ignore
        }

        if (computed.ingredients.length) {
          const mapUnitTypeToUnit = (u: UnitType | undefined): string => {
            switch (u) {
              case 'KG': return 'kg';
              case 'LTRS': return 'l';
              case 'PACK': return 'pack';
              case 'EACH':
              default:
                return 'each';
            }
          };

          const rows = computed.ingredients.map((ing) => {
            // Try to prefer an explicit unit specified on the ingredient, then the stock item's native unit
            const stock = stockItems.find(s => s.id === ing.ingredientId);
            const explicitUnit = (ing as any).unit as string | undefined;
            const unit = explicitUnit ?? ((stock as any)?.unit ?? mapUnitTypeToUnit(stock?.unitType));
            return {
              manufacturing_recipe_id: metaId,
              stock_item_id: ing.ingredientId,
              quantity_used: ing.requiredQty,
              unit,
              brand_id: brandId,
            };
          });
          try {
            const { data: insData, error: insErr, status: insStatus } = await supabase.from('manufacturing_recipe_ingredients').insert(rows).select();
            if (insErr) console.warn('Failed to insert manufacturing_recipe_ingredients', { status: insStatus, error: insErr, data: insData });
          } catch (e) {
            try {
              await supabase!.schema('erp').from('manufacturing_recipe_ingredients').insert(rows).select();
            } catch {
              // ignore
            }
          }
        }
      }

      // Refresh canonical state from DB after writes
      try {
        await fetchFromDb();
      } catch {
        // ignore
      }
    } catch (err) {
      console.warn('Failed to sync recipe to Supabase', err);
    }
  } else {
    console.warn('Supabase not configured - manufacturing recipes will not be persisted');
  }

  return computed;
}

export async function deleteManufacturingRecipe(recipeId: string) {
  const existing = load();
  const removed = existing.find((r) => r.id === recipeId);
  // Optimistic in-memory remove
  state = existing.filter((r) => r.id !== recipeId);
  emit();

  if (!removed) return;

  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured - delete not persisted');
    return;
  }

  const brandId = currentBrandId;
  if (!brandId) throw new Error('Missing brand id');

  try {
    // Our `removed.id` uses either `meta-<metaId>` or `prod-<productId>`.
    if (removed.id && removed.id.startsWith('meta-')) {
      const metaId = removed.id.replace(/^meta-/, '');
      try {
        const { error: e1 } = await supabase.from('manufacturing_recipe_ingredients').delete().eq('manufacturing_recipe_id', metaId);
        if (e1) console.warn('Failed to delete manufacturing_recipe_ingredients by metadata id', e1);
      } catch (err) {
        console.warn('Supabase delete error', err);
      }

      try {
        let delRes = await supabase.from('manufacturing_recipes').delete().eq('id', metaId).eq('brand_id', brandId);
        if (delRes.error && String(delRes.error.message ?? '').toLowerCase().includes('brand_id')) {
          delRes = await supabase.from('manufacturing_recipes').delete().eq('id', metaId);
        }
        if (delRes.error) console.warn('Failed to delete manufacturing_recipes metadata by id', delRes.error);
      } catch (err) {
        console.warn('Supabase delete error', err);
      }
    } else if (removed.id && removed.id.startsWith('prod-')) {
      const productId = removed.parentItemId;
      try {
        let delRes = await supabase.from('manufacturing_recipes').delete().eq('product_id', productId).eq('brand_id', brandId);
        if (delRes.error && String(delRes.error.message ?? '').toLowerCase().includes('brand_id')) {
          delRes = await supabase.from('manufacturing_recipes').delete().eq('product_id', productId);
        }
        if (delRes.error) console.warn('Failed to delete manufacturing_recipes metadata by product_id', delRes.error);
      } catch (err) {
        console.warn('Supabase delete error', err);
      }
    } else {
      // Fallback: try to delete by metadata id stored in parentItemId
      const metaId = removed.parentItemId;
      try {
        const { error: e1 } = await supabase.from('manufacturing_recipe_ingredients').delete().eq('manufacturing_recipe_id', metaId);
        if (e1) console.warn('Failed to delete manufacturing_recipe_ingredients by metadata id (fallback)', e1);
      } catch (err) {
        console.warn('Supabase delete error', err);
      }

      try {
        let delRes = await supabase.from('manufacturing_recipes').delete().eq('id', metaId).eq('brand_id', brandId);
        if (delRes.error && String(delRes.error.message ?? '').toLowerCase().includes('brand_id')) {
          delRes = await supabase.from('manufacturing_recipes').delete().eq('id', metaId);
        }
        if (delRes.error) console.warn('Failed to delete manufacturing_recipes metadata by id (fallback)', delRes.error);
      } catch (err) {
        console.warn('Supabase delete error', err);
      }
    }

    // Refresh canonical state
    try { await fetchFromDb(); } catch { /* ignore */ }
  } catch (err) {
    console.warn('Failed to delete manufacturing recipe from Supabase', err);
  }
}

export function resetManufacturingRecipesToSeed() {
  // refresh from Supabase (no local seed)
  state = [];
  emit();
  if (isSupabaseConfigured() && supabase) void fetchFromDb();
}
