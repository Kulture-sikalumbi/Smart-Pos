import { BarChart3, ClipboardCheck, Package, Settings, ShoppingCart, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

const tools = [
  { label: 'Dashboard', icon: BarChart3, path: '/app/dashboard' },
  { label: 'Stock Items', icon: Package, path: '/app/inventory/items' },
  { label: 'Purchases (GRV)', icon: ShoppingCart, path: '/app/purchases' },
  { label: 'Stock Issues', icon: ClipboardCheck, path: '/app/inventory/stock-issues' },
  { label: 'Staff', icon: Users, path: '/app/staff' },
  { label: 'Settings', icon: Settings, path: '/app/settings' },
];

export default function BackOfficeHome() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Back Office Workspace</h1>
        <p className="text-sm text-muted-foreground">Choose a tool to continue operations.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => (
          <Card
            key={tool.path}
            className="cursor-pointer border-blue-500/20 hover:border-blue-400/60 transition-colors"
            onClick={() => navigate(tool.path)}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-base">
                <tool.icon className="h-5 w-5 text-blue-400" />
                {tool.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Open {tool.label}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

