export function hasStaffPermission(
  user: { role?: string; permissions?: string[] } | null | undefined,
  permission: string,
): boolean {
  return user?.role === "owner" || !!user?.permissions?.includes(permission);
}
