import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The installed app caches itself so it opens instantly. When a new version is
// deployed, swap it in and reload right away instead of showing the old one
// until the next launch.
registerSW({ immediate: true });
