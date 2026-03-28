import { useMemo, useState, useSyncExternalStore } from 'react';
import { Users, Clock, DollarSign, MoreVertical, ArrowRightLeft, Trash2, Eye, BellRing } from 'lucide-react';
import { PageHeader } from '@/components/common/PageComponents';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { tableSections } from '@/data/posData';
import { Table as TableType, TableStatus } from '@/types/pos';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { InteractiveFloorPlan, type FloorPlanTable } from '@/components/pos/InteractiveFloorPlan';
import { getOrdersSnapshot, subscribeOrders } from '@/lib/orderStore';
import { addPosPaymentRequest, getPosPaymentRequestsSnapshot, subscribePosPaymentRequests } from '@/lib/posPaymentRequestStore';
import { useCurrency } from '@/contexts/CurrencyContext';

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
  const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
  const [showTableDialog, setShowTableDialog] = useState(false);
  const [viewMode, setViewMode] = useState<'floor' | 'grid'>('floor');
  const [payRequestedOnly, setPayRequestedOnly] = useState(false);

  const persistedOrders = useSyncExternalStore(subscribeOrders, getOrdersSnapshot);
  // Use persisted orders only (disable demo fallback)
  const orders = useMemo(() => persistedOrders, [persistedOrders]);

  const paymentRequests = useSyncExternalStore(subscribePosPaymentRequests, getPosPaymentRequestsSnapshot);
  const paymentRequestedTableNos = useMemo(() => new Set(paymentRequests.map((r) => r.tableNo)), [paymentRequests]);

  const filteredSections = useMemo(() => {
    if (!payRequestedOnly) return tableSections;
    return tableSections
      .map((s) => ({
        ...s,
        tables: s.tables.filter((t) => paymentRequestedTableNos.has(t.number)),
      }))
      .filter((s) => s.tables.length > 0);
  }, [payRequestedOnly, paymentRequestedTableNos]);
  
  const getTableOrder = (tableId: string) => {
    return orders.find(o => o.tableId === tableId);
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
          'cursor-pointer transition-all hover:shadow-lg border-2',
          STATUS_COLORS[table.status],
          paymentRequested && 'ring-2 ring-rose-500/70'
        )}
        onClick={() => handleTableClick(table)}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{table.number}</span>
              <Badge variant="outline" className="text-xs">
                <Users className="h-3 w-3 mr-1" />{table.seats}
              </Badge>
              {paymentRequested && (
                <Badge className="bg-rose-500/15 text-rose-700 border border-rose-500/40 dark:text-rose-300">
                  <BellRing className="h-3 w-3 mr-1" /> PAY
                </Badge>
              )}
            </div>
            {table.status === 'occupied' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <Eye className="h-4 w-4 mr-2" /> View Order
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <ArrowRightLeft className="h-4 w-4 mr-2" /> Transfer Table
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" /> Void Order
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
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
        description="View and manage restaurant tables"
        actions={
          <div className="flex items-center gap-2">
            <Button variant={viewMode === 'floor' ? 'default' : 'outline'} onClick={() => setViewMode('floor')}>
              Floor Plan
            </Button>
            <Button variant={viewMode === 'grid' ? 'default' : 'outline'} onClick={() => setViewMode('grid')}>
              Grid
            </Button>
            <Button
              variant={payRequestedOnly ? 'default' : 'outline'}
              onClick={() => setPayRequestedOnly((v) => !v)}
              className={cn(payRequestedOnly && 'bg-rose-600 hover:bg-rose-600/90')}
            >
              <BellRing className="h-4 w-4 mr-2" /> PAY Requested
            </Button>
            <Button onClick={() => navigate('/pos/terminal')}>New Quick Sale</Button>
          </div>
        }
      />
      
      {/* Table Legend */}
      <div className="flex gap-4 mb-6 flex-wrap">
        {Object.entries(STATUS_LABELS).map(([status, label]) => (
          <div key={status} className="flex items-center gap-2">
            <div className={cn('w-4 h-4 rounded border-2', STATUS_COLORS[status as TableStatus])} />
            <span className="text-sm">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-rose-500/60 bg-rose-500/20" />
          <span className="text-sm">Payment Requested</span>
        </div>
      </div>
      
      {viewMode === 'floor' ? (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Interactive Floor Plan</h2>
          <InteractiveFloorPlan
            idleMinutesThreshold={20}
            tables={(() => {
              const all = (payRequestedOnly ? filteredSections : tableSections).flatMap(s => s.tables);
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
              const table = tableSections.flatMap(s => s.tables).find(x => x.id === t.id);
              if (table) handleTableClick(table);
            }}
          />
          {payRequestedOnly && !paymentRequests.length && (
            <div className="text-sm text-muted-foreground">
              No tables have requested payment yet.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {(payRequestedOnly ? filteredSections : tableSections).map(section => (
            <div key={section.id}>
              <h2 className="text-lg font-semibold mb-4">{section.name}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {section.tables.map(table => (
                  <TableCard key={table.id} table={table} />
                ))}
              </div>
            </div>
          ))}
          {payRequestedOnly && !paymentRequests.length && (
            <div className="text-sm text-muted-foreground">
              No tables have requested payment yet.
            </div>
          )}
        </div>
      )}
      
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
