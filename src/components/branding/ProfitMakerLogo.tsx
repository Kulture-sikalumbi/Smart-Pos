import React from 'react';
import { cn } from '@/lib/utils';

type ProfitMakerLogoProps = {
  className?: string;
  textClassName?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLabel?: boolean;
  label?: string;
};

const sizeClassMap: Record<NonNullable<ProfitMakerLogoProps['size']>, string> = {
  sm: 'h-8 w-8 rounded-xl',
  md: 'h-12 w-12 rounded-2xl',
  lg: 'h-16 w-16 rounded-[1.1rem]',
  xl: 'h-28 w-28 rounded-[1.7rem]',
};

const textSizeClassMap: Record<NonNullable<ProfitMakerLogoProps['size']>, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
  xl: 'text-[3.25rem]',
};

const textTrackClassMap: Record<NonNullable<ProfitMakerLogoProps['size']>, string> = {
  sm: 'tracking-[-0.02em]',
  md: 'tracking-[-0.03em]',
  lg: 'tracking-[-0.04em]',
  xl: 'tracking-[-0.06em]',
};

export function ProfitMakerLogo({
  className,
  textClassName,
  size = 'lg',
  showLabel = false,
  label = 'PROFIT-MAKER POS',
}: ProfitMakerLogoProps) {
  return (
    <div className={cn('inline-flex flex-col items-center gap-2', className)}>
      <div
        className={cn(
          'relative isolate grid place-items-center overflow-hidden border border-cyan-300/30 bg-slate-900/80 backdrop-blur-xl',
          sizeClassMap[size]
        )}
        style={{
          boxShadow:
            '0 0 0 1px rgba(34,211,238,0.16) inset, 0 0 22px rgba(0,255,255,0.45), 0 8px 26px rgba(0, 0, 0, 0.42)',
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_95%_at_50%_5%,rgba(255,255,255,0.16),transparent_55%),linear-gradient(180deg,rgba(6,182,212,0.14)_0%,rgba(15,23,42,0.55)_60%,rgba(2,6,23,0.78)_100%)]" />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-[14%] rounded-[22%] border border-cyan-200/20"
        />
        <span
          className={cn(
            'relative z-10 select-none font-black leading-none text-[#7df9ff]',
            textSizeClassMap[size],
            textTrackClassMap[size],
            textClassName
          )}
          style={{
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            textShadow:
              '0 0 7px rgba(0,255,255,0.95), 0 0 16px rgba(0,255,255,0.82), 0 0 28px rgba(0,255,255,0.58)',
            filter: 'drop-shadow(0 0 6px rgba(0,255,255,0.78))',
            transform: size === 'xl' ? 'translateY(-2px)' : undefined,
          }}
        >
          $++
        </span>
      </div>
      {showLabel ? (
        <div
          className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8dffce]"
          style={{
            textShadow: '0 0 9px rgba(153,255,219,0.55)',
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}

