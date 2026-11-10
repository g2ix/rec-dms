"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AutosaveQueue } from "@/lib/forms/autosave";
import { registerAutosaveFlusher } from "@/lib/forms/flush-registry";

/**
 * Wires flushAll to unmount / App Router navigations, action buttons, tab hide,
 * and the browser unsaved-changes warning.
 */
export function useAutosaveLifecycle(queue: AutosaveQueue | null, enabled: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const pathRef = useRef(pathname);

  useEffect(() => {
    if (!enabled || !queue) return;
    return registerAutosaveFlusher(() => queue.flushAll());
  }, [enabled, queue]);

  useEffect(() => {
    if (!enabled) return;

    function warn(event: BeforeUnloadEvent) {
      const current = queueRef.current;
      if (!current?.isDirty() && !current?.hasFailed()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function onHidden() {
      queueRef.current?.flushKeepalive();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") onHidden();
    }

    function onClick(event: MouseEvent) {
      const current = queueRef.current;
      if (!current?.isDirty() && !current?.hasFailed()) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash === window.location.hash) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        await current.flushAll();
        router.push(`${url.pathname}${url.search}${url.hash}`);
      })();
    }

    window.addEventListener("beforeunload", warn);
    window.addEventListener("pagehide", onHidden);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("pagehide", onHidden);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("click", onClick, true);
    };
  }, [enabled, router]);

  // Next.js App Router: flush when the route changes or the form unmounts.
  useEffect(() => {
    if (!enabled) return;
    if (pathRef.current !== pathname) {
      pathRef.current = pathname;
      void queueRef.current?.flushAll();
    }
    return () => {
      const current = queueRef.current;
      if (!current) return;
      if (current.isDirty() || current.hasFailed()) current.flushKeepalive();
      else void current.flushAll();
    };
  }, [enabled, pathname]);
}
