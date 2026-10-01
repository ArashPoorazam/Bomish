"use client";
import { useEffect, useState } from "react";
import { HomeSlidesEditor } from "./home-slides";
import { SuggestionsEditor } from "./suggestions";
export type HomeEditorState = { dirty: boolean; busy: boolean };
export function HomeManagement({
  onState,
}: {
  onState: (state: HomeEditorState) => void;
}) {
  const [slides, setSlides] = useState<HomeEditorState>({
    dirty: false,
    busy: false,
  });
  const [products, setProducts] = useState<HomeEditorState>({
    dirty: false,
    busy: false,
  });
  const dirty = slides.dirty || products.dirty;
  const busy = slides.busy || products.busy;
  useEffect(() => {
    onState({ dirty, busy });
  }, [dirty, busy, onState]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  return (
    <div className="home-management">
      <HomeSlidesEditor onState={setSlides} />
      <SuggestionsEditor onState={setProducts} />
    </div>
  );
}
