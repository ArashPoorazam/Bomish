"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ShippingConfig } from "@/lib/types";
import { useStore } from "@/components/store-provider";
import { ShippingEditor } from "@/components/staff/operations";
import { Workspace, Feedback } from "./shared";

export function ShippingPage() {
  const { user } = useStore();
  const [config, setConfig] = useState<ShippingConfig | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState({ dirty: false, busy: false });
  useEffect(() => {
    if (user?.role !== "owner") return;
    let live = true;
    setLoading(true);
    setError("");
    api<ShippingConfig>("/staff/shipping")
      .then((data) => {
        if (live) setConfig(data);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [user?.role, user?.staffId, revision]);
  return (
    <Workspace
      owner
      title="ارسال"
      activeSection="shipping"
      navigationLocked={editor.busy}
    >
      <Feedback error={error} loading={loading} />
      {error && (
        <button
          className="button secondary"
          onClick={() => setRevision((v) => v + 1)}
        >
          تلاش دوباره
        </button>
      )}
      {config && <ShippingEditor initial={config} onStateChange={setEditor} />}
    </Workspace>
  );
}
