import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { HashRouter } from "react-router-dom";
import { TenantProvider } from "./contexts/TenantContext";
import { AuthProvider } from "./contexts/AuthContext";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";

const isDesktopRuntime = typeof window !== 'undefined' && Boolean((window as any).electron);

if (isDesktopRuntime && 'serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
    .catch(() => {
      // Ignore SW cleanup failures in desktop runtime.
    });
}

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <TenantProvider>
      <HashRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </HashRouter>
    </TenantProvider>
  </AuthProvider>
);
