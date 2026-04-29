import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Users, Clock, DollarSign, BellRing, QrCode, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table as TableType, TableStatus } from '@/types/pos';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { InteractiveFloorPlan, type FloorPlanTable } from '@/components/pos/InteractiveFloorPlan';
import { getOrdersSnapshot, subscribeOrders } from '@/lib/orderStore';
import { addPosPaymentRequest, getPosPaymentRequestsSnapshot, subscribePosPaymentRequests } from '@/lib/posPaymentRequestStore';
import { useCurrency } from '@/contexts/CurrencyContext';
import { useRestaurantTables } from '@/hooks/useRestaurantTables';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { Input } from '@/components/ui/input';
import { refreshRestaurantTables } from '@/lib/restaurantTablesStore';
import { generateQrDataUrl } from '@/lib/qr';

const STATUS_COLORS: Record<TableStatus, string> = {
  available: 'bg-green-500/20 border-green-500 text-green-700 dark:text-green-400',
  occupied: 'bg-blue-500/20 border-blue-500 text-blue-700 dark:text-blue-400',
  reserved: 'bg-purple-500/20 border-purple-500 text-purple-700 dark:text-purple-400',
  dirty: 'bg-orange-500/20 border-orange-500 text-orange-700 dark:text-orange-400',
};

const STATUS_LABELS: Record<TableStatus, string> = {
  available: 'Available',
  occupied: 'Occupied',
  reserved: 'Reserved',
  dirty: 'Needs Cleaning',
};

export default function TableManagement() {
  const navigate = useNavigate();
  const { formatMoneyPrecise } = useCurrency();
  const { hasPermission, user, brand } = useAuth();
  const brandId = String((brand as any)?.id ?? (user as any)?.brand_id ?? '');
  const canConfigure = hasPermission('manageSettings');
  const role = String((user as any)?.role ?? '').toLowerCase();
  const canTabletSetup = canConfigure || role === 'front_supervisor' || role === 'manager';
  const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [tab, setTab] = useState<'ops' | 'tables' | 'tablets'>('ops');
  const [viewMode, setViewMode] = useState<'floor' | 'grid'>('floor');
  const [payRequestedOnly, setPayRequestedOnly] = useState(false);
  const { sections, loaded: tablesLoaded } = useRestaurantTables();
  const [configBusy, setConfigBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSeats, setNewSeats] = useState('4');
  const [tabletSetupBusy, setTabletSetupBusy] = useState(false);
  const [tabletAssignments, setTabletAssignments] = useState<Array<{ id: string; device_id: string; table_no: number; name?: string | null }>>([]);
  const [selectedTabletTableNo, setSelectedTabletTableNo] = useState<string>('');
  const [tabletSetupMessage, setTabletSetupMessage] = useState<string | null>(null);
  const [tabletSetupError, setTabletSetupError] = useState<string | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingLink, setPairingLink] = useState<string>('');
  const [pairingQrDataUrl, setPairingQrDataUrl] = useState<string>('');
  const [pairingExpiresAt, setPairingExpiresAt] = useState<string | null>(null);

  const TABLET_DEVICE_ID_KEY = 'pmx.tablet.deviceId.v1';
  const TABLET_KIOSK_ENABLED_KEY = 'pmx.tablet.kiosk.enabled.v1';
  const getOrCreateTabletDeviceId = () => {
    try {
      const existing = localStorage.getItem(TABLET_DEVICE_ID_KEY);
      if (existing && existing.trim()) return existing.trim();
      const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tablet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(TABLET_DEVICE_ID_KEY, uuid);
      return uuid;
    } catch {
      return `tablet-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
  };
  const thisDeviceTabletId = useMemo(() => getOrCreateTabletDeviceId(), []);

  const persistedOrders = useSyncExternalStore(subscribeOrders, getOrdersSnapshot);
  // Use persisted orders only (disable demo fallback)
  const orders = useMemo(() => persistedOrders, [persistedOrders]);

  const paymentRequests = useSyncExternalStore(subscribePosPaymentRequests, getPosPaymentRequestsSnapshot);
  const paymentRequestedTableNos = useMemo(() => new Set(paymentRequests.map((r) => r.tableNo)), [paymentRequests]);

  const filteredSections = useMemo(() => {
    if (!payRequestedOnly) return sections;
    return sections
      .map((s) => ({
        ...s,
        tables: s.tables.filter((t) => paymentRequestedTableNos.has(t.number)),
      }))
      .filter((s) => s.tables.length > 0);
  }, [payRequestedOnly, paymentRequestedTableNos, sections]);

  const allTables = useMemo(() => sections.flatMap((s) => s.tables), [sections]);
  const thisDeviceAssignment = useMemo(
    () => tabletAssignments.find((x) => String(x.device_id).toLowerCase() === String(thisDeviceTabletId).toLowerCase()) ?? null,
    [tabletAssignments, thisDeviceTabletId]
  );
  const assignedTableNos = useMemo(() => new Set(tabletAssignments.map((x) => Number(x.table_no))), [tabletAssignments]);
  const firstSetupCandidate = useMemo(() => {
    const sorted = allTables.slice().sort((a, b) => Number(a.number) - Number(b.number));
    const currentTableNo = thisDeviceAssignment ? Number(thisDeviceAssignment.table_no) : null;
    if (currentTableNo != null && Number.isFinite(currentTableNo)) return String(currentTableNo);
    const free = sorted.find((t) => !assignedTableNos.has(Number(t.number)));
    return free ? String(free.number) : '';
  }, [allTables, assignedTableNos, thisDeviceAssignment]);
  
  const getTableOrder = (tableId: string) => {
    return orders.find(o => o.tableId === tableId);
  };

  const loadTabletAssignments = async () => {
    if (!supabase || !brandId || !canTabletSetup) return;
    try {
      const { data, error } = await supabase
        .from('customer_tablet_devices')
        .select('id, device_id, table_no, name')
        .eq('brand_id', brandId)
        .eq('is_active', true)
        .order('table_no', { ascending: true });
      if (error) throw error;
      setTabletAssignments((Array.isArray(data) ? data : []) as any);
    } catch {
      // Keep UI usable; assignment action will surface specific errors.
      setTabletAssignments([]);
    }
  };

  useEffect(() => {
    void loadTabletAssignments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, canTabletSetup]);

  useEffect(() => {
    if (selectedTabletTableNo) return;
    if (!firstSetupCandidate) return;
    setSelectedTabletTableNo(firstSetupCandidate);
  }, [firstSetupCandidate, selectedTabletTableNo]);

  const generatePairingQr = async () => {
    if (!supabase || !brandId) return;
    setPairingBusy(true);
    setPairingError(null);
    try {
      const { data, error } = await supabase.rpc('issue_tablet_enrollment_token', {
        p_brand_id: brandId,
        p_ttl_seconds: 180,
      });
      if (error) throw error;
      const ok = Boolean((data as any)?.ok ?? false);
      if (!ok) {
        const reason = String((data as any)?.error ?? 'unable_to_issue_token');
        if (reason === 'not_allowed') {
          setPairingError('Only the brand owner can issue setup QR links.');
        } else {
          setPairingError('Unable to issue tablet setup QR.');
        }
        return;
      }
      const setupUrl = String((data as any)?.setup_url ?? '').trim();
      const nextLink = setupUrl
        ? new URL(setupUrl, window.location.origin).toString()
        : '';
      if (!nextLink) {
        setPairingError('Setup link was empty. Try again.');
        return;
      }
      const nextQrDataUrl = await generateQrDataUrl(nextLink);
      setPairingLink(nextLink);
      setPairingQrDataUrl(nextQrDataUrl);
      const expiresRaw = String((data as any)?.expires_at ?? '').trim();
      setPairingExpiresAt(expiresRaw || null);
    } catch (e: any) {
      setPairingError(e?.message ?? 'Unable to issue tablet setup QR.');
    } finally {
      setPairingBusy(false);
    }
  };
  
  const handleTableClick = (table: TableType) => {
    if (table.status === 'available') {
      // Go to POS with this table selected
      navigate('/pos/terminal', { state: { tableNo: table.number } });
    } else if (table.status === 'occupied') {
      setSelectedTable(table);
      setShowTableDialog(true);
    }
  };
  
  const TableCard = ({ table }: { table: TableType }) => {
    const order = getTableOrder(table.id);
    const orderDuration = order ? Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000) : 0;
    const paymentRequested = paymentRequestedTableNos.has(table.number);
    
    return (
      <Card
        className={cn(
          'cursor-pointer transition-all hover:shadow-md border-2',
          STATUS_COLORS[table.status],
          paymentRequested && 'ring-2 ring-rose-500/70'
        )}
        onClick={() => handleTableClick(table)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{table.number}</span>
              {table.name ? (
                <Badge variant="secondary" className="text-xs truncate max-w-[9rem]">{table.name}</Badge>
              ) : table.section ? (
                <Badge variant="secondary" className="text-xs">{table.section}</Badge>
              ) : null}
              <Badge variant="outline" className="text-xs">
                <Users className="h-3 w-3 mr-1" />{table.seats}
              </Badge>
              {paymentRequested && (
                <Badge className="bg-rose-500/15 text-rose-700 border border-rose-500/40 dark:text-rose-300">
                  <BellRing className="h-3 w-3 mr-1" /> PAY
                </Badge>
              )}
            </div>
          </div>
          
          <p className="text-sm font-medium mb-2">{STATUS_LABELS[table.status]}</p>
          
          {order && (
            <div className="space-y-1 pt-2 border-t">
              <div className="flex items-center gap-1 text-xs">
                <Clock className="h-3 w-3" />
                <span>{orderDuration} min</span>
              </div>
              <div className="flex items-center gap-1 text-sm font-semibold">
                <DollarSign className="h-3 w-3" />
                <span>{formatMoneyPrecise(order.total, 0)}</span>
              </div>
              <p className="text-xs text-muted-foreground truncate">{order.staffName}</p>
            </div>
          )}
          
          {table.status === 'reserved' && (
            <p className="text-xs mt-2">Reserved for 7:00 PM</p>
          )}
        </CardContent>
      </Card>
    );
  };
  
  return (
    <div>
      <PageHeader
        title="Table Management"
        description="Operations and table setup"
        actions={
          <div className="flex items-center gap-2">
            <Button variant={tab === 'ops' ? 'default' : 'outline'} onClick={() => setTab('ops')}>
              Operations
            </Button>
            {canConfigure ? (
              <Button variant={tab === 'tables' ? 'default' : 'outline'} onClick={() => setTab('tables')}>
                Tables
              </Button>
            ) : null}
            {canTabletSetup ? (
              <Button variant={tab === 'tablets' ? 'default' : 'outline'} onClick={() => setTab('tablets')}>
                Tablets
              </Button>
            ) : null}
            <Button
              variant={payRequestedOnly ? 'default' : 'outline'}
              onClick={() => setPayRequestedOnly((v) => !v)}
              className={cn(payRequestedOnly && 'bg-rose-600 hover:bg-rose-600/90')}
            >
              <BellRing className="h-4 w-4 mr-2" /> PAY Requested
            </Button>
          </div>
        }
      />
      
      {tab === 'tablets' ? (
        <div className="space-y-4">
          {canTabletSetup ? (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="text-sm font-medium">Tablet Setup (this device)</div>
                <div className="text-xs text-muted-foreground">
                  Pick a table, click once, and this device is immediately ready for kiosk mode.
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
                  <div className="grid gap-1">
                    <div className="text-xs text-muted-foreground">Assign this device to table</div>
                    <select
                      className="h-10 rounded-md border bg-background px-3 text-sm"
                      value={selectedTabletTableNo}
                      onChange={(e) => {
                        setSelectedTabletTableNo(e.target.value);
                        setTabletSetupError(null);
                        setTabletSetupMessage(null);
                      }}
                    >
                      <option value="">Choose table</option>
                      {allTables.map((t) => {
                        const isAssigned = assignedTableNos.has(Number(t.number));
                        const isCurrent = thisDeviceAssignment?.table_no === Number(t.number);
                        return (
                          <option
                            key={t.id}
                            value={String(t.number)}
                            disabled={isAssigned && !isCurrent}
                          >
                            {(t.name?.trim() || `Table ${t.number}`)} • {t.seats} seats
                            {isAssigned && !isCurrent ? ' (already assigned)' : ''}
                            {isCurrent ? ' (this device)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <Button
                    onClick={async () => {
                      if (!supabase || !brandId) return;
                      const tableNo = Number(selectedTabletTableNo);
                      if (!Number.isFinite(tableNo) || tableNo <= 0) {
                        setTabletSetupError('Select a table first.');
                        return;
                      }
                      const target = allTables.find((x) => Number(x.number) === tableNo);
                      setTabletSetupBusy(true);
                      setTabletSetupError(null);
                      setTabletSetupMessage(null);
                      try {
                        const { data, error } = await supabase.rpc('assign_customer_tablet_device', {
                          p_brand_id: brandId,
                          p_device_id: thisDeviceTabletId,
                          p_table_no: tableNo,
                          p_name: target?.name ?? null,
                          p_is_locked: true,
                        });
                        if (error) throw error;
                        const ok = Boolean((data as any)?.ok ?? false);
                        if (!ok) {
                          const reason = String((data as any)?.error ?? 'assign_failed');
                          if (reason === 'table_already_assigned') {
                            setTabletSetupError('That table already has a tablet assigned.');
                          } else {
                            setTabletSetupError(reason);
                          }
                          return;
                        }
                        setTabletSetupMessage('Done. Entering kiosk mode...');
                        try {
                          localStorage.setItem(TABLET_KIOSK_ENABLED_KEY, '1');
                        } catch {
                          // ignore local storage write issues
                        }
                        await loadTabletAssignments();
                        navigate('/tablet-lock?kiosk=1');
                      } catch (e: any) {
                        setTabletSetupError(e?.message ?? 'Unable to set up this device.');
                      } finally {
                        setTabletSetupBusy(false);
                      }
                    }}
                    disabled={tabletSetupBusy || !selectedTabletTableNo}
                  >
                    {tabletSetupBusy ? 'Setting up...' : 'Set up this device'}
                  </Button>
                </div>
                {allTables.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No tables yet. First add tables in the Tables tab, then come back here.
                  </div>
                ) : null}
                {tabletSetupError ? <div className="text-sm text-destructive">{tabletSetupError}</div> : null}
                {tabletSetupMessage ? <div className="text-sm text-emerald-600">{tabletSetupMessage}</div> : null}
              </CardContent>
            </Card>
          ) : null}
          {canTabletSetup ? (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Pair Tablet via QR</div>
                    <div className="text-xs text-muted-foreground">
                      Scan with the customer tablet to open secure kiosk enrollment.
                    </div>
                  </div>
                  <Button onClick={() => void generatePairingQr()} disabled={pairingBusy || !brandId}>
                    {pairingBusy ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Generating...
                      </>
                    ) : (
                      <>
                        <QrCode className="h-4 w-4 mr-2" /> Generate QR
                      </>
                    )}
                  </Button>
                </div>
                {pairingQrDataUrl ? (
                  <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                    <div className="flex flex-col items-center gap-2">
                      <img src={pairingQrDataUrl} alt="Tablet enrollment QR" className="h-48 w-48 rounded-md border bg-white p-2" />
                      <div className="text-xs text-muted-foreground text-center">
                        This QR expires quickly for security.
                      </div>
                      {pairingExpiresAt ? (
                        <div className="text-xs text-muted-foreground">
                          Expires at {new Date(pairingExpiresAt).toLocaleTimeString()}
                        </div>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground break-all">{pairingLink}</div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Generate a QR when a new tablet needs setup.
                  </div>
                )}
                {pairingError ? <div className="text-sm text-destructive">{pairingError}</div> : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === 'tables' ? (
        <div className="space-y-4">
          {canConfigure ? (
            <>
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-medium">Add table</div>
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_auto] gap-2 items-end">
                    <div className="grid gap-1">
                      <div className="text-xs text-muted-foreground">Name</div>
                      <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Table 1, VIP Booth, Patio A" />
                    </div>
                    <div className="grid gap-1">
                      <div className="text-xs text-muted-foreground">Seats</div>
                      <Input value={newSeats} onChange={(e) => setNewSeats(e.target.value)} inputMode="numeric" placeholder="4" />
                    </div>
                    <Button
                      disabled={configBusy || !brandId}
                      onClick={async () => {
                        if (!supabase || !brandId) return;
                        const seats = Number(newSeats);
                        if (!Number.isFinite(seats) || seats <= 0) return;
                        setConfigBusy(true);
                        try {
                          const maxNo = sections.flatMap((s) => s.tables).reduce((m, t) => Math.max(m, Number(t.number) || 0), 0);
                          const tableNo = maxNo > 0 ? maxNo + 1 : 1;
                          const { error } = await supabase.from('restaurant_tables').insert({
                            brand_id: brandId,
                            table_no: tableNo,
                            name: newName.trim() || null,
                            seats,
                            status: 'available',
                            is_active: true,
                          });
                          if (error) throw error;
                          setNewName('');
                          setNewSeats('4');
                          await refreshRestaurantTables();
                        } finally {
                          setConfigBusy(false);
                        }
                      }}
                    >
                      Add
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Tip: Table numbers are assigned automatically. Use names for the vibe: “VIP Booth”, “Table X”, “Patio A”.
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-medium">Your tables</div>
                  <div className="space-y-2">
                    {sections.flatMap((s) => s.tables).length === 0 ? (
                      <div className="text-sm text-muted-foreground">No tables yet.</div>
                    ) : (
                      sections.flatMap((s) => s.tables).map((t) => (
                        <div key={t.id} className="rounded-md border p-3">
                          <div className="grid grid-cols-1 md:grid-cols-[90px_1fr_120px_110px] gap-2 items-center">
                            <div className="text-sm font-semibold">#{t.number}</div>
                            <div className="grid gap-1">
                              <div className="text-xs text-muted-foreground">Name</div>
                              <Input
                                defaultValue={(t as any).name ?? ''}
                                placeholder="Optional"
                                onBlur={async (e) => {
                                  if (!supabase || !brandId) return;
                                  const v = e.target.value.trim();
                                  await supabase.from('restaurant_tables').update({ name: v || null }).eq('id', t.id);
                                  await refreshRestaurantTables();
                                }}
                              />
                            </div>
                            <div className="grid gap-1">
                              <div className="text-xs text-muted-foreground">Seats</div>
                              <Input
                                defaultValue={String(t.seats ?? 4)}
                                inputMode="numeric"
                                onBlur={async (e) => {
                                  if (!supabase || !brandId) return;
                                  const seats = Number(e.target.value);
                                  if (!Number.isFinite(seats) || seats <= 0) return;
                                  await supabase.from('restaurant_tables').update({ seats }).eq('id', t.id);
                                  await refreshRestaurantTables();
                                }}
                              />
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={async () => {
                                  if (!supabase || !brandId) return;
                                  await supabase.from('restaurant_tables').delete().eq('id', t.id);
                                  await refreshRestaurantTables();
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      ) : null}
      
      {tab === 'ops' && viewMode === 'floor' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button size="sm" variant={viewMode === 'floor' ? 'default' : 'outline'} onClick={() => setViewMode('floor')}>
              Floor
            </Button>
            <Button size="sm" variant={viewMode === 'grid' ? 'default' : 'outline'} onClick={() => setViewMode('grid')}>
              Grid
            </Button>
          </div>
          <InteractiveFloorPlan
            idleMinutesThreshold={20}
            tables={(() => {
              const all = (payRequestedOnly ? filteredSections : sections).flatMap(s => s.tables);
              // simple auto-layout grid
              const cols = 6;
              const cellW = 90;
              const cellH = 80;
              return all.map((t, idx): FloorPlanTable => {
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                const order = getTableOrder(t.id);
                const last = order?.sentAt ?? order?.createdAt;
                const paymentRequested = paymentRequestedTableNos.has(t.number);
                return {
                  id: t.id,
                  number: t.number,
                  seats: t.seats,
                  status: t.status,
                  x: 30 + col * cellW,
                  y: 50 + row * cellH,
                  w: 70,
                  h: 54,
                  lastActivityTime: last,
                  currentBillTotal: order?.total,
                  paymentRequested,
                };
              });
            })()}
            onTableClick={(t) => {
              const table = sections.flatMap(s => s.tables).find(x => x.id === t.id);
              if (table) handleTableClick(table);
            }}
          />
          {tablesLoaded && sections.flatMap((s) => s.tables).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No tables configured yet. Ask a manager to add tables in Settings so they appear here.
            </div>
          ) : null}
          {payRequestedOnly && !paymentRequests.length && (
            <div className="text-sm text-muted-foreground">
              No tables have requested payment yet.
            </div>
          )}
        </div>
      ) : null}

      {tab === 'ops' && viewMode === 'grid' ? (
        <div className="space-y-8">
          <div className="flex items-center gap-2">
            <Button size="sm" variant={viewMode === 'floor' ? 'default' : 'outline'} onClick={() => setViewMode('floor')}>
              Floor
            </Button>
            <Button size="sm" variant={viewMode === 'grid' ? 'default' : 'outline'} onClick={() => setViewMode('grid')}>
              Grid
            </Button>
          </div>
          {(payRequestedOnly ? filteredSections : sections).map(section => (
            <div key={section.id}>
              <h2 className="text-lg font-semibold mb-4">{section.name}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {section.tables.map(table => (
                  <TableCard key={table.id} table={table} />
                ))}
              </div>
            </div>
          ))}
          {tablesLoaded && sections.flatMap((s) => s.tables).length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No tables configured yet. Ask a manager to add tables in Settings so they appear here.
            </div>
          ) : null}
          {payRequestedOnly && !paymentRequests.length && (
            <div className="text-sm text-muted-foreground">
              No tables have requested payment yet.
            </div>
          )}
        </div>
      ) : null}
      
      {/* Table Details Dialog */}
      <Dialog open={showTableDialog} onOpenChange={setShowTableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Table {selectedTable?.number}</DialogTitle>
          </DialogHeader>
          {selectedTable && getTableOrder(selectedTable.id) && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Current Order</p>
                <p className="text-2xl font-bold">{formatMoneyPrecise(getTableOrder(selectedTable.id)!.total, 2)}</p>
                <p className="text-sm">{getTableOrder(selectedTable.id)!.items.length} items</p>
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => navigate('/pos/terminal', { state: { tableNo: selectedTable.number } })}>
                  Add Items
                </Button>
                <Button
                  disabled={(() => {
                    const order = getTableOrder(selectedTable.id);
                    if (!order) return true;
                    return paymentRequests.some((r) => r.orderId === order.id);
                  })()}
                  onClick={() => {
                    const order = getTableOrder(selectedTable.id);
                    if (!order) return;
                    addPosPaymentRequest({
                      tableNo: selectedTable.number,
                      orderId: order.id,
                      total: order.total,
                      requestedBy: order.staffName,
                    });
                    setShowTableDialog(false);
                  }}
                >
                  <BellRing className="h-4 w-4 mr-2" /> Request Payment
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
