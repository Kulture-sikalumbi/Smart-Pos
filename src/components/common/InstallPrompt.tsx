import React from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export const useInstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = React.useState(false);

  const detectInstalled = React.useCallback(() => {
    try {
      const standaloneMedia = window.matchMedia?.("(display-mode: standalone)")?.matches;
      const standaloneNavigator = Boolean((window.navigator as any)?.standalone);
      setIsInstalled(Boolean(standaloneMedia || standaloneNavigator));
    } catch {
      setIsInstalled(false);
    }
  }, []);

  React.useEffect(() => {
    detectInstalled();
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [detectInstalled]);

  const promptInstall = React.useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice.finally(() => setDeferredPrompt(null));
      detectInstalled();
    }
  }, [deferredPrompt, detectInstalled]);

  const fallbackHint = React.useMemo(() => {
    const ua = String(window.navigator.userAgent || "").toLowerCase();
    if (ua.includes("android")) return "Chrome: tap menu (3 dots) then Add to Home screen.";
    if (ua.includes("iphone") || ua.includes("ipad")) return "Safari: tap Share then Add to Home Screen.";
    return "Use browser install option (Install app / Add to home screen).";
  }, []);

  return {
    canPrompt: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    fallbackHint,
    promptInstall,
  };
};

export const InstallPrompt: React.FC = () => null;
