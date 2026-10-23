// Runs once when a server instance starts (Next.js instrumentation hook).
//
// Installs the Meta usage observer (metausage.ts): every Meta response's
// rate-limit header is read as it passes, so the app's application-level
// usage is known without spending a call on it. Meta calls are made from a
// dozen files with fetch and extFetch alike, so watching here is the only
// version that also covers the call site somebody adds next month.
//
// The import sits INSIDE the runtime check on purpose: that is what lets the
// edge build drop it. An early return instead pulls the database client into
// the middleware bundle for code the edge never runs.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installMetaObserver } = await import("./lib/metausage");
    installMetaObserver();
  }
}
