import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { lazyModule } from '../web/lazy-module';

/** UX audit Tier 0 — DEF-037: every *-loader.ts used to cache its
 * import promise with `loaded ??= import(...)`, so ONE failed chunk
 * load poisoned the island for the whole session (the cached rejected
 * promise was re-awaited forever). The loaders now share lazyModule:
 * a failed import clears the cache and the next call retries. */

it('a failed import clears the cache — the next get() retries and succeeds', async () => {
  let attempts = 0;
  const chunk = lazyModule(async () => {
    attempts++;
    if (attempts === 1) throw new Error('chunk load failed (network blip)');
    return { mount: 'ok' };
  });
  await expect(chunk.get()).rejects.toThrow('chunk load failed');
  expect(chunk.peek()).toBeNull();
  await expect(chunk.get()).resolves.toEqual({ mount: 'ok' });
  expect(attempts).toBe(2);
  // Success stays cached: no third import.
  await expect(chunk.get()).resolves.toEqual({ mount: 'ok' });
  expect(attempts).toBe(2);
  expect(chunk.peek()).not.toBeNull();
});

it('concurrent callers share one in-flight import', async () => {
  let attempts = 0;
  const chunk = lazyModule(async () => {
    attempts++;
    await new Promise((r) => setTimeout(r, 5));
    return attempts;
  });
  const [a, b] = await Promise.all([chunk.get(), chunk.get()]);
  expect(a).toBe(b);
  expect(attempts).toBe(1);
});

it('peek() never starts a load', () => {
  let attempts = 0;
  const chunk = lazyModule(async () => {
    attempts++;
    return {};
  });
  expect(chunk.peek()).toBeNull();
  expect(attempts).toBe(0);
});

it('every cached *-loader.ts routes through lazyModule — the poisoned pattern is gone', () => {
  const loaders = [
    'account-cards-loader.ts',
    'audit-receipt-loader.ts',
    'billing-loader.ts',
    'composer-cluster-loader.ts',
    'connections-dialogs-loader.ts',
    'connections-hub-loader.ts',
    'connector-card-panels-loader.ts',
    'notifications-inbox-loader.ts',
    'places-onboarding-panels-loader.ts',
    'proactive-panels-loader.ts',
    'transcript-list-loader.ts',
  ];
  for (const file of loaders) {
    const source = readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8');
    expect(source, file).toContain("from './lazy-module'");
    expect(source, file).not.toContain('??= import');
  }
});
