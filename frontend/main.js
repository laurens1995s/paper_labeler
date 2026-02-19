import { createApp } from "./vendor/vue.esm-browser.js";
import AppShell from "./app/components/AppShell.js";

const app = createApp(AppShell);
app.mount("#app");

const updateHeaderHeightVar = () => {
  const header = document.querySelector("header");
  if (!header) return;
  const h = Math.ceil(header.getBoundingClientRect().height || 0);
  if (h > 0) {
    document.documentElement.style.setProperty("--header-h", `${h}px`);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", updateHeaderHeightVar, { once: true });
} else {
  updateHeaderHeightVar();
}
window.addEventListener("resize", () => {
  updateHeaderHeightVar();
}, { passive: true });
