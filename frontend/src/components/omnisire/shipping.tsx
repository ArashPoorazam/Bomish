"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { hasStaffPermission } from "@/lib/staff-permissions";
import type { ShippingConfig } from "@/lib/types";
import { useStore } from "@/components/store-provider";
import { ShippingEditor } from "@/components/staff/operations";
import { PermissionFields } from "../staff/permissions";
import { Workspace, Feedback } from "./shared";

export function ShippingPage({ owner = true }: { owner?: boolean }) {
  const { user } = useStore();
  const [config, setConfig] = useState<ShippingConfig | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState({ dirty: false, busy: false });
  useEffect(() => {
    if (!hasStaffPermission(user, "shipping")) return;
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
  }, [user?.role, user?.staffId, user?.permissions, revision]);
  return (
    <Workspace
      owner={owner}
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
      {config && (
        <PermissionFields name="shipping.edit">
          <ShippingEditor initial={config} onStateChange={setEditor} />
        </PermissionFields>
      )}
    </Workspace>
  );
}
