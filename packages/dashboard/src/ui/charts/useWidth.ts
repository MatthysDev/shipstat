import { useEffect, useRef, useState } from 'react';

/** Width of a container in CSS pixels, so charts draw at real size and text never scales. */
export function useWidth(initial = 600) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}
