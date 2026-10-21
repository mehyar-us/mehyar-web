/** Lazy chunk loader with a self-healing cache (UX audit Tier 0 —
 * DEF-037).
 *
 * Every *-loader.ts used to cache its import promise with
 * `loaded ??= import(...)`: if the import rejected — one transient
 * network failure, or a deploy that swapped chunk hashes mid-session —
 * the rejected promise was cached forever and the island never
 * appeared again until a hard reload, despite comments claiming the
 * "next push retries". get() clears the cache the moment an import
 * fails, so the next call genuinely re-imports. Successful imports
 * stay cached, and concurrent callers share one promise, exactly as
 * before. peek() returns the in-flight/resolved promise WITHOUT
 * starting a load (the unload paths: nothing loaded, nothing to
 * unmount — and a failed load leaves nothing mounted either). */
export function lazyModule<T>(load: () => Promise<T>): { get: () => Promise<T>; peek: () => Promise<T> | null } {
  let cached: Promise<T> | null = null;
  return {
    get() {
      cached ??= load().catch((error: unknown) => {
        cached = null;
        throw error;
      });
      return cached;
    },
    peek() {
      return cached;
    },
  };
}
