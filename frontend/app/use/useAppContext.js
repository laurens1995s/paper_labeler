import { inject } from "../../vendor/vue.esm-browser.js";

export const useAppContext = () => {
  const app = inject("app");
  if (!app) throw new Error("App context not found. Make sure AppShell provides it.");
  return app;
};
