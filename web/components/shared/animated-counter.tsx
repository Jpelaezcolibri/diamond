"use client";

import * as React from "react";
import { useInView, useReducedMotion } from "framer-motion";

interface AnimatedCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  className?: string;
}

/** Counter que anima una sola vez al entrar al viewport. Reduced-motion → estatico. */
export function AnimatedCounter({ value, prefix = "", suffix = "", durationMs = 1400, className }: AnimatedCounterProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduced = useReducedMotion();
  const isDecimal = !Number.isInteger(value);
  const [display, setDisplay] = React.useState(reduced ? value : 0);

  React.useEffect(() => {
    if (!inView || reduced) {
      if (reduced) setDisplay(value);
      return;
    }
    let frame: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 4); // ease-out-quart
      setDisplay(isDecimal ? Number((value * eased).toFixed(1)) : Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, reduced, value, durationMs, isDecimal]);

  return (
    <span ref={ref} className={className} aria-label={`${prefix}${value}${suffix}`}>
      <span aria-hidden="true" className="tabular-nums">
        {prefix}
        {isDecimal ? display.toFixed(1) : display.toLocaleString("es-CO")}
        {suffix}
      </span>
    </span>
  );
}
