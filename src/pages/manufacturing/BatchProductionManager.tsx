import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Factory, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader, DataTableWrapper, NumericCell } from '@/components/common/PageComponents';
import { ensureBatchProductionsLoaded, getBatchProductionsSnapshot, subscribeBatchProductions } from '@/lib/batchProductionStore';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function BatchProductionManager() {
  const { formatMoneyPrecise } = useCurrency();
  const batches = useSyncExternalStore(subscribeBatchProductions, getBatchProductionsSnapshot);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    void ensureBatchProductionsLoaded();
  }, []);

  const applyPreset = (preset: 'today' | 'week' | 'month') => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;

    if (preset === 'today') {
      setFromDate(today);
      setToDate(today);
      return;
    }

    if (preset === 'week') {
      const day = now.getDay(); // 0 = Sunday
      const diffToMonday = day === 0 ? 6 : day - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - diffToMonday);
      const mY = monday.getFullYear();
      const mM = String(monday.getMonth() + 1).padStart(2, '0');
      const mD = String(monday.getDate()).padStart(2, '0');
      setFromDate(`${mY}-${mM}-${mD}`);
      setToDate(today);
      return;
    }

    const startOfMonth = `${yyyy}-${mm}-01`;
    setFromDate(startOfMonth);
    setToDate(today);
  };

  const filteredBatches = useMemo(() => {
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`).getTime() : null;
    return batches.filter((batch) => {
      const t = new Date(String(batch.batchDate)).getTime();
      if (!Number.isFinite(t)) return true;
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      return true;
    });
  }, [batches, fromDate, toDate]);
  const activePreset = useMemo(() => {
    if (!fromDate || !toDate) return null;
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const today = `${yyyy}-${mm}-${dd}`;
    const startOfMonth = `${yyyy}-${mm}-01`;
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const mY = monday.getFullYear();
    const mM = String(monday.getMonth() + 1).padStart(2, '0');
    const mD = String(monday.getDate()).padStart(2, '0');
    const weekStart = `${mY}-${mM}-${mD}`;
    if (fromDate === today && toDate === today) return 'today';
    if (fromDate === weekStart && toDate === today) return 'week';
    if (fromDate === startOfMonth && toDate === today) return 'month';
    return null;
  }, [fromDate, toDate]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Batch History"
        description="Audit previously recorded production batches"
      />

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">From date</div>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">To date</div>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                }}
              >
                Clear filters
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button type="button" size="sm" variant={activePreset === 'today' ? 'default' : 'secondary'} onClick={() => applyPreset('today')}>Today</Button>
            <Button type="button" size="sm" variant={activePreset === 'week' ? 'default' : 'secondary'} onClick={() => applyPreset('week')}>This Week</Button>
            <Button type="button" size="sm" variant={activePreset === 'month' ? 'default' : 'secondary'} onClick={() => applyPreset('month')}>This Month</Button>
          </div>
        </CardContent>
      </Card>

      {filteredBatches.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {batches.length === 0 ? 'Loading or no batch history yet...' : 'No batch records for selected dates.'}
          </CardContent>
        </Card>
      ) : (
        filteredBatches.map((batch) => (
          <Card key={batch.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Factory className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">{batch.recipeName}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {batch.batchDate} • Batch recorded by {batch.producedBy}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">{formatMoneyPrecise(batch.totalCost, 2)}</p>
                  <p className="text-xs text-muted-foreground">Unit: {formatMoneyPrecise(batch.unitCost, 2)}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 p-3 bg-muted/50 rounded-md">
                <div>
                  <p className="text-xs text-muted-foreground">Theoretical</p>
                  <p className="font-medium">{batch.theoreticalOutput}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Actual</p>
                  <p className="font-medium">{batch.actualOutput}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Yield Variance</p>
                  <p className={`font-medium ${batch.yieldVariance < 0 ? 'text-destructive' : 'text-success'}`}>
                    {batch.yieldVariance > 0 ? '+' : ''}
                    {batch.yieldVariance} ({batch.yieldVariancePercent.toFixed(1)}%)
                  </p>
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
                        <TableCell className="text-right">
                          {i.requiredQty} {i.unitType}
                        </TableCell>
                        <TableCell className="text-right">
                          <NumericCell value={i.unitCost} money />
                        </TableCell>
                        <TableCell className="text-right">
                          <NumericCell value={i.requiredQty * i.unitCost} money />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTableWrapper>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

