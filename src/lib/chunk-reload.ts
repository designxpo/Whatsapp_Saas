// After a deploy, a portal tab that was already open still asks for the
// previous build's code files when it opens a screen for the first time. Those
// files are gone, the import fails, and React shows a blank "Application
// error". The fix a person would make is a reload, so do it once for them.
// A guard stops a loop: no second automatic reload within a minute.

const KEY = "talko-chunk-reload-at";

/** Is this the "code file from an older deploy" failure? Pure. */
export function isChunkLoadError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ""} ${e?.message ?? String(err ?? "")}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text);
}

/** Reload once to pick up the new deploy. False when it already tried a moment ago. */
export function reloadForNewDeploy(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch { /* storage blocked: reload anyway, the browser stops a tight loop itself */ }
  window.location.reload();
  return true;
}
