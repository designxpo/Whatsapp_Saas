"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Check, Pause, Play } from "lucide-react";
import { CHARACTER_STORIES, type CharacterStoryId } from "../_content/character-stories";

/** One progressive-enhancement illustration: useful without animation or JS. */
export function CharacterStory({ scene = "team", compact = false, priority = false }: {
  scene?: CharacterStoryId; compact?: boolean; priority?: boolean;
}) {
  const story = CHARACTER_STORIES[scene];
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reduced, setReduced] = useState(true);
  const running = inView && pageVisible && !paused && !reduced;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    const visibility = () => setPageVisible(!document.hidden);
    update(); visibility();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); preference.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => { setActive(0); }, [scene]);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setActive(current => (current + 1) % story.steps.length), 3200);
    return () => window.clearInterval(timer);
  }, [running, story.steps.length]);

  return <figure ref={root} className={`character-story${compact ? " character-story-compact" : ""}`} data-running={running}>
    <div className="character-story-art">
      <Image src={`/marketing/stories/${story.image}.webp`} alt={story.alt} width={1200} height={630}
        sizes={compact ? "(min-width: 1024px) 480px, 100vw" : "(min-width: 1024px) 660px, 100vw"} priority={priority} />
      <div className="character-story-signal" aria-hidden="true"><Check size={12} /> {story.steps[active]}</div>
    </div>
    <figcaption className="character-story-copy">
      {!compact && <><p className="marketing-eyebrow">{story.eyebrow}</p><h3>{story.title}</h3></>}
      <ol className="character-story-steps" aria-label="Illustrative workflow">
        {story.steps.map((step, index) => <li key={step}>
          <button type="button" aria-pressed={active === index} onClick={() => { setActive(index); setPaused(true); }}>
            <span aria-hidden="true">{index + 1}</span>{step}
          </button>
        </li>)}
      </ol>
      <div className="character-story-controls">
        <span>Illustrative workflow</span>
        <button type="button" disabled={reduced} aria-label={paused ? "Play illustration animation" : "Pause illustration animation"}
          onClick={() => setPaused(value => !value)}>
          {paused || reduced ? <Play size={12} /> : <Pause size={12} />}
          {reduced ? "Motion off" : paused ? "Play" : "Pause"}
        </button>
      </div>
    </figcaption>
  </figure>;
}
