import { useEffect, useSyncExternalStore } from 'react';
import {
  getRestaurantTablesSnapshot,
  initRestaurantTables,
  subscribeRestaurantTables,
  getRestaurantTableSections,
} from '@/lib/restaurantTablesStore';

export function useRestaurantTables() {
  const snap = useSyncExternalStore(subscribeRestaurantTables, getRestaurantTablesSnapshot, getRestaurantTablesSnapshot);
  useEffect(() => {
    initRestaurantTables();
  }, []);
  return {
    ...snap,
    sections: getRestaurantTableSections(),
  };
}

