import { useEffect, useState } from "react";
// Passive, localhost-only timing probe for review. No network, tracking or user data.
export default function LocalPerformanceProbe() {
  const textZoom =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(location.hostname) &&
    new URLSearchParams(location.search).get("qa_text_zoom") === "200";
  const [metrics, setMetrics] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (
      !["localhost", "127.0.0.1"].includes(location.hostname) ||
      new URLSearchParams(location.search).get("qa_performance") !== "1"
    )
      return;
    const values: Record<string, unknown> = { cls: 0, longTaskMs: 0 };
    const observers: PerformanceObserver[] = [];
    const record = () => {
      const n = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (n) {
        values.domContentLoadedMs = Math.round(n.domContentLoadedEventEnd);
        values.loadMs = Math.round(n.loadEventEnd);
      }
      const resources = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      values.transferredBytes = resources.reduce(
        (total, r) => total + r.transferSize,
        0,
      );
      values.decodedBytes = resources.reduce(
        (total, r) => total + r.decodedBodySize,
        0,
      );
      setMetrics({ ...values });
    };
    for (const type of [
      "paint",
      "largest-contentful-paint",
      "layout-shift",
      "longtask",
    ]) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (type === "paint") values[e.name] = Math.round(e.startTime);
            if (type === "largest-contentful-paint")
              values.lcpMs = Math.round(e.startTime);
            if (type === "longtask")
              values.longTaskMs =
                Number(values.longTaskMs || 0) + Math.round(e.duration);
            if (type === "layout-shift") {
              const shift = e as PerformanceEntry & {
                hadRecentInput: boolean;
                value: number;
              };
              if (!shift.hadRecentInput)
                values.cls = Number(values.cls || 0) + shift.value;
            }
          }
          record();
        });
        observer.observe({ type, buffered: true });
        observers.push(observer);
      } catch {
        /* Unsupported metric is omitted. */
      }
    }
    const afterLoad = () => requestAnimationFrame(record);
    window.addEventListener("load", afterLoad);
    record();
    return () => {
      observers.forEach((o) => o.disconnect());
      window.removeEventListener("load", afterLoad);
    };
  }, []);
  return (
    <>
      {textZoom && <style>{"html { font-size: 200%; }"}</style>}
      {metrics ? (
        <output hidden aria-hidden="true" id="local-performance-probe">
          {JSON.stringify(metrics)}
        </output>
      ) : null}
    </>
  );
}
