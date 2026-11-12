import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Dev-only automation hook (used for scripted UI checks).
if (import.meta.env.DEV) {
  Promise.all([import("./lib/actions"), import("./lib/commands"), import("./lib/store"), import("./editor/manager")]).then(([a, c, s, m]) => {
    (window as unknown as { __shi: unknown }).__shi = { ...a, runCommand: c.runCommand, store: s.useStore, editor: m.editor };
  });
}
