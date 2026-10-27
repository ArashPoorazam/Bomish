"use client";
import ErrorState from "@/components/error-state";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main">
      <ErrorState reset={reset} />
    </main>
  );
}
