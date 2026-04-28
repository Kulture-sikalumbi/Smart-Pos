import { Globe } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { CurrencyCode } from '@/types';
import { useCurrency } from '@/contexts/CurrencyContext';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAllCurrencyCodes } from '@/lib/currencyOptions';

export function CurrencyPicker(props: { className?: string; disabled?: boolean }) {
  const { currencyCode, setCurrencyCode, currencySyncState, currencySyncMessage } = useCurrency();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const options = useMemo(() => getAllCurrencyCodes(), []);

  return (
    <div className={props.className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 w-[160px] justify-between bg-background/40 border border-white/10"
            disabled={props.disabled}
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Globe className="h-4 w-4 text-muted-foreground" />
              {currencyCode}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="end">
          <div className="px-3 pt-2 pb-1 text-[11px] text-muted-foreground">
            Status:{' '}
            <span
              className={cn(
                'font-medium',
                currencySyncState === 'saved' && 'text-emerald-600',
                currencySyncState === 'saving' && 'text-amber-600',
                currencySyncState === 'error' && 'text-destructive'
              )}
            >
              {currencySyncMessage ?? 'Ready'}
            </span>
          </div>
          <Command>
            <CommandInput
              placeholder="Search currency…"
              value={search}
              onValueChange={(v) => setSearch(String(v ?? '').toUpperCase())}
            />
            <CommandList>
              <CommandEmpty>No currency found.</CommandEmpty>
              <CommandGroup heading="All currencies">
                {options.map((c) => (
                  <CommandItem
                    key={c}
                    value={c}
                    onSelect={(val) => {
                      const next = String(val || c).toUpperCase();
                      setCurrencyCode(next as CurrencyCode);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4', currencyCode === c ? 'opacity-100' : 'opacity-0')} />
                    {c}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
