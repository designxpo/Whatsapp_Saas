/** Reveal plain text without changing the popover's measured height or its accessible description. */
export function typeTourDescription(element: HTMLElement, reducedMotion: boolean): () => void {
  const text = element.textContent ?? "";
  if (reducedMotion || !text) return () => {};
  const layout = document.createElement("span");
  layout.className = "talko-tour-text-layout";
  layout.setAttribute("aria-hidden", "true");
  layout.textContent = text;
  const accessible = document.createElement("span");
  accessible.className = "talko-tour-text-accessible";
  accessible.textContent = text;
  const visual = document.createElement("span");
  visual.className = "talko-tour-text-typed";
  visual.setAttribute("aria-hidden", "true");
  element.replaceChildren(layout, accessible, visual);
  element.classList.add("talko-tour-typing");
  // Code points keep emoji intact. Long descriptions finish within 1.8 seconds.
  const letters = Array.from(text);
  const duration = Math.min(1800, Math.max(450, letters.length * 12));
  let frame = 0;
  let started: number | undefined;
  const tick = (now: number) => {
    if (!element.isConnected) return;
    started ??= now + 160; // Let the popover's entrance settle first.
    const progress = Math.max(0, Math.min(1, (now - started) / duration));
    visual.textContent = letters.slice(0, Math.ceil(progress * letters.length)).join("");
    if (progress < 1) frame = requestAnimationFrame(tick);
    else element.classList.remove("talko-tour-typing");
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    element.classList.remove("talko-tour-typing");
    element.textContent = text;
  };
}
