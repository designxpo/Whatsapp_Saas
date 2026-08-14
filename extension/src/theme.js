// Light / dark / system theme, shared by the side panel, the popup and the
// settings page. The choice lives in chrome.storage.sync, so it follows the
// tenant to every browser they're signed into and every surface updates live.
//
// "system" deliberately REMOVES the attribute rather than writing a value, so
// the CSS falls through to prefers-color-scheme (see tokens.css).

/** @typedef {"light" | "dark" | "system"} ThemeMode */

/** Cycle order for the one-button toggle. Light first — it's the default. */
export const THEMES = /** @type {ThemeMode[]} */ (["light", "dark", "system"]);
export const DEFAULT_THEME = /** @type {ThemeMode} */ ("light");

export const THEME_LABELS = Object.freeze({ light: "Light", dark: "Dark", system: "System" });
export const THEME_GLYPHS = Object.freeze({ light: "☀", dark: "☾", system: "◑" });

/** @param {unknown} value @returns {ThemeMode} */
export function normalizeTheme(value) {
  return THEMES.includes(/** @type {ThemeMode} */ (value)) ? /** @type {ThemeMode} */ (value) : DEFAULT_THEME;
}

/** Next mode in the cycle, for the single-button toggle. @param {unknown} value */
export function nextTheme(value) {
  const i = THEMES.indexOf(normalizeTheme(value));
  return THEMES[(i + 1) % THEMES.length];
}

/** Tooltip that says both where you are and where a click takes you. @param {unknown} value */
export function themeTitle(value) {
  const now = normalizeTheme(value);
  return `Theme: ${THEME_LABELS[now]} — switch to ${THEME_LABELS[nextTheme(now)]}`;
}

// Stamp the choice on <html>. Takes the root so it can be unit-tested without a DOM.
/** @param {unknown} value @param {{ setAttribute: Function, removeAttribute: Function }} [root] */
export function applyTheme(value, root = document.documentElement) {
  const mode = normalizeTheme(value);
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  return mode;
}

/** Read the stored choice, apply it, and keep applying it when it changes elsewhere. */
export async function initTheme() {
  let mode = DEFAULT_THEME;
  try {
    const s = await chrome.storage.sync.get({ theme: DEFAULT_THEME });
    mode = applyTheme(s.theme);
  } catch { applyTheme(mode); }
  // One surface changing the theme repaints the others without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.theme) applyTheme(changes.theme.newValue);
  });
  return mode;
}

/** @param {unknown} value */
export async function setTheme(value) {
  const mode = applyTheme(value);
  try { await chrome.storage.sync.set({ theme: mode }); } catch { /* storage full or offline */ }
  return mode;
}

// A 3-way pill: Light · Dark · System. Returns the element; caller places it.
/** @param {{ mode: ThemeMode, compact?: boolean, onPick?: (m: ThemeMode) => void }} opts */
export function themeSwitch({ mode, compact = false, onPick }) {
  const wrap = document.createElement("div");
  wrap.className = "themeswitch";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Colour theme");
  let active = normalizeTheme(mode);

  const buttons = THEMES.map((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "themebtn";
    b.title = `${THEME_LABELS[m]} theme`;
    b.setAttribute("aria-label", `${THEME_LABELS[m]} theme`);
    b.setAttribute("aria-pressed", String(active === m));
    b.append(document.createTextNode(THEME_GLYPHS[m]));
    if (!compact) {
      const t = document.createElement("span");
      t.textContent = THEME_LABELS[m];
      b.append(t);
    }
    b.addEventListener("click", async () => {
      active = await setTheme(m);
      sync();
      onPick?.(active);
    });
    wrap.append(b);
    return { m, b };
  });

  function sync() {
    for (const { m, b } of buttons) b.setAttribute("aria-pressed", String(active === m));
  }

  // Another surface (or another window) changed it — reflect that here.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.theme) { active = normalizeTheme(changes.theme.newValue); sync(); }
  });

  return wrap;
}
