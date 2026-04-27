import { useCurrency } from '@/contexts/CurrencyContext';
import { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import { PageHeader } from '@/components/common/PageComponents';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Pencil, RotateCcw, Upload, Check, ChevronsUpDown } from 'lucide-react';
import type { POSCategory, POSMenuItem } from '@/types/pos';
import { getManufacturingRecipesSnapshot, subscribeManufacturingRecipes, getManufacturingRecipeById } from '@/lib/manufacturingRecipeStore';
import { getStockItemsSnapshot, subscribeStockItems } from '@/lib/stockStore';
import { RecipeEditorDialog } from '@/pages/manufacturing/Recipes';
import { getPosMenuItemsSnapshot, subscribePosMenu } from '@/lib/posMenuStore';
import { getFrontStockSnapshot, subscribeFrontStock } from '@/lib/frontStockStore';
import { isSupabaseConfigured, supabase, SUPABASE_BUCKET } from '@/lib/supabaseClient';
import { usePosMenu } from '@/hooks/usePosMenu';
import { deletePosCategory, deletePosMenuItem, resetPosMenuToDefaults, upsertPosCategory, upsertPosMenuItem } from '@/lib/posMenuStore';
import { useAuth } from '@/contexts/AuthContext';
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
  physicalStockItemId?: string;
}

const MenuManager: React.FC = () => {
  const { formatMoneyPrecise } = useCurrency();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<Partial<MenuItem>>({});
  const [recipes, setRecipes] = useState<{ id: string; parentItemName: string; parentItemCode: string }[]>([]);
  const stockItems = useSyncExternalStore(subscribeStockItems, getStockItemsSnapshot);
  const frontStock = useSyncExternalStore(subscribeFrontStock, getFrontStockSnapshot);
  const [recipeEditorOpen, setRecipeEditorOpen] = useState(false);
  const categoriesSnap = useSyncExternalStore(subscribeCategories, getCategoriesSnapshot, getCategoriesSnapshot);
  const categories = categoriesSnap.categories;
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [recipeModalMessage, setRecipeModalMessage] = useState<string | null>(null);
  const [recipeModalRecipeId, setRecipeModalRecipeId] = useState<string | null>(null);
  const [recipeToOpenId, setRecipeToOpenId] = useState<string | null>(null);
  const [validationModalOpen, setValidationModalOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stockSuggestionsOpen, setStockSuggestionsOpen] = useState(false);
  const [nameSuggestionsOpen, setNameSuggestionsOpen] = useState(false);
  const [showUnmatchedNameHint, setShowUnmatchedNameHint] = useState(false);
  const saleFrontStockOptions = useMemo(() => {
    const byId = new Map(stockItems.map((s) => [String(s.id), s] as const));
    return (frontStock ?? [])
      .filter((r) => String(r.locationTag).toUpperCase() === 'SALE')
      .map((r) => {
        const meta = byId.get(String(r.itemId));
        const name = String(meta?.name ?? r.itemName ?? r.producedName ?? r.itemId ?? '').trim();
        const code = String(meta?.code ?? r.itemCode ?? r.producedCode ?? '').trim();
        const physicalItemId = String(r.itemId ?? '').trim() || undefined;
        const optionId = physicalItemId ?? `produced:${String(r.producedCode ?? r.id ?? '').trim() || String(r.id)}`;
        return {
          optionId,
          physicalItemId,
          name,
          code,
          label: `${name}${code ? ` (${code})` : ''}`,
          onHand: Number(r.quantity ?? 0) || 0,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [frontStock, stockItems]);
  const safeRecipeOptions = useMemo(
    () =>
      recipes
        .map((r) => ({
          ...r,
          optionValue: String(r.parentItemCode || r.id || '').trim(),
        }))
        .filter((r) => r.optionValue.length > 0),
    [recipes]
  );
  const safeCategoryOptions = useMemo(
    () =>
      categories
        .map((c) => ({
          ...c,
          optionValue: String(c.id || '').trim(),
        }))
        .filter((c) => c.optionValue.length > 0),
    [categories]
  );
  const safeSaleFrontStockOptions = useMemo(
    () => saleFrontStockOptions.filter((o) => String(o.optionId || '').trim().length > 0),
    [saleFrontStockOptions]
  );
  const saleSuggestionMatchedByCode = useMemo(() => {
    const code = String((form as any).code ?? '').trim().toLowerCase();
    if (!code) return null;
    return safeSaleFrontStockOptions.find((o) => String(o.code ?? '').trim().toLowerCase() === code) ?? null;
  }, [form, safeSaleFrontStockOptions]);
  const saleSuggestionMatchedByName = useMemo(() => {
    const name = String(form.name ?? '').trim().toLowerCase();
    if (!name) return null;
    return safeSaleFrontStockOptions.find((o) => String(o.name ?? '').trim().toLowerCase() === name) ?? null;
  }, [form.name, safeSaleFrontStockOptions]);
  const hasReadySaleMatch = Boolean(saleSuggestionMatchedByCode || saleSuggestionMatchedByName);
  const matchedSaleOption = saleSuggestionMatchedByCode ?? saleSuggestionMatchedByName ?? null;
  const filteredSaleNameOptions = useMemo(() => {
    const q = String(form.name ?? '').trim().toLowerCase();
    return safeSaleFrontStockOptions
      .filter((o) => {
        if (!q) return true;
        return o.label.toLowerCase().includes(q) || String(o.name ?? '').toLowerCase().includes(q);
      })
      .slice(0, 15);
  }, [form.name, safeSaleFrontStockOptions]);
  const directSaleLinkValue = useMemo(() => {
    const physical = String((form as any).physicalStockItemId ?? '').trim();
    if (physical) return physical;
    if (matchedSaleOption) return String(matchedSaleOption.optionId);
    return '__none__';
  }, [form, matchedSaleOption]);
  const errs = useMemo(() => {
    const errs: string[] = [];
    const name = String(form.name ?? '').trim();
    const price = Number(form.price ?? 0);
    if (!name) errs.push('Name is required.');
    if (!Number.isFinite(price) || price <= 0) errs.push('Price must be a number greater than 0.');
    if (!((form as any).image)) errs.push('Please upload an image for the menu item (from Storage).');
    return errs;
  }, [form]);
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
    if (String(form.name ?? '').trim() && !hasReadySaleMatch && !String((form as any).physicalStockItemId ?? '').trim() && !String((form as any).code ?? '').trim()) {
      setShowUnmatchedNameHint(true);
      toast({
        title: 'Custom item name detected',
        description: 'This name does not match ready-to-sell stock. Link a recipe or direct SALE stock before final use.',
      });
    }
    // Validate before attempting save
    if (errs.length) {
      setValidationMessage(errs.join('\n'));
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
      physicalStockItemId: (form as any).physicalStockItemId ?? undefined,
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
    setNameSuggestionsOpen(false);
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
    setNameSuggestionsOpen(false);
    setShowModal(true);
  };

  const openEditModal = (item: MenuItem) => {
    setEditing(item);
    setForm(item);
    setNameSuggestionsOpen(false);
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
        <div className="grid grid-cols-1 gap-3">
          {items.map((item) => {
          // Resolve image preview (storage path or remote URL)
          let imgSrc: string | undefined = undefined;
          // Find linked recipe (by matching code)
          const linkedRecipe = recipes.find(r => String(r.parentItemCode) === String((item as any).code));
          const directSaleLinked = Boolean(String((item as any).physicalStockItemId ?? '').trim());
          const producedSaleLinked = !directSaleLinked
            && Boolean(
              safeSaleFrontStockOptions.find(
                (o) => String(o.code ?? '').trim().toLowerCase() === String((item as any).code ?? '').trim().toLowerCase()
              )
            );
          const readyToSellLinked = directSaleLinked || producedSaleLinked;
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
                <div className="flex gap-3 items-center">
                  {imgSrc ? (
                    <img src={imgSrc} alt={item.name} className="h-14 w-14 object-cover rounded-full shadow-sm flex-shrink-0" />
                  ) : (
                    <div className="h-14 w-14 bg-muted-foreground/10 rounded-full flex items-center justify-center text-[10px] text-muted-foreground flex-shrink-0">
                      No image
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold">{formatMoneyPrecise(Number(item.price), 2)}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <span className={cn(
                          'rounded-full border px-2 py-0.5',
                          linkedRecipe && !readyToSellLinked ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-muted-foreground/20'
                        )}>
                          {linkedRecipe && !readyToSellLinked ? 'Recipe Linked' : linkedRecipe && readyToSellLinked ? 'Recipe (Ignored)' : 'No Recipe'}
                        </span>
                        <span className={cn(
                          'rounded-full border px-2 py-0.5',
                          readyToSellLinked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-muted-foreground/20'
                        )}>
                          {readyToSellLinked ? 'Ready-to-Sell Linked' : 'No Direct SALE Link'}
                        </span>
                      </div>
                    </div>
                    {(item as any).description ? (
                      <div className="mt-1 text-xs text-muted-foreground break-words line-clamp-2">{(item as any).description}</div>
                    ) : null}
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Deduction path:{' '}
                      {readyToSellLinked
                        ? 'Direct SALE stock (no recipe needed)'
                        : linkedRecipe
                          ? 'Recipe ingredients (MANUFACTURING)'
                          : 'Not connected'}
                    </div>
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
          </DialogHeader>

          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Item Name</Label>
              <div className="relative">
                <Input
                  value={String(form.name ?? '')}
                  placeholder="Type item name (custom names allowed)..."
                  onFocus={() => setNameSuggestionsOpen(true)}
                  onBlur={() => window.setTimeout(() => setNameSuggestionsOpen(false), 120)}
                  onChange={(e) =>
                    setForm((prev) => {
                      const typed = String(e.target.value ?? '');
                      const activePhysical = String((prev as any).physicalStockItemId ?? '').trim();
                      if (!activePhysical) return { ...prev, name: typed };
                      const selected = safeSaleFrontStockOptions.find((o) => String(o.physicalItemId ?? '') === activePhysical);
                      const selectedName = String(selected?.name ?? '').trim().toLowerCase();
                      const typedName = typed.trim().toLowerCase();
                      if (selected && typedName && typedName !== selectedName) {
                        return { ...prev, name: typed, physicalStockItemId: undefined };
                      }
                      return { ...prev, name: typed };
                    })
                  }
                />
                {nameSuggestionsOpen ? (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
                    <Command>
                      <CommandInput
                        value={String(form.name ?? '')}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
                        className="hidden"
                      />
                      <div className="px-2 py-2 text-xs text-muted-foreground">
                        Suggestions from Front Office SALE stock. Keep typing to use a custom name.
                      </div>
                      <CommandEmpty>
                        <div className="px-2 py-1 text-xs text-muted-foreground">
                          No ready-to-sell match. Keep this custom name and optionally link a recipe below.
                        </div>
                      </CommandEmpty>
                      <CommandGroup>
                        {filteredSaleNameOptions.map((o) => (
                          <CommandItem
                            key={o.optionId}
                            value={o.label}
                            onMouseDown={(ev) => ev.preventDefault()}
                            onSelect={() => {
                              setForm((prev) => ({
                                ...prev,
                                name: o.name || prev.name,
                                code: o.code || (prev as any).code,
                                physicalStockItemId: o.physicalItemId,
                              }));
                              setShowUnmatchedNameHint(false);
                              setNameSuggestionsOpen(false);
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', String((form as any).physicalStockItemId ?? '') === String(o.physicalItemId ?? '') ? 'opacity-100' : 'opacity-0')} />
                            <div className="flex flex-col">
                              <span>{o.label}</span>
                              <span className="text-xs text-muted-foreground">On hand: {o.onHand.toFixed(2)}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                Selecting a SALE stock suggestion links direct one-to-one stock deduction.
              </div>
              {String(form.name ?? '').trim() && !hasReadySaleMatch ? (
                <div className="flex items-center gap-2 text-xs text-emerald-700">
                  <Check className="h-3.5 w-3.5" />
                  Custom name is OK — just link a recipe or direct SALE stock below.
                </div>
              ) : null}
            </div>

            {!String((form as any).physicalStockItemId ?? '').trim() && !hasReadySaleMatch ? (
              <div className="space-y-1">
                <Label>Link to Existing Recipe (optional)</Label>
                <Select value={String((form as any).code ?? '').trim() || '__none__'} onValueChange={(v) => {
                  if (v === '__none__') { setForm({ ...form, code: '' }); return; }
                  const sel = recipes.find(r => r.parentItemCode === v || r.id === v);
                  if (sel) setForm({ ...form, name: sel.parentItemName, code: sel.parentItemCode, physicalStockItemId: undefined });
                  else setForm({ ...form, code: v, physicalStockItemId: undefined });
                }}>
                  <SelectTrigger>
                    <SelectValue placeholder="(none)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(none)</SelectItem>
                    {safeRecipeOptions.map((r) => (
                      <SelectItem key={r.id} value={r.optionValue}>{r.parentItemName} — {r.parentItemCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {((form.name ?? '').toString().trim() && ((form as any).code ?? '').toString().trim()) ? (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => setRecipeEditorOpen(true)}><Plus className="h-4 w-4 mr-2" />Add recipe</Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {hasReadySaleMatch ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                This item matches ready-to-sell stock in SALE and will deduct from SALE quantity first.
                Recipe linking is hidden to avoid double deduction.
              </div>
            ) : null}
            {showUnmatchedNameHint && String(form.name ?? '').trim() && !hasReadySaleMatch ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                This item name does not match existing ready-to-sell stock. You can keep it as custom, but link it to an existing recipe or a direct SALE stock item.
              </div>
            ) : null}

            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={String((form as any).categoryId ?? '').trim() || '__none__'} onValueChange={(v) => {
                if (v === '__none__') { setForm({ ...form, categoryId: undefined }); return; }
                setForm({ ...form, categoryId: v });
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="(none)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none)</SelectItem>
                  {safeCategoryOptions.map((c) => (
                    <SelectItem key={c.id} value={c.optionValue}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Direct SALE Stock Link (optional)</Label>
              <Select
                value={directSaleLinkValue}
                onValueChange={(v) => {
                  if (v === '__none__') {
                    setForm({ ...form, physicalStockItemId: undefined });
                    return;
                  }
                  const sel = safeSaleFrontStockOptions.find((o) => String(o.optionId) === String(v));
                  if (sel && String(sel.physicalItemId ?? '').trim()) {
                    setForm({
                      ...form,
                      name: sel.name || form.name,
                      code: sel.code || (form as any).code,
                      physicalStockItemId: String(sel.physicalItemId),
                    });
                    return;
                  }
                  // manufactured/produced SALE items have no physical stock id; link via code (produced_code)
                  if (sel && String(sel.code ?? '').trim()) {
                    setForm({
                      ...form,
                      name: sel.name || form.name,
                      code: String(sel.code).trim(),
                      physicalStockItemId: undefined,
                    });
                    return;
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="(none)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">(none)</SelectItem>
                  {safeSaleFrontStockOptions.map((o) => (
                    <SelectItem key={o.optionId} value={String(o.optionId)}>
                      {o.label} - On hand: {o.onHand.toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                If linked, sales deduct directly from Front Office `SALE` stock for this item.
              </div>
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

