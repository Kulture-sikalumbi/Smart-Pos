import type { BatchProduction, Recipe } from '@/types';
import { batchProductions as seededBatches } from '@/data/mockData';
import { getManufacturingRecipeById } from '@/lib/manufacturingRecipeStore';
import { applyBatchProductionToStock, revertBatchProductionFromStock } from '@/lib/stockStore';
import { logSensitiveAction } from '@/lib/systemAuditLog';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { getActiveBrandId, subscribeActiveBrandId } from '@/lib/activeBrand';

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

  const stockResult = await applyBatchProductionToStock({ recipe, batch: nextBatch });
  if (stockResult.ok !== true) {
    if ('insufficient' in stockResult) {
      throw new BatchInsufficientStockError(stockResult.insufficient);
    }
    throw new BatchInsufficientStockError([]);
  }

  // Save to Supabase if configured
  if (isSupabaseConfigured() && supabase && currentBrandId) {
    try {
      const { data: batchData, error: batchError } = await supabase
        .from('batch_productions')
        .insert({
          brand_id: currentBrandId,
          recipe_id: nextBatch.recipeId,
          recipe_name: nextBatch.recipeName,
          batch_date: nextBatch.batchDate,
          theoretical_output: nextBatch.theoreticalOutput,
          actual_output: nextBatch.actualOutput,
          yield_variance: nextBatch.yieldVariance,
          yield_variance_percent: nextBatch.yieldVariancePercent,
          total_cost: nextBatch.totalCost,
          unit_cost: nextBatch.unitCost,
          produced_by: nextBatch.producedBy,
        })
        .select()
        .single();

      if (batchError) {
        console.error('Failed to save batch production:', batchError);
        // Revert stock changes since DB save failed
        await revertBatchProductionFromStock({ recipe, batch: nextBatch });
        throw new Error(`Failed to save batch: ${batchError.message}`);
      }

      // Save ingredients
      const ingredientsToInsert = nextBatch.ingredientsUsed.map(ing => ({
        batch_production_id: batchData.id,
        ingredient_id: ing.ingredientId,
        ingredient_code: ing.ingredientCode,
        ingredient_name: ing.ingredientName,
        required_qty: ing.requiredQty,
        unit_type: ing.unitType,
        unit_cost: ing.unitCost,
      }));

      const { error: ingError } = await supabase
        .from('batch_production_ingredients')
        .insert(ingredientsToInsert);

      if (ingError) {
        console.error('Failed to save batch ingredients:', ingError);
        // Try to delete the batch record
        await supabase.from('batch_productions').delete().eq('id', batchData.id);
        // Revert stock changes
        await revertBatchProductionFromStock({ recipe, batch: nextBatch });
        throw new Error(`Failed to save batch ingredients: ${ingError.message}`);
      }

      // Update the batch ID to the database ID
      nextBatch.id = batchData.id;
    } catch (err) {
      console.error('Error saving batch to Supabase:', err);
      // Revert stock changes
      await revertBatchProductionFromStock({ recipe, batch: nextBatch });
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

  const revert = await revertBatchProductionFromStock({ recipe, batch: toDelete });
  if (revert.ok !== true) {
    const first = revert.insufficientFinishedGoods[0];
    throw new Error(
      first
        ? `Cannot delete batch: finished goods already used (need ${first.requiredQty}, on hand ${first.onHandQty}).`
        : 'Cannot delete batch: finished goods already used.'
    );
  }

  // Delete from Supabase if configured
  if (isSupabaseConfigured() && supabase) {
    try {
      const { error } = await supabase
        .from('batch_productions')
        .delete()
        .eq('id', batchId);

      if (error) {
        console.error('Failed to delete batch from Supabase:', error);
        // Revert stock changes since DB delete failed
        await applyBatchProductionToStock({ recipe, batch: toDelete });
        throw new Error(`Failed to delete batch: ${error.message}`);
      }
    } catch (err) {
      console.error('Error deleting batch from Supabase:', err);
      // Revert stock changes
      await applyBatchProductionToStock({ recipe, batch: toDelete });
      throw err;
    }
  }

  const next = existing.filter((b) => b.id !== batchId);
  state = next;
  emit();

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
