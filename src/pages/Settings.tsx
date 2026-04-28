import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { ReceiptSettings } from '@/types';
import { getReceiptSettings, saveReceiptSettings } from '@/lib/receiptSettingsService';
import { useAuth } from '@/contexts/AuthContext';
import { NavLink } from 'react-router-dom';
import { useBranding } from '@/contexts/BrandingContext';
import { getFeatureFlagsSnapshot, setFeatureEnabled, subscribeFeatureFlags } from '@/lib/featureFlagsStore';
import { addCategory, deleteCategory, getCategoriesSnapshot, refreshCategories, subscribeCategories, updateCategory } from '@/lib/categoriesStore';
import { departments as seededDepartments } from '@/data/mockData';
import { toast } from '@/hooks/use-toast';
import { addSupplier, deleteSupplier, getSuppliersSnapshot, refreshSuppliers, subscribeSuppliers, updateSupplier } from '@/lib/suppliersStore';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { Building2, Check, ChevronsUpDown, Cpu, ReceiptText, Tags, TabletSmartphone, Truck, WalletCards } from 'lucide-react';
import { getAllCurrencyCodes } from '@/lib/currencyOptions';
import { supabase } from '@/lib/supabaseClient';

export default function Settings() {
  const { hasPermission, user, brand } = useAuth();
  const brandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  const { settings, reset } = useBranding();
  const { currencyCode, setCurrencyCode } = useCurrency();
  const flags = useSyncExternalStore(subscribeFeatureFlags, getFeatureFlagsSnapshot, getFeatureFlagsSnapshot);
  const intelligenceEnabled = Boolean(flags.flags.intelligenceWorkspace);
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(() => getReceiptSettings());
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setReceiptSettings(getReceiptSettings());
  }, []);

  const isZambia = useMemo(() => receiptSettings.countryCode === 'ZM', [receiptSettings.countryCode]);

  const save = () => {
    // Ensure receipt settings and global currency stay in lockstep.
    // The currency picker below is the global system currency; receipt settings should follow it.
    const nextCurrency = String(receiptSettings.currencyCode ?? currencyCode ?? 'ZMW').toUpperCase() as ReceiptSettings['currencyCode'];
    if (nextCurrency && String(currencyCode ?? '').toUpperCase() !== nextCurrency) {
      setCurrencyCode(nextCurrency as any);
    }
    saveReceiptSettings({ ...receiptSettings, currencyCode: nextCurrency });
    setSavedAt(new Date().toLocaleTimeString());
  };

  const categoriesSnap = useSyncExternalStore(subscribeCategories, getCategoriesSnapshot, getCategoriesSnapshot);
  const suppliersSnap = useSyncExternalStore(subscribeSuppliers, getSuppliersSnapshot, getSuppliersSnapshot);

  const [newCategoryName, setNewCategoryName] = useState('');
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierCode, setNewSupplierCode] = useState('');

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [editingSupplierName, setEditingSupplierName] = useState('');
  const [editingSupplierCode, setEditingSupplierCode] = useState('');

  const currencyOptions = useMemo(() => {
    return getAllCurrencyCodes();
  }, []);

  const [currencyDraft, setCurrencyDraft] = useState<string>(() => String(currencyCode ?? 'ZMW').toUpperCase());
  const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [activeTile, setActiveTile] = useState<'branding' | 'advanced' | 'tills' | 'tabletMode' | 'currency' | 'receipt' | 'categories' | 'suppliers'>('branding');
  const [tabletStatus, setTabletStatus] = useState<{ configured: number; totalTables: number }>({ configured: 0, totalTables: 0 });

  useEffect(() => {
    setCurrencyDraft(String(currencyCode ?? 'ZMW').toUpperCase());
    setReceiptSettings((s) => ({ ...s, currencyCode: (String(currencyCode ?? 'ZMW').toUpperCase() as ReceiptSettings['currencyCode']) }));
  }, [currencyCode]);

  useEffect(() => {
    // Best-effort refresh when opening Settings. Add any missing built-in categories.
    (async () => {
      try {
        await refreshCategories().catch(() => {});
        await refreshSuppliers().catch(() => {});

        const snap = getCategoriesSnapshot();
        if (hasPermission('manageSettings') && Array.isArray(snap.categories)) {
          const existingNames = new Set<string>(snap.categories.map((c: any) => String(c.name ?? '').toLowerCase()));
          let added = false;
          for (const d of seededDepartments) {
            const name = String(d.name ?? '').trim();
            if (!name) continue;
            if (existingNames.has(name.toLowerCase())) continue;
            existingNames.add(name.toLowerCase());
            // eslint-disable-next-line no-await-in-loop
            await addCategory(name);
            added = true;
          }
          if (added) {
            toast({ title: 'Defaults seeded', description: 'Missing default categories added' });
            void refreshCategories();
          }
        }
      } catch (e) {
        console.warn('Default categories seed failed', e);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!supabase || !brandId) return;
      try {
        const [tabletRes, tablesRes] = await Promise.all([
          supabase.from('customer_tablet_devices').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('is_active', true),
          supabase.from('restaurant_tables').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('is_active', true),
        ]);
        setTabletStatus({
          configured: Number(tabletRes.count ?? 0),
          totalTables: Number(tablesRes.count ?? 0),
        });
      } catch {
        // ignore status fetch errors
      }
    })();
  }, [brandId]);

  const onSeedDefaults = async () => {
    if (!hasPermission('manageSettings')) return;
    try {
      const existingNames = new Set(categoriesSnap.categories.map((c:any) => String(c.name).toLowerCase()));
      for (const d of seededDepartments) {
        const name = String(d.name ?? '').trim();
        if (!name) continue;
        if (existingNames.has(name.toLowerCase())) continue;
        // addCategory will handle DB/local insertion
        // eslint-disable-next-line no-await-in-loop
        await addCategory(name);
      }
      toast({ title: 'Defaults seeded', description: 'Default categories added' });
      void refreshCategories();
    } catch (e) {
      console.warn('Failed to seed defaults', e);
      toast({ title: 'Seed failed', description: 'See console for details', variant: 'destructive' });
    }
  };

  const onAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setNewCategoryName('');
    try {
      await addCategory(name);
    } catch (e) {
      console.warn('Failed to add category', e);
    }
  };

  const onAddSupplier = async () => {
    const name = newSupplierName.trim();
    const code = newSupplierCode.trim() || undefined;
    if (!name) return;
    setNewSupplierName('');
    setNewSupplierCode('');
    try {
      await addSupplier({ name, code });
    } catch (e) {
      console.warn('Failed to add supplier', e);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="System configuration and preferences" />

      <div className="mb-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3">
        <Card className={`cursor-pointer transition-colors ${activeTile === 'branding' ? 'border-primary' : 'border-border/60'}`} onClick={() => setActiveTile('branding')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4" /> Brand</div>
            <div className="text-[11px] text-muted-foreground mt-1">Name and visual identity</div>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${activeTile === 'advanced' ? 'border-primary' : 'border-border/60'}`} onClick={() => setActiveTile('advanced')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Cpu className="h-4 w-4" /> Advanced</div>
            <div className="text-[11px] text-muted-foreground mt-1">Feature switches</div>
          </CardContent>
        </Card>
        {hasPermission('manageSettings') ? (
          <Card className={`cursor-pointer transition-colors ${activeTile === 'tills' ? 'border-primary' : 'border-border/60'}`} onClick={() => setActiveTile('tills')}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-sm font-medium"><WalletCards className="h-4 w-4" /> Tills</div>
              <div className="text-[11px] text-muted-foreground mt-1">Devices and till mapping</div>
            </CardContent>
          </Card>
        ) : null}
        <Card className={`cursor-pointer transition-colors ${activeTile === 'tabletMode' ? 'border-primary' : 'border-border/60'}`} onClick={() => setActiveTile('tabletMode')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><TabletSmartphone className="h-4 w-4" /> Tablet Mode</div>
            <div className="text-[11px] text-muted-foreground mt-1">Optional table ordering tablets</div>
            <div className="text-[11px] text-muted-foreground mt-1">
              {tabletStatus.configured}/{tabletStatus.totalTables || 0} tables configured
            </div>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${activeTile === 'currency' ? 'border-primary' : 'border-border/60'}`} onClick={() => setActiveTile('currency')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><WalletCards className="h-4 w-4" /> Currency</div>
            <div className="text-[11px] text-muted-foreground mt-1">Global money format</div>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${activeTile === 'receipt' ? 'border-primary' : 'border-border/60'}`} onClick={() => setActiveTile('receipt')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><ReceiptText className="h-4 w-4" /> Receipts</div>
            <div className="text-[11px] text-muted-foreground mt-1">Logo, footer, print setup</div>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${activeTile === 'categories' ? 'border-primary' : 'border-border/60'}`} onClick={() => setActiveTile('categories')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Tags className="h-4 w-4" /> Categories</div>
            <div className="text-[11px] text-muted-foreground mt-1">Manage departments</div>
          </CardContent>
        </Card>
        <Card className={`cursor-pointer transition-colors ${activeTile === 'suppliers' ? 'border-primary' : 'border-border/60'}`} onClick={() => setActiveTile('suppliers')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><Truck className="h-4 w-4" /> Suppliers</div>
            <div className="text-[11px] text-muted-foreground mt-1">Contacts and codes</div>
          </CardContent>
        </Card>
      </div>

      {activeTile === 'branding' ? <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium">App name</div>
            <div className="text-xs text-muted-foreground">Current: {settings.appName}</div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                reset();
                setSavedAt(new Date().toLocaleTimeString());
              }}
            >
              Reset Branding
            </Button>

            {hasPermission('manageSettings') && (
              <Button asChild variant="outline">
                <NavLink to="/app/company-settings">Open</NavLink>
              </Button>
            )}
          </div>
        </CardContent>
      </Card> : null}

      {activeTile === 'advanced' ? <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Advanced</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm font-medium">Mthunzi Intelligence Workspace</div>
            <div className="text-xs text-muted-foreground">Power BI-style live dashboard with draggable widgets and clean data.</div>
          </div>

          <div className="flex items-center gap-3">
            {hasPermission('manageSettings') && (
              <Button asChild variant="outline">
                <NavLink to="/app/intelligence">Open</NavLink>
              </Button>
            )}

            <div className="flex items-center gap-2">
              <div className="text-xs text-muted-foreground">Off</div>
              <Switch
                checked={intelligenceEnabled}
                disabled={!hasPermission('manageSettings')}
                onCheckedChange={(v) => {
                  if (!hasPermission('manageSettings')) return;
                  setFeatureEnabled('intelligenceWorkspace', Boolean(v));
                }}
              />
              <div className="text-xs text-muted-foreground">On</div>
            </div>
          </div>
        </CardContent>
      </Card> : null}

      {hasPermission('manageSettings') && activeTile === 'tills' ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Tills & POS Terminals</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-medium">Till management</div>
              <div className="text-xs text-muted-foreground">
                Create custom till names (e.g. Bar, Front Counter) and review device-to-till assignments.
              </div>
            </div>
            <Button asChild variant="outline">
              <NavLink to="/app/settings/tills">Open</NavLink>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {activeTile === 'tabletMode' ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Tablet Mode (Optional)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              Tablet Mode lets guests order from table tablets. This feature is optional; brands can run normal POS without it.
            </div>
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              Setup flow: <strong>1) Configure tables</strong> → <strong>2) Set up this device as a tablet</strong> → <strong>3) Open Tablet Mode</strong>.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <NavLink to="/app/pos/tables">Configure Tables</NavLink>
              </Button>
              <Button asChild variant="outline">
                <NavLink to="/app/pos/tables">Set Up This Device</NavLink>
              </Button>
              <Button asChild>
                <NavLink to="/tablet-lock">Open Tablet Mode</NavLink>
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Note: if a table already has a tablet assigned, setup will block duplicate assignment and show a clear message.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTile === 'currency' ? <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Global Currency</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <div className="text-sm font-medium">Currency code</div>
              <Popover open={currencyPickerOpen} onOpenChange={setCurrencyPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={currencyPickerOpen}
                    className="w-full justify-between"
                    disabled={!hasPermission('manageSettings')}
                  >
                    <span className="truncate">{currencyDraft || 'Select currency'}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[340px] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search currency code… (e.g. ZMW, USD)"
                      value={currencySearch}
                      onValueChange={(v) => setCurrencySearch(String(v ?? '').toUpperCase())}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {currencySearch.trim() ? (
                          <span className="text-sm">No match. Use “{currencySearch.trim().toUpperCase()}”.</span>
                        ) : (
                          <span className="text-sm">Type to search currencies.</span>
                        )}
                      </CommandEmpty>

                      <CommandGroup heading="Select">
                        {(currencySearch.trim() ? [currencySearch.trim().toUpperCase()] : [])
                          .filter((x) => x.length > 0)
                          .map((custom) => (
                            <CommandItem
                              key={`custom-${custom}`}
                              value={custom}
                              onSelect={() => {
                                setCurrencyDraft(custom);
                                setCurrencyPickerOpen(false);
                                setCurrencySearch('');
                              }}
                            >
                              <Check className={cn('mr-2 h-4 w-4', currencyDraft === custom ? 'opacity-100' : 'opacity-0')} />
                              Use “{custom}”
                            </CommandItem>
                          ))}
                      </CommandGroup>

                      <CommandGroup heading="All currencies">
                        {currencyOptions.map((c) => (
                          <CommandItem
                            key={c}
                            value={c}
                            onSelect={(val) => {
                              const next = String(val || c).toUpperCase();
                              setCurrencyDraft(next);
                              setCurrencyPickerOpen(false);
                              setCurrencySearch('');
                            }}
                          >
                            <Check className={cn('mr-2 h-4 w-4', currencyDraft === c ? 'opacity-100' : 'opacity-0')} />
                            {c}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <div className="text-xs text-muted-foreground">
                Search and pick a currency or type a custom code. This affects headers, reports, POS totals, and receipts.
              </div>
            </div>

            <Button
              variant="outline"
              onClick={() => {
                if (!hasPermission('manageSettings')) return;
                const next = (currencyDraft.trim().toUpperCase() || 'ZMW') as any;
                setCurrencyCode(next);
                setReceiptSettings((s) => ({ ...s, currencyCode: next as ReceiptSettings['currencyCode'] }));
                try {
                  saveReceiptSettings({ ...getReceiptSettings(), currencyCode: next as ReceiptSettings['currencyCode'] });
                } catch {
                  // ignore
                }
                setSavedAt(new Date().toLocaleTimeString());
              }}
              disabled={!hasPermission('manageSettings') || !currencyDraft.trim()}
            >
              Apply currency
            </Button>
          </div>
        </CardContent>
      </Card> : null}

      {activeTile === 'receipt' ? <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Receipt Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Country</div>
              <Input
                value={receiptSettings.countryCode}
                onChange={(e) => setReceiptSettings((s) => ({ ...s, countryCode: e.target.value as ReceiptSettings['countryCode'] }))}
                placeholder="ZM"
              />
              <div className="text-xs text-muted-foreground">
                Zambia uses smart QR for verification; others use review/digital links.
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Legal Footer</div>
            <Textarea
              value={receiptSettings.legalFooter}
              onChange={(e) => setReceiptSettings((s) => ({ ...s, legalFooter: e.target.value }))}
              placeholder="Paste your required legal text here..."
              rows={4}
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Receipt logo URL</div>
            <Input
              value={receiptSettings.logoUrl ?? ''}
              onChange={(e) => setReceiptSettings((s) => ({ ...s, logoUrl: e.target.value || undefined }))}
              placeholder="https://..."
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReceiptSettings((s) => ({ ...s, logoUrl: settings.logoDataUrl || undefined }))}
                disabled={!settings.logoDataUrl}
              >
                Use brand logo
              </Button>
              <div className="text-xs text-muted-foreground">Shown on printed and digital receipts.</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 px-1">
            <div>
              <div className="text-sm font-medium">Auto-print Receipt</div>
              <div className="text-xs text-muted-foreground">If enabled, receipt will print automatically when shown.</div>
            </div>
            <Switch
              checked={receiptSettings.autoPrint ?? true}
              disabled={!hasPermission('manageSettings')}
              onCheckedChange={(v) => setReceiptSettings((s) => ({ ...s, autoPrint: Boolean(v) }))}
            />
          </div>

          {!isZambia && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Google Review URL (QR)</div>
                <Input
                  value={receiptSettings.googleReviewUrl ?? ''}
                  onChange={(e) => setReceiptSettings((s) => ({ ...s, googleReviewUrl: e.target.value || undefined }))}
                  placeholder="https://g.page/r/.../review"
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">Digital Receipt Base URL (QR)</div>
                <Input
                  value={receiptSettings.digitalReceiptBaseUrl ?? ''}
                  onChange={(e) => setReceiptSettings((s) => ({ ...s, digitalReceiptBaseUrl: e.target.value || undefined }))}
                  placeholder="https://yourdomain.com/r/"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save}>Save Receipt Settings</Button>
            {savedAt && <div className="text-xs text-muted-foreground">Saved at {savedAt}</div>}
          </div>
        </CardContent>
      </Card> : null}

      {activeTile === 'categories' ? <Card>
        <CardHeader>
          <CardTitle className="text-base">Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-2">
            <Input
              placeholder="New category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
            />
            <Button onClick={onAddCategory} disabled={!newCategoryName.trim() || !hasPermission('manageSettings')}>Add</Button>
            <Button variant="outline" onClick={onSeedDefaults} disabled={!hasPermission('manageSettings')}>Seed defaults</Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {categoriesSnap.categories.length === 0 ? (
              <div className="text-sm text-muted-foreground">No categories defined.</div>
            ) : (
              categoriesSnap.categories.map((cat) => {
                const isEditing = editingCategoryId === cat.id;
                return (
                  <div key={cat.id} className="p-3 bg-muted rounded-md text-sm">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <Input
                          value={editingCategoryName}
                          onChange={(e) => setEditingCategoryName(e.target.value)}
                          disabled={!hasPermission('manageSettings')}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={async () => {
                              if (!hasPermission('manageSettings')) return;
                              const next = editingCategoryName.trim();
                              if (!next) return;
                              await updateCategory(cat.id, { name: next });
                              setEditingCategoryId(null);
                              setEditingCategoryName('');
                            }}
                            disabled={!hasPermission('manageSettings') || !editingCategoryName.trim()}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingCategoryId(null);
                              setEditingCategoryName('');
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (!hasPermission('manageSettings')) return;
                              await deleteCategory(cat.id);
                              setEditingCategoryId(null);
                              setEditingCategoryName('');
                            }}
                            disabled={!hasPermission('manageSettings')}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{cat.name}</div>
                        </div>
                        {hasPermission('manageSettings') && (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingCategoryId(cat.id);
                                setEditingCategoryName(cat.name);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={async () => {
                                await deleteCategory(cat.id);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card> : null}

      {activeTile === 'suppliers' ? <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Suppliers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-2">
            <Input
              placeholder="Supplier name"
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
            />
            <Input
              placeholder="Code (optional)"
              value={newSupplierCode}
              onChange={(e) => setNewSupplierCode(e.target.value)}
            />
            <Button onClick={onAddSupplier} disabled={!newSupplierName.trim() || !hasPermission('manageSettings')}>Add</Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {suppliersSnap.suppliers.length === 0 ? (
              <div className="text-sm text-muted-foreground">No suppliers defined.</div>
            ) : (
              suppliersSnap.suppliers.map((s) => {
                const isEditing = editingSupplierId === s.id;
                return (
                  <div key={s.id} className="p-3 bg-muted rounded-md text-sm">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <Input
                          value={editingSupplierName}
                          onChange={(e) => setEditingSupplierName(e.target.value)}
                          disabled={!hasPermission('manageSettings')}
                          placeholder="Supplier name"
                        />
                        <Input
                          value={editingSupplierCode}
                          onChange={(e) => setEditingSupplierCode(e.target.value)}
                          disabled={!hasPermission('manageSettings')}
                          placeholder="Code (optional)"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={async () => {
                              if (!hasPermission('manageSettings')) return;
                              const nextName = editingSupplierName.trim();
                              if (!nextName) return;
                              const nextCode = editingSupplierCode.trim() || undefined;
                              await updateSupplier(s.id, { name: nextName, code: nextCode });
                              setEditingSupplierId(null);
                              setEditingSupplierName('');
                              setEditingSupplierCode('');
                            }}
                            disabled={!hasPermission('manageSettings') || !editingSupplierName.trim()}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingSupplierId(null);
                              setEditingSupplierName('');
                              setEditingSupplierCode('');
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (!hasPermission('manageSettings')) return;
                              await deleteSupplier(s.id);
                              setEditingSupplierId(null);
                              setEditingSupplierName('');
                              setEditingSupplierCode('');
                            }}
                            disabled={!hasPermission('manageSettings')}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{s.name}</div>
                          {s.code ? <div className="text-xs text-muted-foreground truncate">{s.code}</div> : null}
                        </div>
                        {hasPermission('manageSettings') && (
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingSupplierId(s.id);
                                setEditingSupplierName(s.name);
                                setEditingSupplierCode(s.code ?? '');
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={async () => {
                                await deleteSupplier(s.id);
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

        </CardContent>
      </Card> : null}
    </div>
  );
}
