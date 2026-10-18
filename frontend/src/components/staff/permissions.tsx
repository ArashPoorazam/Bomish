"use client";
import type { ReactNode } from "react";
import { useStore } from "@/components/store-provider";
import { hasStaffPermission } from "@/lib/staff-permissions";

export function useStaffPermission() {
  const { user } = useStore();
  return (key: string) => hasStaffPermission(user, key);
}

export function Permission({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const can = useStaffPermission();
  return can(name) ? children : null;
}

export function PermissionFields({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const can = useStaffPermission();
  return (
    <fieldset className="permission-fields" disabled={!can(name)}>
      {children}
    </fieldset>
  );
}
