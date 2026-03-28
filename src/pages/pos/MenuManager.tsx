import { useCurrency } from '@/contexts/CurrencyContext';
import { useState, useEffect, useSyncExternalStore } from 'react';
import { PageHeader } from '@/components/common/PageComponents';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Pencil, RotateCcw, Upload, Check, ChevronsUpDown } from 'lucide-react';
import type { POSCategory, POSMenuItem } from '@/types/pos';
import { getManufacturingRecipesSnapshot, subscribeManufacturingRecipes, upsertManufacturingRecipe, getManufacturingRecipeById } from '@/lib/manufacturingRecipeStore';
import { getStockItemsSnapshot, subscribeStockItems } from '@/lib/stockStore';
import { RecipeEditorDialog } from '@/pages/manufacturing/Recipes';
import { getPosMenuItemsSnapshot, subscribePosMenu } from '@/lib/posMenuStore';
import { isSupabaseConfigured, supabase, SUPABASE_BUCKET } from '@/lib/supabaseClient';
import { usePosMenu } from '@/hooks/usePosMenu';
import { deletePosCategory, deletePosMenuItem, resetPosMenuToDefaults, upsertPosCategory, upsertPosMenuItem } from '@/lib/posMenuStore';
import { useAuth } from '@/contexts/AuthContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/hooks/use-toast';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import React from "react";
import { deleteItem } from "@/lib/crudDelete";
import { getCategoriesSnapshot, refreshCategories, subscribeCategories } from '@/lib/categoriesStore';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  image?: string;
  categoryId?: string;
  code?: string;
  description?: string;
}

const MenuManager: React.FC = () => {
  const { formatMoneyPrecise } = useCurrency();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<MenuItem>>({});
  const [recipes, setRecipes] = useState<{ id: string; parentItemName: string; parentItemCode: string }[]>([]);
  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);
  const [recipeEditorOpen, setRecipeEditorOpen] = useState(false);
  const categoriesSnap = useSyncExternalStore(subscribeCategories, getCategoriesSnapshot, getCategoriesSnapshot);
  const categories = categoriesSnap.categories;
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [isRetail, setIsRetail] = useState(false);
  const [selectedStockId, setSelectedStockId] = useState<string | undefined>(undefined);
  const [searchStockTerm, setSearchStockTerm] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [recipeModalMessage, setRecipeModalMessage] = useState<string | null>(null);
  const [recipeModalRecipeId, setRecipeModalRecipeId] = useState<string | null>(null);
  const [recipeToOpenId, setRecipeToOpenId] = useState<string | null>(null);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stockSuggestionsOpen, setStockSuggestionsOpen] = useState(false);
  const [confirmRetailModalOpen, setConfirmRetailModalOpen] = useState(false);
  const [pendingStockSelection, setPendingStockSelection] = useState<any>(null);
    const errs: string[] = [];
    const name = String(form.name ?? '').trim();
    const price = Number(form.price ?? 0);
    if (!name) errs.push('Name is required.');
    if (!Number.isFinite(price) || price <= 0) errs.push('Price must be a number greater than 0.');
    if (!((form as any).image)) errs.push('Please upload an image for the menu item (from Storage).');
    if (isRetail && !selectedStockId) errs.push('Select a stock item when Retail is enabled.');
    return errs;
  }, [form, isRetail, selectedStockId]);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const local = getPosMenuItemsSnapshot();
        if (mounted) setItems(local as any);
      } catch {
        if (mounted) setItems([]);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void load();

    const unsub = subscribePosMenu(() => {
      try {
        setItems(getPosMenuItemsSnapshot() as any);
      } catch {
        // ignore
      }
    });

    const unsubR = subscribeManufacturingRecipes(() => {
      try {
        const r = getManufacturingRecipesSnapshot().map((x) => ({ id: x.id, parentItemName: x.parentItemName, parentItemCode: x.parentItemCode }));
        setRecipes(r);
      } catch {
        // ignore
      }
    });

    // seed initial recipes and categories
    try {
      const r = getManufacturingRecipesSnapshot().map((x) => ({ id: x.id, parentItemName: x.parentItemName, parentItemCode: x.parentItemCode }));
      setRecipes(r);
      try { /* categories loaded separately from departments */ } catch {}
    } catch {
      // ignore
    }

    return () => {
      mounted = false;
      unsub();
      try { unsubR(); } catch {}
    };
  }, []);

  // Keep preview in sync when editing existing items
  useEffect(() => {
    const img = (form as any).image ?? '';
    if (!img) { setPreviewUrl(undefined); return; }
    // If it's a URL show directly, otherwise try to resolve from storage
    if (typeof img === 'string' && img.startsWith('http')) {
      setPreviewUrl(img);
      return;
    }
    if (isSupabaseConfigured() && supabase && typeof img === 'string') {
      try {
        const path = img.replace(/^\/+/, '');
        const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
        const pub = (data as any)?.publicUrl ?? undefined;
        if (!pub) console.debug('[MenuManager] getPublicUrl returned no publicUrl for', path, data);
        setPreviewUrl(pub);
      } catch {
        setPreviewUrl(undefined);
      }
    }
  }, [form.image]);

  useEffect(() => {
    // Best-effort refresh of categories when entering.
    void refreshCategories().catch(() => {});
  }, []);

  const handleSave = async () => {
    // Validate before attempting save
    if (validationErrors.length) {
      setValidationMessage(validationErrors.join('\n'));
      setValidationModalOpen(true);
      return;
    }
    setIsSaving(true);
    // Map small MenuItem -> POSMenuItem shape for store
    const payload: any = {
      id: editing?.id ?? String(Date.now()),
      name: String(form.name ?? ''),
      price: Number(form.price ?? 0) || 0,
      cost: 0,
      image: form.image ?? undefined,
      isAvailable: true,
      modifierGroups: undefined,
      trackInventory: false,
      description: String((form as any).description ?? ''),
    };
    // include categoryId only when explicitly provided
    if ((form as any).categoryId) payload.categoryId = String((form as any).categoryId);
    // Only include code when explicitly provided by the user (keep it optional)
    if ((form as any).code && String((form as any).code).trim()) payload.code = String((form as any).code).trim();

    // Require an uploaded image path from storage
    if (!((form as any).image)) {
      setValidationMessage('Please upload an image for the menu item (from Storage)');
      setValidationModalOpen(true);
      setIsSaving(false);
      return;
    }

    try {
      // ensure a code exists for product linking
      if (!payload.code || !String(payload.code).trim()) payload.code = `SKU-${Date.now().toString().slice(-6)}`;

      await upsertPosMenuItem(payload);

      // If this is a retail-ready item, create a simple 1:1 manufacturing recipe linking to selected stock
      if (isRetail && selectedStockId) {
        try {
          const stock = stockItems.find((s) => s.id === selectedStockId);
          const created = await upsertManufacturingRecipe({
            parentItemCode: payload.code,
            parentItemName: payload.name,
            parentItemId: payload.id,
            outputQty: 1,
            outputUnitType: 'EACH',
            ingredients: [
              {
                ingredientId: selectedStockId,
                requiredQty: 1,
                ingredientName: stock?.name ?? '',
              },
            ],
          } as any);
          // Notify user via toast and modal about the auto-created retail recipe
          try { toast({ title: 'Retail recipe created', description: `Linked to ${stock?.name ?? 'stock item'}` }); } catch {}
          try {
            setRecipeModalRecipeId(created?.id ?? null);
            setRecipeModalMessage(`A retail recipe was automatically created and linked to "${stock?.name ?? 'stock item'}".`);
            setRecipeModalOpen(true);
          } catch {}
        } catch (e) {
          console.warn('Failed to auto-create retail recipe', e);
          try { toast({ title: 'Retail recipe failed', description: 'Could not auto-create retail recipe.' }); } catch {}
        }
      }

      // reflect authoritative snapshot from store
      setItems(getPosMenuItemsSnapshot().map((i) => ({ id: i.id, name: i.name, price: i.price, image: i.image, description: (i as any).description })) as any);
    } catch (err) {
      console.error('Save failed', err);
      // fallback local optimistic update
      if (editing) setItems(items.map(i => i.id === editing.id ? { ...editing, ...form } as MenuItem : i));
      else setItems([...items, { ...form, id: String(Date.now()) } as MenuItem]);
      alert('Failed to save item to remote. Check console for details.');
    }

    setShowModal(false);
    setEditing(null);
    setForm({});
    setIsRetail(false);
    setSelectedStockId(undefined);
    setSearchStockTerm('');
    setStockSuggestionsOpen(false);
    setConfirmRetailModalOpen(false);
    setPendingStockSelection(null);
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    // Optimistically remove from UI
    setItems((prev) => prev.filter(i => i.id !== id));

    // Attempt store delete; await result and refresh authoritative snapshot
    try {
      await deletePosMenuItem(id);
      setItems(getPosMenuItemsSnapshot().map((i) => ({ id: i.id, name: i.name, price: i.price, image: i.image })) as any);
    } catch (err) {
      console.error('Delete failed', err);
      // fallback attempt via API helper
      try {
        await deleteItem('products', id);
        setItems((prev) => prev.filter(i => i.id !== id));
      } catch (e) {
        console.error('Delete fallback failed', e);
        alert('Failed to delete item. It may still exist remotely.');
        // refresh from store to reflect remote state
        setItems(getPosMenuItemsSnapshot().map((i) => ({ id: i.id, name: i.name, price: i.price, image: i.image })) as any);
      }
    }
  };

  const openAddModal = () => {
    setEditing(null);
    setForm({});
    setIsRetail(false);
    setSelectedStockId(undefined);
    setSearchStockTerm('');
    setStockSuggestionsOpen(false);
    setConfirmRetailModalOpen(false);
    setPendingStockSelection(null);
    setShowModal(true);
  };

  const openEditModal = (item: MenuItem) => {
    setEditing(item);
    setForm(item);
    setStockSuggestionsOpen(false);
    setConfirmRetailModalOpen(false);
    setPendingStockSelection(null);
    // try to detect if a recipe exists linked to this item and prefill retail/stock
    try {
      const linked = recipes.find(r => String(r.parentItemCode) === String((item as any).code));
      if (linked) {
        setIsRetail(true);
        // Try to find first ingredient stock item for this recipe
        const recipe = getManufacturingRecipesSnapshot().find(x => x.id === linked.id);
        if (recipe && recipe.ingredients && recipe.ingredients.length) setSelectedStockId(recipe.ingredients[0].ingredientId);
      } else {
        setIsRetail(false);
        setSelectedStockId(undefined);
      }
    } catch {
      setIsRetail(false);
      setSelectedStockId(undefined);
    }
    setShowModal(true);
  };

  return (
    <div>
      <PageHeader title="POS Menu" description="Manage items sold at the POS" actions={<Button onClick={openAddModal}><Plus className="h-4 w-4 mr-2" />Add Menu Item</Button>} />

      {isLoading ? (
        <div className="flex items-center justify-center h-64 w-full">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />
          <span>Loading menu items…</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {items.map((item) => {
          // Resolve image preview (storage path or remote URL)
          let imgSrc: string | undefined = undefined;
          // Find linked recipe (by matching code)
          const linkedRecipe = recipes.find(r => String(r.parentItemCode) === String((item as any).code));
          try {
            const img = (item as any).image;
            if (img) {
              if (typeof img === 'string' && img.startsWith('http')) imgSrc = img;
              else if (isSupabaseConfigured() && supabase && typeof img === 'string') {
                try {
                  const path = (img as string).replace(/^\/+/, '');
                  const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
                  imgSrc = (data as any)?.publicUrl ?? undefined;
                  if (!imgSrc) console.debug('[MenuManager] card getPublicUrl returned no publicUrl for', path, data);
                } catch (err) {
                  console.debug('[MenuManager] failed to getPublicUrl', err);
                  imgSrc = undefined;
                }
              }
            }
          } catch (e) {
            console.debug('[MenuManager] image resolve error', e);
            imgSrc = undefined;
          }

          return (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm">{item.name}</CardTitle>
                    {(item as any).code ? (
                      <div className="text-xs text-muted-foreground mt-1">Code: {(item as any).code}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button aria-label={`Edit ${item.name}`} variant="ghost" size="icon" onClick={() => openEditModal(item as any)}><Pencil className="h-4 w-4" /></Button>
                    <Button aria-label={`Delete ${item.name}`} variant="ghost" size="icon" onClick={() => handleDelete(item.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 items-start">
                  {imgSrc ? (
                    <img src={imgSrc} alt={item.name} className="h-36 w-36 object-cover rounded-md shadow-sm flex-shrink-0" />
                  ) : (
                    <div className="h-36 w-36 bg-muted-foreground/10 rounded-md flex items-center justify-center text-sm text-muted-foreground">No image</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-muted-foreground font-medium">Price: {formatMoneyPrecise(Number(item.price), 2)}</div>
                    {(item as any).description ? (
                      <div className="mt-2 text-sm text-muted-foreground break-words">{(item as any).description}</div>
                    ) : null}
                    <div className="mt-2 text-sm text-muted-foreground">Recipe: {linkedRecipe ? linkedRecipe.parentItemName : 'None'}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      )}

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle>{editing ? 'Edit Menu Item' : 'Add Menu Item'}</DialogTitle>
              <DialogDescription className="sr-only">Add or edit a menu item</DialogDescription>
            </div>
            {!editing && !isRetail && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={isRetail} onCheckedChange={(v: any) => setIsRetail(Boolean(v))} />
                  <div className="text-sm">Retail Item? (Link to Ready-to-Sell Stock) </div>
                </div>
              </div>
            )}
          </DialogHeader>

          <div className="grid gap-3">
            {isRetail && selectedStockId ? (
              <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-blue-900 dark:text-blue-100">Retail Item Linked</div>
                    <div className="text-xs text-blue-700 dark:text-blue-300">
                      Connected to stock item: {stockItems.find(s => s.id === selectedStockId)?.name}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsRetail(false);
                      setSelectedStockId(undefined);
                      setSearchStockTerm('');
                    }}
                  >
                    Change
                  </Button>
                </div>
              </div>
            ) : isRetail ? (
              <div className="relative">
                <Label>Which stock item?</Label>
                <input
                  className="w-full px-3 py-2 rounded border bg-background text-sm"
                  placeholder="Search stock..."
                  value={searchStockTerm}
                  onChange={(e) => setSearchStockTerm(e.target.value)}
                />
                <div className="absolute z-40 left-0 right-0 bg-card rounded mt-1 shadow max-h-40 overflow-auto">
                  {stockItems.filter(s => {
                    if (!searchStockTerm) return true;
                    const q = searchStockTerm.toLowerCase();
                    return String(s.name ?? '').toLowerCase().includes(q) || String((s as any).code ?? (s as any).item_code ?? '').toLowerCase().includes(q);
                  }).slice(0,50).map(s => (
                    <div key={s.id} className="px-3 py-2 hover:bg-accent cursor-pointer flex items-center justify-between" onClick={() => {
                      setSelectedStockId(s.id);
                      setSearchStockTerm(`${s.name} — ${((s as any).code ?? (s as any).item_code ?? s.id)}`);
                      // When retail is enabled and a stock item is selected, prefill form fields
                      try {
                        const suggestedName = s.name ?? '';
                        const suggestedCode = (s as any).code ?? (s as any).item_code ?? '';
                        const suggestedPrice = (typeof (s as any).currentCost === 'number' ? (s as any).currentCost : undefined);
                        setForm(prev => ({ ...prev, name: suggestedName, code: suggestedCode, price: suggestedPrice ?? prev.price, categoryId: (s as any).departmentId ?? prev.categoryId }));
                      } catch {
                        // ignore prefill errors
                      }
                    }}>
                      <div className="text-sm">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{Number(s.currentStock ?? 0).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Link to Recipe (optional)</Label>
                <Select value={(form as any).code ?? '__none__'} onValueChange={(v) => {
                  if (v === '__none__') { setForm({ ...form, code: '' }); return; }
                  const sel = recipes.find(r => r.parentItemCode === v || r.id === v);
                  if (sel) setForm({ ...form, name: sel.parentItemName, code: sel.parentItemCode });
                  else setForm({ ...form, code: v });
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="(none)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(none)</SelectItem>
                    {recipes.map((r) => (
                      <SelectItem key={r.id} value={r.parentItemCode || r.id}>{r.parentItemName} — {r.parentItemCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {((form.name ?? '').toString().trim() && ((form as any).code ?? '').toString().trim()) ? (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => setRecipeEditorOpen(true)}><Plus className="h-4 w-4 mr-2" />Add recipe</Button>
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={(form as any).categoryId ?? '__none__'} onValueChange={(v) => {
                if (v === '__none__') { setForm({ ...form, categoryId: undefined }); return; }
                setForm({ ...form, categoryId: v });
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="(none)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none)</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Name</Label>
              <Popover open={stockSuggestionsOpen} onOpenChange={setStockSuggestionsOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={stockSuggestionsOpen}
                    className="w-full justify-between"
                  >
                    {form.name || "Search stock items or enter name..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                  <Command>
                    <CommandInput
                      placeholder="Search stock items..."
                      value={form.name || ''}
                      onValueChange={(value) => {
                        setForm({ ...form, name: value });
                        setStockSuggestionsOpen(true);
                      }}
                    />
                    <CommandEmpty>No stock items found.</CommandEmpty>
                    <CommandGroup>
                      {stockItems
                        .filter(s => {
                          if (!form.name) return true;
                          const q = (form.name || '').toLowerCase();
                          return String(s.name ?? '').toLowerCase().includes(q) ||
                                 String(s.code ?? '').toLowerCase().includes(q);
                        })
                        .slice(0, 10)
                        .map(s => (
                          <CommandItem
                            key={s.id}
                            value={s.name}
                            onSelect={() => {
                              // Prefill form with stock item details
                              setForm({
                                ...form,
                                name: s.name,
                                code: s.code,
                                price: s.currentCost || form.price,
                                categoryId: s.departmentId || form.categoryId
                              });
                              setSelectedStockId(s.id);
                              setIsRetail(true);
                              setStockSuggestionsOpen(false);
                              // Show confirmation about creating direct recipe
                              setPendingStockSelection(s);
                              setConfirmRetailModalOpen(true);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedStockId === s.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{s.name}</span>
                              <span className="text-xs text-muted-foreground">
                                Code: {s.code} | Stock: {s.currentStock?.toFixed(2) || '0.00'} | Cost: {formatMoneyPrecise(s.currentCost || 0, 2)}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label>Code (optional)</Label>
              <div className="flex gap-2">
                <Input value={(form as any).code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                <Button onClick={() => setForm({ ...form, code: `SKU-${Date.now().toString().slice(-6)}` })}>Auto-generate SKU</Button>
              </div>
              <div className="text-sm text-muted-foreground">Optional: add a SKU/code to link to recipes later. Leave empty to add later.</div>
            </div>

            <div className="space-y-1">
              <Label>Price</Label>
              <Input type="number" value={form.price ?? ''} onChange={(e) => setForm({ ...form, price: e.target.value ? Number(e.target.value) : undefined })} />
            </div>

            <div className="space-y-1">
              <Label>Add product item image (upload from Storage)</Label>
              <input type="file" accept="image/*" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (!isSupabaseConfigured() || !supabase) {
                  alert('Supabase not configured - cannot upload image');
                  return;
                }
                try {
                  setUploading(true);
                  const bucket = SUPABASE_BUCKET;
                  const path = `${Date.now()}-${f.name.replace(/\s+/g, '_')}`;
                  const res = await supabase.storage.from(bucket).upload(path, f);
                  if (res.error) {
                    console.error('Supabase storage.upload error', res);
                    alert('Image upload failed: ' + (res.error.message || 'unknown error') + '\nCheck bucket name and permissions');
                    return;
                  }
                  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
                  setForm({ ...form, image: path });
                  setPreviewUrl((data as any)?.publicUrl ?? undefined);
                } catch (err) {
                  console.error('Image upload exception', err);
                  alert('Image upload failed: ' + String(err));
                } finally {
                  setUploading(false);
                }
              }} />
              <div>
                {uploading ? <div className="text-sm text-muted-foreground">Uploading…</div> : null}
                {previewUrl ? <img src={previewUrl} alt="preview" className="h-24 w-24 object-cover mt-2" /> : null}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input value={(form as any).description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white/60 mr-2" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        <Dialog open={recipeModalOpen} onOpenChange={setRecipeModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Retail Recipe Created</DialogTitle>
              <DialogDescription>{recipeModalMessage}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setRecipeModalOpen(false)}>Close</Button>
              {recipeModalRecipeId ? (
                <Button onClick={() => {
                  try {
                    setRecipeModalOpen(false);
                    // Navigate to Recipes page and pass recipe id in location state
                    navigate('/manufacturing/recipes', { state: { openRecipeId: recipeModalRecipeId } });
                  } catch {
                    // ignore
                  }
                }}>View Recipe</Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={validationModalOpen} onOpenChange={setValidationModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Validation</DialogTitle>
              <DialogDescription>{validationMessage}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setValidationModalOpen(false)}>OK</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmRetailModalOpen} onOpenChange={setConfirmRetailModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Direct Recipe</DialogTitle>
              <DialogDescription>
                You're linking this menu item directly to the stock item "{pendingStockSelection?.name}".
                This will automatically create a 1:1 manufacturing recipe that connects the menu item to this stock item for inventory tracking.
                <br /><br />
                When this item is sold, it will deduct 1 unit from the stock item's inventory.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setConfirmRetailModalOpen(false);
                setPendingStockSelection(null);
                // Reset to manual entry mode
                setIsRetail(false);
                setSelectedStockId(undefined);
              }}>
                Cancel
              </Button>
              <Button onClick={() => {
                setConfirmRetailModalOpen(false);
                setPendingStockSelection(null);
                // Keep the retail setup
              }}>
                OK, Create Recipe
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

          <RecipeEditorDialog
            open={recipeEditorOpen}
            onOpenChange={(open) => { setRecipeEditorOpen(open); if (!open) setRecipeToOpenId(null); }}
            editing={recipeToOpenId ? getManufacturingRecipeById(recipeToOpenId) ?? null : null}
            stockItems={stockItems}
            initialValues={{ parentItemName: String(form.name ?? ''), parentItemCode: String((form as any).code ?? ''), parentItemId: String((form as any).categoryId ?? '') }}
            onSaved={(r) => {
              // link created recipe to current form
              try {
                setForm({ ...form, code: r.parentItemCode, name: r.parentItemName });
              } catch {
                // ignore
              }
            }}
          />
    </div>
  );
};

export default MenuManager;

