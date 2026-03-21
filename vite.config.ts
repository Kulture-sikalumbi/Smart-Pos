
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Mthunzi",
        short_name: "Mthunzi",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0e14",
        theme_color: "#2563eb",
        description: "Restaurant back office + POS (offline-first)",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        // Allow larger bundles to be precached (default is 2 MiB, which can break builds)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // Ensure new SW versions activate and clean up quickly to avoid stale-cache issues
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ["**/*.{js,css,html,svg,webmanifest,png,ico,jpg,jpeg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /\/menu\//,
            handler: "CacheFirst",
            options: {
              cacheName: "menu-images",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /\.(js|css)$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "assets",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "pages",
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
