import { useMemo, useState, useSyncExternalStore } from 'react';
import { Check, AlertTriangle, TrendingUp, TrendingDown, Banknote, CreditCard, FileText, Smartphone, Plus, Trash2 } from 'lucide-react';
import { PageHeader, KPICard } from '@/components/common/PageComponents';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { getOrdersSnapshot, subscribeOrders } from '@/lib/orderStore';
import { computeSalesFromOrders, createCashUp, getCashUpsSnapshot, subscribeCashUps, type PayoutLine } from '@/lib/cashUpStore';
import { getCurrentShiftSnapshot, startShift, subscribeCurrentShift, endShift } from '@/lib/shiftStore';
import { useCurrency } from '@/contexts/CurrencyContext';

export default function CashUp() {
  const { user, hasPermission } = useAuth();
  const { formatMoneyPrecise } = useCurrency();

  const orders = useSyncExternalStore(subscribeOrders, getOrdersSnapshot);
  const shift = useSyncExternalStore(subscribeCurrentShift, getCurrentShiftSnapshot);
  const cashUps = useSyncExternalStore(subscribeCashUps, getCashUpsSnapshot);

  const staffId = user?.id ?? 'system';
  const staffName = user?.name ?? 'System';

  const [startOpeningCash, setStartOpeningCash] = useState('0');
  const [drnFromOverride, setDrnFromOverride] = useState<string>('');

  const drnFrom = shift?.drnFrom ?? 0;
  const maxPaidOrderNo = useMemo(() => {
    return orders
      .filter((o) => o.status === 'paid')
      .reduce((m, o) => Math.max(m, o.orderNo ?? 0), 0);
  }, [orders]);

  const [drnTo, setDrnTo] = useState<string>(() => String(maxPaidOrderNo || ''));
  const [tips, setTips] = useState('0');
  const [actualCash, setActualCash] = useState('0');

  const [payouts, setPayouts] = useState<PayoutLine[]>([]);

  const totalPayouts = useMemo(
    () => payouts.reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0),
    [payouts]
  );

  const drnToNum = Number(drnTo);
  const canCompute = Boolean(shift && shift.isActive && Number.isFinite(drnFrom) && drnFrom > 0 && Number.isFinite(drnToNum) && drnToNum >= drnFrom);

  const sales = useMemo(() => {
    if (!canCompute) {
      return {
        paidOrders: [],
        totalSales: 0,
        cashSales: 0,
        cardSales: 0,
        chequeSales: 0,
        accountSales: 0,
        nonBankSales: 0,
        cashReceived: 0,
      };
    }
    return computeSalesFromOrders({ orders, drnFrom, drnTo: drnToNum });
  }, [canCompute, orders, drnFrom, drnToNum]);

  const opening = shift?.startingCash ?? 0;
  const cashReceived = sales.cashReceived;
  const totalTips = Number(tips) || 0;
  const actual = Number(actualCash) || 0;
  const expectedCash = opening + cashReceived - totalPayouts;
  const shortageOverage = actual - expectedCash;
  const bankableCash = actual - totalTips;

  const shiftStartedAt = shift?.startTime ? new Date(shift.startTime).toLocaleTimeString() : '-';

  function addPayout() {
    setPayouts((prev) => [...prev, { id: `po-${crypto.randomUUID()}`, reason: 'other', amount: 0 }]);
  }

  function updatePayout(id: string, patch: Partial<PayoutLine>) {
    setPayouts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePayout(id: string) {
    setPayouts((prev) => prev.filter((p) => p.id !== id));
  }

  function onStartShift() {
    if (!hasPermission('performCashUp')) return;
    const startingCash = Math.max(0, Number(startOpeningCash) || 0);
    const override = Number(drnFromOverride);
    const next = startShift({
      staffId,
      staffName,
      startingCash,
      drnFrom: Number.isFinite(override) && override > 0 ? override : undefined,
    });
    setDrnTo(String(Math.max(next.drnFrom ?? 0, maxPaidOrderNo || 0)));
    setActualCash(String(startingCash));
  }

  function onSubmitCashUp() {
    if (!shift || !shift.isActive) return;
    if (!canCompute) return;

    const created = createCashUp({
      shiftId: shift.id,
      staffId: shift.staffId,
      staffName: shift.staffName,
      date: new Date().toISOString().slice(0, 10),
      drnFrom,
      drnTo: drnToNum,
      openingCash: opening,
      tips: totalTips,
      payouts,
      actualCash: actual,
      sales,
      status: 'submitted',
    });

    endShift({ shiftId: shift.id, drnTo: drnToNum });

    // Reset local form state for next shift.
    setPayouts([]);
    setTips('0');
    setActualCash('0');
    setDrnTo(String(maxPaidOrderNo || ''));

    // simple feedback without needing a toast component
    console.log('CashUp submitted', created);
  }
  
  // Form state for current cash up
  const totalSales = sales.totalSales;
  
  return (
    <div>
      <PageHeader
        title="Shift Cash Up"
        description={`End of shift reconciliation for ${shift?.staffName ?? staffName}`}
      />
      
      <Tabs defaultValue="current" className="space-y-4">
        <TabsList>
          <TabsTrigger value="current">Current Shift</TabsTrigger>
          {hasPermission('viewAllCashUps') && (
            <TabsTrigger value="history">History</TabsTrigger>
          )}
        </TabsList>
        
        <TabsContent value="current" className="space-y-4">
          {!shift?.isActive ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Start Shift</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Staff</Label>
                    <div className="mt-1 font-medium">{staffName}</div>
                  </div>
                  <div>
                    <Label>Opening Cash</Label>
                    <Input type="number" value={startOpeningCash} onChange={(e) => setStartOpeningCash(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>DRN From (optional override)</Label>
                    <Input type="number" value={drnFromOverride} onChange={(e) => setDrnFromOverride(e.target.value)} className="mt-1" placeholder="Auto" />
                    <div className="text-xs text-muted-foreground mt-1">Default uses next order number.</div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={onStartShift} disabled={!hasPermission('performCashUp')} className="gap-2">
                    <Check className="h-4 w-4" /> Start Shift
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Shift Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KPICard title="Shift Started" value={shiftStartedAt} />
                <KPICard title="DRN From" value={String(shift.drnFrom ?? '-')} />
                <KPICard title="Staff" value={shift.staffName} />
                <KPICard title="Opening Cash" value={formatMoneyPrecise(opening, 2)} />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">DRN Range</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>DRN From</Label>
                    <Input value={String(shift.drnFrom ?? '')} disabled className="mt-1" />
                  </div>
                  <div>
                    <Label>DRN To</Label>
                    <Input type="number" value={drnTo} onChange={(e) => setDrnTo(e.target.value)} className="mt-1" />
                    <div className="text-xs text-muted-foreground mt-1">Max paid DRN: {maxPaidOrderNo || '-'}</div>
                  </div>
                  <div className="flex items-end">
                    <Button variant="outline" className="w-full" onClick={() => setDrnTo(String(maxPaidOrderNo || shift.drnFrom || ''))}>
                      Use Max Paid
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Sales Entry */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Sales by Payment Type */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sales by Payment Type</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-green-600" /> Cash Sales
                    </Label>
                    <Input
                      type="number"
                      value={sales.cashSales}
                      disabled
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-blue-600" /> Card Sales
                    </Label>
                    <Input
                      type="number"
                      value={sales.cardSales}
                      disabled
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-orange-600" /> Cheque Sales
                    </Label>
                    <Input
                      type="number"
                      value={sales.chequeSales}
                      disabled
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-teal-600" /> Mobile Money
                    </Label>
                    <Input
                      type="number"
                      value={sales.nonBankSales}
                      disabled
                      className="mt-1"
                    />
                  </div>
                </div>
                
                <div className="pt-4 border-t">
                  <div className="flex justify-between text-lg font-semibold">
                    <span>Total Sales</span>
                    <span className="text-primary">{formatMoneyPrecise(totalSales, 2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Cash Drawer Reconciliation */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cash Drawer Reconciliation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Card className="p-3 bg-muted/30">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <div className="font-medium">Payouts</div>
                      <div className="text-xs text-muted-foreground">Manager withdrawals reduce expected cash.</div>
                    </div>
                    <Button variant="outline" size="sm" onClick={addPayout} className="gap-2">
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </div>

                  <div className="mt-3 overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Reason</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payouts.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              <Select value={p.reason} onValueChange={(v) => updatePayout(p.id, { reason: v })}>
                                <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="milk">Milk / Ingredients</SelectItem>
                                  <SelectItem value="petty_cash">Petty Cash</SelectItem>
                                  <SelectItem value="transport">Transport</SelectItem>
                                  <SelectItem value="emergency">Emergency</SelectItem>
                                  <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                value={String(p.amount)}
                                onChange={(e) => updatePayout(p.id, { amount: Number(e.target.value || 0) })}
                                className="w-[140px] ml-auto"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" onClick={() => removePayout(p.id)} className="gap-2">
                                <Trash2 className="h-4 w-4" /> Remove
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {!payouts.length && (
                          <TableRow>
                            <TableCell colSpan={3} className="text-sm text-muted-foreground">No payouts recorded.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-3 flex justify-end font-semibold">Total Payouts: {formatMoneyPrecise(totalPayouts, 2)}</div>
                </Card>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Tips Collected</Label>
                    <Input type="number" value={tips} onChange={(e) => setTips(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label>Paid Orders</Label>
                    <Input value={String(sales.paidOrders.length)} disabled className="mt-1" />
                  </div>
                </div>
                
                <div>
                  <Label>Actual Cash in Drawer</Label>
                  <Input
                    type="number"
                    value={actualCash}
                    onChange={(e) => setActualCash(e.target.value)}
                    className="mt-1 text-lg font-semibold"
                  />
                </div>
                
                <div className="space-y-2 pt-4 border-t">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Opening Cash</span>
                    <span>{formatMoneyPrecise(opening, 2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">+ Cash Received</span>
                    <span>{formatMoneyPrecise(cashReceived, 2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">- Payouts</span>
                    <span>{formatMoneyPrecise(totalPayouts, 2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>= Expected Cash</span>
                    <span>{formatMoneyPrecise(expectedCash, 2)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Results Summary */}
          <Card className={cn(
            'border-2',
            shortageOverage >= 0 ? 'border-green-500' : 'border-destructive'
          )}>
            <CardContent className="py-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">Expected Cash</p>
                  <p className="text-2xl font-bold">{formatMoneyPrecise(expectedCash, 2)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">Actual Cash</p>
                  <p className="text-2xl font-bold">{formatMoneyPrecise(actual, 2)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">
                    {shortageOverage >= 0 ? 'Overage' : 'Shortage'}
                  </p>
                  <p className={cn(
                    'text-2xl font-bold flex items-center justify-center gap-2',
                    shortageOverage >= 0 ? 'text-green-600' : 'text-destructive'
                  )}>
                    {shortageOverage >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                    {shortageOverage >= 0 ? '+' : '− '}{formatMoneyPrecise(Math.abs(shortageOverage), 2)}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">Bankable Cash</p>
                  <p className="text-2xl font-bold text-primary">{formatMoneyPrecise(bankableCash, 2)}</p>
                  <p className="text-xs text-muted-foreground">(Actual - Tips)</p>
                </div>
              </div>
              
              {shortageOverage < 0 && (
                <div className="mt-4 p-3 bg-destructive/10 rounded-lg flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  <span>Cash shortage detected. Please verify the drawer count.</span>
                </div>
              )}
            </CardContent>
          </Card>
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled title="Drafts are auto-saved in this version">Save Draft</Button>
            <Button className="gap-2" onClick={onSubmitCashUp} disabled={!canCompute}>
              <Check className="h-4 w-4" /> Submit Cash Up
            </Button>
          </div>
            </>
          )}
        </TabsContent>
        
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Cash Up History</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>DRN Range</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(hasPermission('viewAllCashUps') ? cashUps : cashUps.filter((s) => s.staffId === staffId)).map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>{session.date}</TableCell>
                      <TableCell>{session.staffName}</TableCell>
                      <TableCell>{session.drnFrom} - {session.drnTo}</TableCell>
                        <TableCell className="text-right">{formatMoneyPrecise(session.totalSales, 2)}</TableCell>
                        <TableCell className="text-right">{formatMoneyPrecise(session.expectedCash, 2)}</TableCell>
                        <TableCell className="text-right">{formatMoneyPrecise(session.actualCash, 2)}</TableCell>
                      <TableCell className={cn(
                        'text-right font-medium',
                        session.shortageOverage >= 0 ? 'text-green-600' : 'text-destructive'
                      )}>
                          {session.shortageOverage >= 0 ? '+' : '− '}{formatMoneyPrecise(Math.abs(session.shortageOverage), 2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={session.status === 'approved' ? 'default' : 'secondary'}>
                          {session.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
