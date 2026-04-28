export function getAllCurrencyCodes(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (Intl as any)?.supportedValuesOf;
    const list = typeof fn === 'function' ? (fn('currency') as string[]) : null;
    if (Array.isArray(list) && list.length > 0) {
      return Array.from(new Set(list.map((c) => String(c).toUpperCase()))).sort();
    }
  } catch {
    // ignore
  }
  return ['ZMW', 'USD', 'ZAR', 'EUR', 'GBP'];
}

