import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, ChefHat, ClipboardCheck, Lock, Package, Receipt, RefreshCcw, ShoppingCart, Users, UtensilsCrossed, Boxes, Grid3X3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { toast } from '@/hooks/use-toast';
import { ROLE_ACCESS_HELPERS, ROLE_NAMES } from '@/types/auth';

export default function Hub() {
  const navigate = useNavigate();
  const { user, staffLogin } = useAuth();
  const { canUseBackOffice, canUseFrontOffice, setWorkspace } = useWorkspace();

  const role = String((user as any)?.role ?? '').toLowerCase();
  const userRole = (user?.role ?? 'cashier') as keyof typeof ROLE_NAMES;
  const [switchOpen, setSwitchOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role === 'cashier') {
      setWorkspace('front');
      navigate('/app/pos/terminal', { replace: true });
    }
  }, [role, navigate, setWorkspace]);

  const goBackOffice = () => {
    if (!canUseBackOffice) return;
    setWorkspace('back');
    navigate('/app/back-office');
  };

  const goFrontOffice = () => {
    if (!canUseFrontOffice) return;
    setWorkspace('front');
    navigate('/app/front-office');
  };

  const onSwitchStaff = async () => {
    setBusy(true);
    try {
      const res = await staffLogin(email, pin);
      if (!res.ok) {
        toast({ title: 'Switch failed', description: res.message ?? 'Invalid credentials', variant: 'destructive' });
        return;
      }
      setSwitchOpen(false);
      setEmail('');
      setPin('');
      toast({ title: 'Switched', description: 'Staff session updated.' });
      const nextRole = String(res.role ?? '').toLowerCase();
      if (nextRole === 'cashier') {
        setWorkspace('front');
        navigate('/app/pos/terminal', { replace: true });
        return;
      }
      navigate('/hub', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  const cardBase =
    'border-white/20 bg-white/10 backdrop-blur-xl shadow-2xl hover:bg-white/15 transition-all text-white';
  const toolTileBase = 'group rounded-xl border border-white/20 bg-white/5 p-4 text-left hover:bg-white/10 transition-all';

  const backOfficeTools = [
    { label: 'Dashboard', icon: BarChart3, path: '/app/dashboard' },
    { label: 'Stock Items', icon: Package, path: '/app/inventory/items' },
    { label: 'Purchases (GRV)', icon: ShoppingCart, path: '/app/purchases' },
    { label: 'Stock Issues', icon: ClipboardCheck, path: '/app/inventory/stock-issues' },
    { label: 'Staff', icon: Users, path: '/app/staff' },
  ];

  const frontOfficeTools = [
    { label: 'POS Terminal', icon: Receipt, path: '/app/pos/terminal' },
    { label: 'Kitchen Display', icon: UtensilsCrossed, path: '/app/pos/kitchen' },
    { label: 'Front Office Stock', icon: Package, path: '/app/inventory/front-office-stock' },
    { label: 'Batch Production', icon: Boxes, path: '/app/manufacturing/production' },
    { label: 'Tables', icon: Grid3X3, path: '/app/pos/tables' },
  ];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,#14213d_0%,#0a0a0f_40%,#020617_100%)] text-white p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Command Center</h1>
            <p className="text-sm text-white/70 mt-1">Choose your workspace mode for this shift.</p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs">
              <span className="text-white/80">Access Profile:</span>
              <span className="font-semibold text-cyan-200">{ROLE_NAMES[userRole]}</span>
            </div>
            <div className="mt-2 space-y-1">
              {ROLE_ACCESS_HELPERS[userRole].slice(0, 2).map((hint) => (
                <p key={hint} className="text-xs text-white/70">- {hint}</p>
              ))}
            </div>
          </div>
          <Button variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10" onClick={() => setSwitchOpen(true)}>
            <RefreshCcw className="h-4 w-4 mr-2" />
            Switch Staff
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <motion.div whileHover={{ scale: canUseBackOffice ? 1.02 : 1 }} whileTap={{ scale: canUseBackOffice ? 0.99 : 1 }}>
            <Card className={cardBase}>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Package className="h-6 w-6 text-cyan-300" />
                  Back Office Operations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-white/75">Inventory control, GRV, reports, compliance, staff administration.</p>
                <div className="grid grid-cols-2 gap-3">
                  {backOfficeTools.map((tool) => (
                    <button
                      key={tool.path}
                      type="button"
                      disabled={!canUseBackOffice}
                      onClick={() => {
                        if (!canUseBackOffice) return;
                        setWorkspace('back');
                        navigate(tool.path);
                      }}
                      className={toolTileBase}
                    >
                      <tool.icon className="h-8 w-8 text-cyan-300 group-hover:scale-105 transition-transform" />
                      <p className="mt-2 text-xs text-white/85">{tool.label}</p>
                    </button>
                  ))}
                </div>
                <Button onClick={goBackOffice} disabled={!canUseBackOffice} className="w-full">
                  {canUseBackOffice ? 'Enter Back Office' : <span className="inline-flex items-center gap-2"><Lock className="h-4 w-4" />Restricted</span>}
                </Button>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div whileHover={{ scale: canUseFrontOffice ? 1.02 : 1 }} whileTap={{ scale: canUseFrontOffice ? 0.99 : 1 }}>
            <Card className={cardBase}>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <ChefHat className="h-6 w-6 text-emerald-300" />
                  Front Office & Kitchen
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-white/75">POS terminal, kitchen flow, table service, front stock operations.</p>
                <div className="grid grid-cols-2 gap-3">
                  {frontOfficeTools.map((tool) => (
                    <button
                      key={tool.path}
                      type="button"
                      disabled={!canUseFrontOffice}
                      onClick={() => {
                        if (!canUseFrontOffice) return;
                        setWorkspace('front');
                        navigate(tool.path);
                      }}
                      className={toolTileBase}
                    >
                      <tool.icon className="h-8 w-8 text-emerald-300 group-hover:scale-105 transition-transform" />
                      <p className="mt-2 text-xs text-white/85">{tool.label}</p>
                    </button>
                  ))}
                </div>
                <Button onClick={goFrontOffice} disabled={!canUseFrontOffice} className="w-full">
                  {canUseFrontOffice ? 'Enter Front Office' : <span className="inline-flex items-center gap-2"><Lock className="h-4 w-4" />Restricted</span>}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>

      <Dialog open={switchOpen} onOpenChange={setSwitchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch Staff</DialogTitle>
            <DialogDescription>Enter staff email and 4-digit PIN to switch operator without full logout.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>PIN</Label>
              <Input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwitchOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={onSwitchStaff} disabled={busy}>Switch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

