"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeSlide } from "@/lib/types";
import { fa } from "@/lib/format";

const fallback: HomeSlide = {
  image: "/images/spices.png",
  alt: "چیدمان ادویه‌های رنگارنگ، نعناع، کنجد و دارچین",
};
export function HomeSlideshow({ slides }: { slides: HomeSlide[] }) {
  const pictures = slides.length ? slides : [fallback];
  const [frame, setFrame] = useState({
    index: 0,
    previous: -1,
    tick: 0,
    direction: 1,
  });
  const [paused, setPaused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReduced(motion.matches);
    const syncVisibility = () =>
      setHidden(document.visibilityState !== "visible");
    syncMotion();
    syncVisibility();
    motion.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);
  const advance = useCallback(
    (target?: number, direction = 1) => {
      setFrame((old) => {
        const index = target ?? (old.index + 1) % pictures.length;
        return index === old.index
          ? old
          : { index, previous: old.index, tick: old.tick + 1, direction };
      });
    },
    [pictures.length],
  );
  const running =
    pictures.length > 1 &&
    !paused &&
    !dragging &&
    !hovered &&
    !focused &&
    !hidden &&
    !reduced;
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => advance(), 5000);
    return () => clearTimeout(timer);
  }, [running, advance, frame.tick]);
  const picture = (index: number, outgoing = false) => {
    const slide = pictures[index];
    const source = failed[slide.image] ? fallback : slide;
    return (
      <div
        key={`${frame.tick}-${outgoing ? "old" : "new"}`}
        className={`hero-slide ${outgoing ? "is-outgoing" : frame.previous >= 0 ? "is-incoming" : ""}`}
        aria-hidden={outgoing || undefined}
      >
        <Image
          src={source.image}
          alt={outgoing ? "" : source.alt}
          fill
          draggable={false}
          preload={frame.tick === 0 && !outgoing}
          sizes="(max-width: 760px) 100vw, 50vw"
          onError={() => setFailed((old) => ({ ...old, [slide.image]: true }))}
        />
      </div>
    );
  };
  return (
    <div
      className={`hero-art hero-slideshow${pictures.length > 1 ? " is-draggable" : ""}${dragging ? " is-dragging" : ""}`}
      data-direction={frame.direction}
      role="region"
      aria-label="تصاویر بومیش"
      aria-roledescription="نمایش اسلاید"
      onKeyDown={(e) => {
        if (pictures.length < 2 || !["ArrowLeft", "ArrowRight"].includes(e.key))
          return;
        e.preventDefault();
        const direction = e.key === "ArrowRight" ? 1 : -1;
        setPaused(true);
        advance(
          (frame.index + direction + pictures.length) % pictures.length,
          direction,
        );
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <div
        className="hero-slide-viewport"
        aria-live={running ? "off" : "polite"}
        onPointerDown={(e) => {
          if (pictures.length < 2 || !e.isPrimary || e.button !== 0) return;
          gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }}
        onPointerUp={(e) => {
          const start = gesture.current;
          if (!start || start.id !== e.pointerId) return;
          gesture.current = null;
          setDragging(false);
          e.currentTarget.releasePointerCapture(e.pointerId);
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
          const direction = dx > 0 ? 1 : -1;
          setPaused(true);
          advance(
            (frame.index + direction + pictures.length) % pictures.length,
            direction,
          );
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          setDragging(false);
        }}
      >
        {frame.previous >= 0 && picture(frame.previous, true)}
        {picture(frame.index)}
      </div>
      {pictures.length > 1 && (
        <div className="hero-slide-preload" aria-hidden="true">
          <Image
            src={pictures[(frame.index + 1) % pictures.length].image}
            alt=""
            fill
            loading="eager"
            sizes="(max-width: 760px) 100vw, 50vw"
          />
        </div>
      )}
      {(pictures[frame.index].image === fallback.image ||
        failed[pictures[frame.index].image]) && (
        <span className="image-note">تصویر نمایشی</span>
      )}
      {pictures.length > 1 && (
        <div className="hero-slide-controls">
          <div className="hero-slide-dots">
            {pictures.map((_, i) => (
              <button
                type="button"
                key={i}
                aria-label={`نمایش تصویر ${fa(i + 1)}`}
                aria-pressed={frame.index === i}
                onClick={() => {
                  setPaused(true);
                  advance(i, i > frame.index ? 1 : -1);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
