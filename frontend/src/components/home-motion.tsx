"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function HomeMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (!root.current || !("IntersectionObserver" in window)) return;
    const animations = new Set<Animation>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          if (motion.matches || entry.target.contains(document.activeElement))
            continue;
          const animation = entry.target.animate(
            [
              { opacity: 0, transform: "translateY(12px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 420, easing: "cubic-bezier(0.2, 0.65, 0.3, 1)" },
          );
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        }
      },
      { threshold: 0.08 },
    );
    // Content stays visible without JavaScript; only offscreen sections animate.
    root.current.querySelectorAll("[data-home-reveal]").forEach((el) => {
      if (el.getBoundingClientRect().top >= innerHeight) observer.observe(el);
    });
    const stop = () => {
      if (!motion.matches) return;
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    };
    motion.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
      motion.removeEventListener("change", stop);
    };
  }, []);
  return (
    <div className="shop-home" ref={root}>
      {children}
    </div>
  );
}
