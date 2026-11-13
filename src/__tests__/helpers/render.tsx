// Component-test harness: React 19's own `act` + react-dom/client in Vitest's jsdom, no testing library.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

// Tells React this is a test environment, so `act` flushes effects and warns about stray updates.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; components only use it to measure, which jsdom can't do anyway.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

export { act };

export interface Mounted {
  container: HTMLDivElement;
  rerender: (ui: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
}

const mounted = new Set<Mounted>();

/** Render `ui` into a fresh container attached to document.body (React delegates events to it). */
export async function render(ui: ReactNode): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => root.render(ui));
  const m: Mounted = {
    container,
    rerender: async (next) => act(async () => root.render(next)),
    unmount: async () => {
      if (!mounted.delete(m)) return;
      await act(async () => root.unmount());
      container.remove();
    },
  };
  mounted.add(m);
  return m;
}

/** Unmount everything `render` mounted (call from afterEach). Also clears portals left in body. */
export async function cleanup() {
  for (const m of [...mounted]) await m.unmount();
  document.body.replaceChildren();
}

/** Let pending promises (mocked invoke calls) and the effects they trigger settle. */
export async function flush(times = 3) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

type KeyInit = Omit<KeyboardEventInit, "key" | "bubbles" | "cancelable">;
type MouseInit = Omit<MouseEventInit, "bubbles" | "cancelable">;

const dispatch = (el: Element | Window, ev: Event) => act(async () => { el.dispatchEvent(ev); });

/** Bubbling, cancelable DOM events wrapped in `act`. */
export const fire = {
  click: (el: Element, init: MouseInit = {}) => dispatch(el, new MouseEvent("click", { bubbles: true, cancelable: true, ...init })),
  mouseDown: (el: Element | Window, init: MouseInit = {}) => dispatch(el, new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...init })),
  contextMenu: (el: Element, init: MouseInit = {}) => dispatch(el, new MouseEvent("contextmenu", { bubbles: true, cancelable: true, ...init })),
  keyDown: (el: Element | Window, key: string, init: KeyInit = {}) => dispatch(el, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })),
};

/** Elements matching `selector` whose text includes `text`. */
export function byText(root: ParentNode, selector: string, text: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter((e) => e.textContent?.includes(text));
}
