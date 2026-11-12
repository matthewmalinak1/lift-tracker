import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // Makes the site installable to the phone home screen and caches the app
    // shell so it opens instantly (and offline) in the gym.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "Lift Tracker",
        short_name: "Lifts",
        description: "Strength tracking with WHOOP recovery data",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Never serve API responses from the cache; data must be live.
        navigateFallbackDenylist: [/^\/api\//, /\.xlsx$/],
      },
    }),
  ],
  server: {
    // Local dev: forward /api calls to the FastAPI server on :8000.
    proxy: { "/api": "http://localhost:8000" },
  },
});
