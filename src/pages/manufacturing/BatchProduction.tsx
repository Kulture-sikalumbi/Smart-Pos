import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Plus, Factory, AlertTriangle, Trash2, ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import { PageHeader, DataTableWrapper, NumericCell, StatusBadge } from '@/components/common/PageComponents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import type { Recipe } from '@/types';
import { getManufacturingRecipesSnapshot, subscribeManufacturingRecipes } from '@/lib/manufacturingRecipeStore';
import { getStockItemsSnapshot, subscribeStockItems } from '@/lib/stockStore';
import { deleteBatchProduction, ensureBatchProductionsLoaded, getBatchProductionsSnapshot, recordBatchProduction, subscribeBatchProductions, BatchInsufficientStockError } from '@/lib/batchProductionStore';

export default function BatchProduction() {
  const recipes = useSyncExternalStore(subscribeManufacturingRecipes, getManufacturingRecipesSnapshot);
  const batches = useSyncExternalStore(subscribeBatchProductions, getBatchProductionsSnapshot);
  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);

  const [recordOpen, setRecordOpen] = useState(false);
  const [recipeId, setRecipeId] = useState<string>(() => recipes[0]?.id ?? '');
  const [batchDate, setBatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isLoading, setIsLoading] = useState(true);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [theoreticalOutput, setTheoreticalOutput] = useState<number>(0);
  const [actualOutput, setActualOutput] = useState<number>(0);
  const [producedBy, setProducedBy] = useState('Kitchen Staff');
  const [recipeSearchOpen, setRecipeSearchOpen] = useState(false);
  const [recipeSearchTerm, setRecipeSearchTerm] = useState('');

  const selectedRecipe = useMemo(() => recipes.find(r => r.id === recipeId) ?? recipes[0] ?? null, [recipes, recipeId]);

  useEffect(() => {
    if (!recordOpen) return;
    const r = recipes.find((x) => x.id === recipeId) ?? null;
    if (!r) return;
    setTheoreticalOutput(r.outputQty);
    setActualOutput(r.outputQty);
  }, [recordOpen, recipeId, recipes]);

  useEffect(() => {
    let cancelled = false;
    const loadBatches = async () => {
      setIsLoading(true);
      try {
        await ensureBatchProductionsLoaded();
      } catch (err) {
        console.warn('Failed to ensure batch data loaded', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void loadBatches();

    return () => {
      cancelled = true;
    };
  }, []);

  const openRecord = () => {
    const r = recipes[0] ?? null;
    setRecipeId(r?.id ?? '');
    setBatchDate(new Date().toISOString().slice(0, 10));
    setTheoreticalOutput(r ? r.outputQty : 0);
    setActualOutput(r ? r.outputQty : 0);
    setProducedBy('Kitchen Staff');
    setRecordOpen(true);
  };

  const submit = async () => {
    if (!selectedRecipe) {
      toast({ title: 'No recipe', description: 'Create a recipe first.' });
      return;
    }
    if (!actualOutput || actualOutput <= 0) {
      toast({ title: 'Invalid output', description: 'Actual output must be greater than 0.' });
      return;
    }
    const theo = theoreticalOutput > 0 ? theoreticalOutput : actualOutput;

    try {
      await recordBatchProduction({
        recipeId: selectedRecipe.id,
        batchDate,
        theoreticalOutput: theo,
        actualOutput,
        producedBy: producedBy.trim() || 'Kitchen Staff',
      });

      toast({ title: 'Batch recorded', description: 'Ingredients deducted and finished goods produced.' });
      setRecordOpen(false);
    } catch (e) {
      if (e instanceof BatchInsufficientStockError) {
        toast({
          title: 'Insufficient stock',
          description: `Not enough stock for ${e.items.length} ingredient(s).`,
          variant: 'destructive',
        });
        return;
      }
      toast({ title: 'Failed to record batch', description: (e as Error)?.message ?? 'Unknown error', variant: 'destructive' });
    }
  };

  return (
    <div>
      <PageHeader
        title="Batch Production"
        description="Record manufacturing batches and track yield variance"
        actions={<Button onClick={openRecord}><Plus className="h-4 w-4 mr-2" />Record Batch</Button>}
      />

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span>Loading batch records…</span>
        </div>
      ) : (
        <div className="space-y-4">
          {batches.map((batch) => (
            <Card key={batch.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10"><Factory className="h-5 w-5 text-primary" /></div>
                  <div>
                    <CardTitle className="text-base">{batch.recipeName}</CardTitle>
                    <p className="text-sm text-muted-foreground">{batch.batchDate} • By {batch.producedBy}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">K {batch.totalCost.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Unit: K {batch.unitCost.toFixed(2)}</p>
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deletingBatchId === batch.id}
                      onClick={async () => {
                        setDeletingBatchId(batch.id);
                        try {
                          await deleteBatchProduction(batch.id);
                          toast({ title: 'Batch deleted', description: `Batch ${batch.recipeName} removed successfully.` });
                        } catch (err) {
                          console.error('Delete batch failed', err);
                          toast({ title: 'Delete failed', description: (err as Error)?.message ?? 'Could not delete batch.', variant: 'destructive' });
                        } finally {
                          setDeletingBatchId(null);
                        }
                      }}
                    >
                      {deletingBatchId === batch.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 p-3 bg-muted/50 rounded-md">
                <div><p className="text-xs text-muted-foreground">Theoretical</p><p className="font-medium">{batch.theoreticalOutput}</p></div>
                <div><p className="text-xs text-muted-foreground">Actual</p><p className="font-medium">{batch.actualOutput}</p></div>
                <div>
                  <p className="text-xs text-muted-foreground">Yield Variance</p>
                  <p className={`font-medium ${batch.yieldVariance < 0 ? 'text-destructive' : 'text-success'}`}>
                    {batch.yieldVariance > 0 ? '+' : ''}{batch.yieldVariance} ({batch.yieldVariancePercent.toFixed(1)}%)
                  </p>
                </div>
                <div>
                  {batch.yieldVariance < 0 && (
                    <div className="flex items-center gap-1 text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-xs">Below target</span>
                    </div>
                  )}
                </div>
              </div>

              <DataTableWrapper>
                <Table className="data-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-right">Qty Used</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batch.ingredientsUsed.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>{i.ingredientName}</TableCell>
                        <TableCell className="text-right">{i.requiredQty} {i.unitType}</TableCell>
                        <TableCell className="text-right"><NumericCell value={i.unitCost} money /></TableCell>
                        <TableCell className="text-right"><NumericCell value={i.requiredQty * i.unitCost} money /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTableWrapper>
            </CardContent>
          </Card>
        ))}
      </div>
      )}

      <RecordBatchDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        recipes={recipes}
        stockItems={stockItems}
        recipeId={recipeId}
        setRecipeId={setRecipeId}
        batchDate={batchDate}
        setBatchDate={setBatchDate}
        theoreticalOutput={theoreticalOutput}
        setTheoreticalOutput={setTheoreticalOutput}
        actualOutput={actualOutput}
        setActualOutput={setActualOutput}
        producedBy={producedBy}
        setProducedBy={setProducedBy}
        recipeSearchOpen={recipeSearchOpen}
        setRecipeSearchOpen={setRecipeSearchOpen}
        onSubmit={submit}
      />
    </div>
  );
}

function RecordBatchDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipes: Recipe[];
  stockItems: Array<{ id: string; currentStock: number; unitType: string }>;
  recipeId: string;
  setRecipeId: (id: string) => void;
  batchDate: string;
  setBatchDate: (v: string) => void;
  theoreticalOutput: number;
  setTheoreticalOutput: (n: number) => void;
  actualOutput: number;
  setActualOutput: (n: number) => void;
  producedBy: string;
  setProducedBy: (v: string) => void;
  recipeSearchOpen: boolean;
  setRecipeSearchOpen: (open: boolean) => void;
  onSubmit: () => void;
}) {
  const r = props.recipes.find(x => x.id === props.recipeId) ?? null;

  const stockById = useMemo(() => new Map(props.stockItems.map((s) => [s.id, s] as const)), [props.stockItems]);

  const requiredPreview = useMemo(() => {
    if (!r) return [] as Array<{ id: string; name: string; requiredQty: number; unitType: string; onHandQty: number; ok: boolean }>;
    const outputQty = r.outputQty > 0 ? r.outputQty : 1;
    const multiplier = (Number.isFinite(props.actualOutput) ? props.actualOutput : 0) / outputQty;
    return r.ingredients.map((i) => {
      const requiredQty = i.requiredQty * multiplier;
      const onHand = stockById.get(i.ingredientId)?.currentStock ?? 0;
      return {
        id: i.id,
        name: i.ingredientName,
        requiredQty,
        unitType: i.unitType,
        onHandQty: onHand,
        ok: requiredQty <= onHand + 1e-9,
      };
    });
  }, [r, props.actualOutput, stockById]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record batch</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Recipe</Label>
            <Popover open={props.recipeSearchOpen} onOpenChange={props.setRecipeSearchOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full justify-between">
                  {r ? `${r.parentItemName} (${r.parentItemCode})` : 'Select recipe...'}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                  <CommandInput placeholder="Search recipes..." />
                  <CommandEmpty>No recipe found.</CommandEmpty>
                  <CommandGroup>
                    {props.recipes.map(rec => (
                      <CommandItem
                        key={rec.id}
                        value={rec.id}
                        onSelect={(currentValue) => {
                          props.setRecipeId(currentValue);
                          props.setRecipeSearchOpen(false);
                        }}
                      >
                        <Check className={cn('mr-2 h-4 w-4', props.recipeId === rec.id ? 'opacity-100' : 'opacity-0')} />
                        <div className="flex-1">
                          <div className="font-medium">{rec.parentItemName}</div>
                          <div className="text-xs text-muted-foreground">{rec.parentItemCode}</div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
            {r ? <div className="text-xs text-muted-foreground">Output per recipe: {r.outputQty} {r.outputUnitType} • Unit cost: K {r.unitCost.toFixed(2)}</div> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Batch date</Label>
              <Input type="date" value={props.batchDate} onChange={(e) => props.setBatchDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Produced by</Label>
              <Input value={props.producedBy} onChange={(e) => props.setProducedBy(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Theoretical output</Label>
              <Input type="number" min={0} step="0.01" value={props.theoreticalOutput} onChange={(e) => props.setTheoreticalOutput(Number(e.target.value || 0))} />
            </div>
            <div className="space-y-1">
              <Label>Actual output</Label>
              <Input type="number" min={0} step="0.01" value={props.actualOutput} onChange={(e) => props.setActualOutput(Number(e.target.value || 0))} />
            </div>
          </div>

          {r ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="text-sm font-medium">Ingredient consumption preview</div>
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>Based on actual output and the recipe quantities.</div>
              </div>

              <div className="mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-right">Required</TableHead>
                      <TableHead className="text-right">On hand</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requiredPreview.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="text-right">
                          {p.requiredQty.toFixed(2)} {p.unitType}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number.isFinite(p.onHandQty) ? p.onHandQty.toFixed(2) : '0.00'} {p.unitType}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={p.ok ? 'text-success' : 'text-destructive'}>
                            {p.ok ? 'OK' : 'LOW'}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!requiredPreview.length ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">No ingredients on this recipe.</TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Cancel</Button>
          <Button onClick={props.onSubmit}>Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
