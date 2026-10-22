import { lazyModule } from './lazy-module';
import type { DeskCallbacks, DeskSnapshot } from './desk/desk';

export type { DeskCallbacks, DeskSnapshot } from './desk/desk';

/** The Desk strip chunk (Reinvention Slice 1): loads only when the
 * home view first renders, keeping the Desk's React tree out of the
 * initial shell paint for surfaces that never show it. DEF-037: the
 * chunk promise comes from lazyModule — a failed import clears the
 * cache and the next mount retries. pushDesk before the chunk lands
 * is queued: the latest snapshot is what renders on arrival. */
const chunk = lazyModule(() => import('./desk/desk'));

let latest: DeskSnapshot | null = null;
let host: HTMLElement | null = null;
let callbacksRef: DeskCallbacks = {};
let mounted = false;

export function mountDeskStrip(element: HTMLElement, snapshot: DeskSnapshot, callbacks: DeskCallbacks): void {
  host = element;
  latest = snapshot;
  callbacksRef = callbacks;
  void chunk
    .get()
    .then((module) => {
      if (!host || !latest) return;
      module.mountDesk(host, latest, callbacksRef);
      mounted = true;
    })
    .catch(() => {
      /* a failed chunk leaves the strip absent; the next mount retries */
    });
}

export function pushDeskStrip(snapshot: DeskSnapshot): void {
  latest = snapshot;
  if (!mounted) return;
  void chunk
    .get()
    .then((module) => {
      if (latest) module.pushDesk(latest);
    })
    .catch(() => {});
}

export function deskStripMounted(): boolean {
  return mounted;
}
