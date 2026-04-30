// src/components/layout/SyncStatusIndicator.tsx
import { useOfflineSync } from '@/hooks/useOfflineSync';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

const SyncStatusIndicator = () => {
  const isOnline = useOnlineStatus();
  const { isSyncing, pendingCount } = useOfflineSync();

  let statusText = 'Online';
  let StatusIcon = Wifi;
  let color = 'text-green-500';

  if (!isOnline) {
    statusText = 'Offline';
    StatusIcon = WifiOff;
    color = 'text-destructive';
  } else if (isSyncing) {
    statusText = `Syncing (${pendingCount})...`;
    StatusIcon = RefreshCw;
    color = 'text-primary animate-spin';
  } else if (pendingCount > 0) {
    statusText = `Pending (${pendingCount})`;
    StatusIcon = RefreshCw;
    color = 'text-amber-500';
  }

  return (
    <div className={`flex items-center text-sm font-medium ${color}`}>
      <StatusIcon className="mr-2 h-4 w-4" />
      <span>{statusText}</span>
    </div>
  );
};

export default SyncStatusIndicator;
