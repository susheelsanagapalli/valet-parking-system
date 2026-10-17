/**
 * Holds an object that can be replaced while the server runs (e.g. switching the data store from
 * memory to Google Sheets when an admin connects Google), behind a stable proxy that request
 * handlers keep using.
 */
export class Swappable<T extends object> {
  constructor(public current: T) {}

  proxy(): T {
    return new Proxy({} as T, {
      get: (_target, key) => {
        const value = (this.current as Record<PropertyKey, unknown>)[key];
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(this.current) : value;
      },
    });
  }
}
