"use client";
import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "../store-provider";

type NavigationState = {
  scrollTop: number;
  closed: Record<string, boolean>;
};
const Context = createContext<Record<string, NavigationState> | null>(null);

// Lives above route pages, so replacing a page cannot reset the navigation.
// Keep each account and workspace separate; never store credentials here.
export function WorkspaceNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const state = useRef<Record<string, NavigationState>>({});
  return <Context.Provider value={state.current}>{children}</Context.Provider>;
}

export function useNavigationState(owner: boolean) {
  const states = useContext(Context);
  const { user } = useStore();
  if (!states) throw new Error("Missing workspace navigation provider");
  const key = `${user?.staffId || "guest"}:${owner ? "omnisire" : "staff"}`;
  return (states[key] ??= { scrollTop: 0, closed: {} });
}
