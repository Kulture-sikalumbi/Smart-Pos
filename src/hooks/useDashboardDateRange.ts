import { useMemo, useState } from 'react';

export type DatePreset = 'today' | 'last7' | 'last30' | 'custom';

export function dateKeyLocal(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(base: Date, offset: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return d;
}

export function getPreviousWindow(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const diffDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(diffDays - 1));
  return { startDate: dateKeyLocal(prevStart), endDate: dateKeyLocal(prevEnd) };
}

export function useDashboardDateRange() {
  const today = useMemo(() => dateKeyLocal(new Date()), []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [preset, setPreset] = useState<DatePreset>('today');

  const safeRange = useMemo(() => {
    if (startDate <= endDate) return { startDate, endDate };
    return { startDate: endDate, endDate: startDate };
  }, [startDate, endDate]);

  const previousRange = useMemo(
    () => getPreviousWindow(safeRange.startDate, safeRange.endDate),
    [safeRange.startDate, safeRange.endDate]
  );

  const isTodayRange = safeRange.startDate === today && safeRange.endDate === today;

  const rangeLabel = useMemo(() => {
    if (isTodayRange) return "Today's reports";
    if (safeRange.startDate === safeRange.endDate) return `Report for ${safeRange.startDate}`;
    return `Reports: ${safeRange.startDate} -> ${safeRange.endDate}`;
  }, [isTodayRange, safeRange.startDate, safeRange.endDate]);

  const applyPreset = (nextPreset: DatePreset) => {
    const base = new Date();
    const end = dateKeyLocal(base);
    if (nextPreset === 'today') {
      setStartDate(end);
      setEndDate(end);
    } else if (nextPreset === 'last7') {
      setStartDate(dateKeyLocal(addDays(base, -6)));
      setEndDate(end);
    } else if (nextPreset === 'last30') {
      setStartDate(dateKeyLocal(addDays(base, -29)));
      setEndDate(end);
    }
    setPreset(nextPreset);
  };

  return {
    today,
    preset,
    setPreset,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    safeRange,
    previousRange,
    isTodayRange,
    rangeLabel,
    applyPreset,
  };
}
