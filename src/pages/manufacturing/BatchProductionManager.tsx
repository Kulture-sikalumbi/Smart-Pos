import { useEffect, useSyncExternalStore } from 'react';
import { Factory, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader, DataTableWrapper, NumericCell } from '@/components/common/PageComponents';
import { ensureBatchProductionsLoaded, getBatchProductionsSnapshot, subscribeBatchProductions } from '@/lib/batchProductionStore';
import { useCurrency } from '@/contexts/CurrencyContext';

export function BatchProductionManager() {
  const { formatMoneyPrecise } = useCurrency();
  const batches = useSyncExternalStore(subscribeBatchProductions, getBatchProductionsSnapshot);

  useEffect(() => {
    void ensureBatchProductionsLoaded();
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Batch History"
        description="Audit previously recorded production batches"
      />

      {batches.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading or no batch history yet...
          </CardContent>
        </Card>
      ) : (
        batches.map((batch) => (
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
                      {batch.batchDate} • By {batch.producedBy}
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

