type Listener = (msgs: string[]) => void;

// Use a global singleton to avoid duplicate declarations during HMR or
// when the module may be evaluated more than once in the bundler.
const GLOBAL_KEY = '__mthunzi_debug_v1';

declare global {
  interface GlobalThis {
    [GLOBAL_KEY]?: {
      msgs: string[];
      listeners: Set<Listener>;
    };
  }
}

if (!(globalThis as any)[GLOBAL_KEY]) {
  (globalThis as any)[GLOBAL_KEY] = { msgs: [], listeners: new Set<Listener>() };
}

const store = (globalThis as any)[GLOBAL_KEY] as { msgs: string[]; listeners: Set<Listener> };

export function pushDebug(msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  store.msgs = [line, ...store.msgs].slice(0, 80);
  for (const l of store.listeners) l(store.msgs.slice());
}

export function getDebug() {
  return store.msgs.slice();
}

export function subscribeDebug(fn: Listener) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

export default { pushDebug, getDebug, subscribeDebug };
