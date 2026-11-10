"use client";

import { useEffect, useState } from "react";

/**
 * Tracks whether an element is wider than its box (it scrolls sideways). Such a
 * region must be keyboard-reachable (WCAG 2.1.1); one that fits must not add an
 * extra, meaningless tab stop. Returns a callback ref (works for elements that
 * mount later, e.g. after loading) and the current state.
 */
export function useHorizontalOverflow<T extends HTMLElement>(): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    if (!el) return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    if (typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    // Fires once on observe, then on every size change of the box or its content.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, overflowing];
}
