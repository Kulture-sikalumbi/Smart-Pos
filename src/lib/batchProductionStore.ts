import type { BatchProduction, Recipe } from '@/types';
import { batchProductions as seededBatches } from '@/data/mockData';
import { getManufacturingRecipeById } from '@/lib/manufacturingRecipeStore';
import { logSensitiveAction } from '@/lib/systemAuditLog';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';
import { getFrontStockSnapshot, refreshFrontStock } from '@/lib/frontStockStore';

const STORAGE_KEY = 'mthunzi.manufacturing.batches.v1';

type Listener = () => void;

let listeners: Listener[] = [];
let state: BatchProduction[] | null = null;
let currentBrandId: string | null = getActiveBrandId();

subscribeActiveBrandId(() => {
  currentBrandId = getActiveBrandId();
  state = null;
  emit();
});

function emit() {
  for (const l of listeners) l();
}

function persist(_next: BatchProduction[]) {
  // Persistence now handled by Supabase; keep noop for API compatibility
}

async function fetchFromDb() {
  if (!isSupabaseConfigured() || !supabase) return;

  try {
    const brandId = currentBrandId;
    if (!brandId) {
      state = [];
      emit();
      return;
    }

    const { data: batchRows, error: batchErr } = await supabase
      .from('batch_productions')
      .select('*')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false });

    if (batchErr) {
      console.warn('Failed to fetch batch_productions', batchErr);
      return;
    }

    const results: BatchProduction[] = [];

    for (const b of batchRows ?? []) {
      const ingredientsUsed: any[] = [];

      try {
        const { data: ingRows, error: ingErr } = await supabase
          .from('batch_production_ingredients')
          .select('*')
          .eq('batch_production_id', b.id);

        if (ingErr) {
          console.warn('Failed to fetch batch_production_ingredients for', b.id, ingErr);
        } else {
          for (const r of ingRows ?? []) {
            ingredientsUsed.push({
              id: r.id,
              ingredientId: r.ingredient_id,
              ingredientCode: r.ingredient_code || '',
              ingredientName: r.ingredient_name || '',
              requiredQty: Number(r.required_qty) || 0,
              unitType: r.unit_type as any || 'EACH',
              unitCost: Number(r.unit_cost) || 0,
            });
          }
        }
      } catch (e) {
        console.warn('Failed to fetch batch_production_ingredients for', b.id, e);
      }

      results.push({
        id: b.id,
        recipeId: b.recipe_id,
        recipeName: b.recipe_name,
        batchDate: b.batch_date,
        theoreticalOutput: Number(b.theoretical_output) || 0,
        actualOutput: Number(b.actual_output) || 0,
        yieldVariance: Number(b.yield_variance) || 0,
        yieldVariancePercent: Number(b.yield_variance_percent) || 0,
        ingredientsUsed,
        totalCost: Number(b.total_cost) || 0,
        unitCost: Number(b.unit_cost) || 0,
        producedBy: b.produced_by,
      });
    }

    state = results;
    emit();
  } catch (err) {
    console.warn('Failed to fetch/assemble batches from Supabase', err);
  }
}

function seed(): BatchProduction[] {
  return seededBatches.map((b) => ({
    ...b,
    ingredientsUsed: b.ingredientsUsed.map((i) => ({ ...i })),
  }));
}

function ensureRemoteLoaded() {
  if (!state && isSupabaseConfigured() && supabase) {
    void fetchFromDb();
  }
}

function load(): BatchProduction[] {
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

export class BatchInsufficientStockError extends Error {
  public readonly items: Array<{ itemId: string; requiredQty: number; onHandQty: number }>;

  constructor(items: Array<{ itemId: string; requiredQty: number; onHandQty: number }>) {
    super('Insufficient stock for batch production');
    this.name = 'BatchInsufficientStockError';
    this.items = items;
  }
}

function computeBatchFromRecipe(params: {
  recipe: Recipe;
  batchDate: string;
  theoreticalOutput: number;
  actualOutput: number;
  producedBy: string;
}): BatchProduction {
  const { recipe, batchDate, theoreticalOutput, actualOutput, producedBy } = params;

  const outputQty = recipe.outputQty > 0 ? recipe.outputQty : 1;
  const multiplier = actualOutput / outputQty;

  const ingredientsUsed = recipe.ingredients.map((i) => ({
    ...i,
    requiredQty: round2(i.requiredQty * multiplier),
  }));

  const totalCost = round2(recipe.totalCost * multiplier);
  const unitCost = actualOutput > 0 ? round2(totalCost / actualOutput) : 0;

  const yieldVariance = round2(actualOutput - theoreticalOutput);
  const yieldVariancePercent = theoreticalOutput > 0 ? round2((yieldVariance / theoreticalOutput) * 100) : 0;

  return {
    id: safeId('batch'),
    recipeId: recipe.id,
    recipeName: recipe.parentItemName,
    batchDate,
    theoreticalOutput,
    actualOutput,
    yieldVariance,
    yieldVariancePercent,
    ingredientsUsed,
    totalCost,
    unitCost,
    producedBy,
  };
}

export function subscribeBatchProductions(listener: Listener) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getBatchProductionsSnapshot(): BatchProduction[] {
  return load();
}

export async function ensureBatchProductionsLoaded(): Promise<void> {
  if (isSupabaseConfigured() && supabase) {
    await fetchFromDb();
  }
}

export async function recordBatchProduction(params: {
  recipeId: string;
  batchDate: string;
  theoreticalOutput: number;
  actualOutput: number;
  producedBy: string;
}) {
  const recipe = getManufacturingRecipeById(params.recipeId);
  if (!recipe) throw new Error('Recipe not found');

  const nextBatch = computeBatchFromRecipe({
    recipe,
    batchDate: params.batchDate,
    theoreticalOutput: params.theoreticalOutput,
    actualOutput: params.actualOutput,
    producedBy: params.producedBy,
  });

  // Ensure we are prechecking against fresh DB state (avoid stale localStorage snapshot).
  try { await refreshFrontStock(); } catch {}

  // Pre-check against front_stock(MANUFACTURING) so errors guide the user correctly.
  const manufacturingRows = getFrontStockSnapshot().filter((r) => String(r.locationTag).toUpperCase() === 'MANUFACTURING');
  const mByItemId = new Map(manufacturingRows.map((r) => [String(r.itemId), Number(r.quantity ?? 0) || 0] as const));
  const insufficient: Array<{ itemId: string; requiredQty: number; onHandQty: number }> = [];
  for (const ing of nextBatch.ingredientsUsed) {
    const required = Number.isFinite(ing.requiredQty) ? ing.requiredQty : 0;
    if (required <= 0) continue;
    const onHand = mByItemId.get(String(ing.ingredientId)) ?? 0;
    if (required > onHand + 1e-9) insufficient.push({ itemId: ing.ingredientId, requiredQty: required, onHandQty: onHand });
  }
  if (insufficient.length) throw new BatchInsufficientStockError(insufficient);

  // Save to Supabase if configured
  if (isSupabaseConfigured() && supabase && currentBrandId) {
    try {
      const ingredientsPayload = nextBatch.ingredientsUsed
        .filter((i) => Number.isFinite(i.requiredQty) && i.requiredQty > 0)
        .map((i) => ({
          ingredient_id: i.ingredientId,
          ingredient_code: i.ingredientCode,
          ingredient_name: i.ingredientName,
          required_qty: i.requiredQty,
          unit_type: i.unitType,
          unit_cost: i.unitCost,
        }));

      const { data: batchId, error: rpcErr } = await supabase.rpc('record_batch_production_front_stock', {
        p_brand_id: currentBrandId,
        p_recipe_id: nextBatch.recipeId,
        p_recipe_name: nextBatch.recipeName,
        p_batch_date: nextBatch.batchDate,
        p_theoretical_output: nextBatch.theoreticalOutput,
        p_actual_output: nextBatch.actualOutput,
        p_yield_variance: nextBatch.yieldVariance,
        p_yield_variance_percent: nextBatch.yieldVariancePercent,
        p_total_cost: nextBatch.totalCost,
        p_unit_cost: nextBatch.unitCost,
        p_produced_by: nextBatch.producedBy,
        p_finished_good_code: String(recipe.parentItemCode),
        p_ingredients: ingredientsPayload,
      } as any);

      if (rpcErr) {
        // Replace ingredient UUIDs in the error with friendly names when possible.
        const msg = String(rpcErr.message ?? rpcErr);
        const byId = new Map(nextBatch.ingredientsUsed.map((i) => [String(i.ingredientId), String(i.ingredientName ?? '')] as const));
        const rewritten = msg.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (id) => {
          const name = byId.get(id);
          return name ? `${name} (${id.slice(0, 8)})` : id;
        });
        throw new Error(rewritten);
      }
      nextBatch.id = String(batchId ?? nextBatch.id);
      // Force immediate stock refresh so UI reflects batch output instantly.
      try { await refreshFrontStock(); } catch {}
    } catch (err) {
      console.error('Error saving batch to Supabase:', err);
      throw err;
    }
  }

  // Update local state
  const existing = load();
  const next = [nextBatch, ...existing];
  state = next;
  emit();

  try {
    void logSensitiveAction({
      userId: `user:${params.producedBy}`,
      userName: params.producedBy,
      actionType: 'batch_production_record',
      reference: nextBatch.id,
      newValue: nextBatch.actualOutput,
      notes: `${nextBatch.recipeName} • Output ${nextBatch.actualOutput} (theoretical ${nextBatch.theoreticalOutput}) • variance ${nextBatch.yieldVariance} (${nextBatch.yieldVariancePercent}%)`,
      captureGeo: false,
    });
  } catch {
    // ignore
  }

  return nextBatch;
}

export async function deleteBatchProduction(batchId: string) {
  const existing = load();
  const toDelete = existing.find((b) => b.id === batchId) ?? null;
  if (!toDelete) return;

  const recipe = getManufacturingRecipeById(toDelete.recipeId);
  if (!recipe) throw new Error('Cannot delete batch: recipe not found.');

  // Delete from Supabase if configured
  if (isSupabaseConfigured() && supabase) {
    try {
      const brandId = currentBrandId ?? getActiveBrandId();
      if (!brandId) throw new Error('Missing brand id');
      const { error: rpcErr } = await supabase.rpc('delete_batch_production_front_stock', {
        p_brand_id: brandId,
        p_batch_id: batchId,
      } as any);
      if (rpcErr) throw new Error(String(rpcErr.message ?? rpcErr));
    } catch (err) {
      console.error('Error deleting batch from Supabase:', err);
      throw err;
    }
  }

  const next = existing.filter((b) => b.id !== batchId);
  state = next;
  emit();

  try { await refreshFrontStock(); } catch {}

  try {
    void logSensitiveAction({
      userId: `user:${toDelete.producedBy}`,
      userName: toDelete.producedBy,
      actionType: 'batch_production_delete',
      reference: toDelete.id,
      previousValue: toDelete.actualOutput,
      notes: `${toDelete.recipeName} batch deleted • ${toDelete.batchDate}`,
      captureGeo: false,
    });
  } catch {
    // ignore
  }
}

export function resetBatchProductionsToSeed() {
  state = seed();
  persist(state);
  emit();
}
