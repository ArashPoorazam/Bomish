import type { ReactNode } from "react";
import { StoreProvider } from "@/components/store-provider";
import { WorkspaceNavigationProvider } from "@/components/omnisire/navigation-state";
import "../workspace-base.css";
import "../workspace.css";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <StoreProvider workspace>
      <WorkspaceNavigationProvider>
        <main id="main">{children}</main>
      </WorkspaceNavigationProvider>
    </StoreProvider>
  );
}
