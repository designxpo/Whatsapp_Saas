// Seamless infinite auto-scroll marquee (CSS-only, server-safe). Renders its
// children twice in one track; the -50% keyframe loops without a visible seam.
// Pauses on hover; edges fade out. Honors prefers-reduced-motion via globals.css.

export function Marquee({
  children, durationSec = 32, gapClass = "gap-x-14", className = "",
}: { children: React.ReactNode; durationSec?: number; gapClass?: string; className?: string }) {
  return (
    <div className={`group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] ${className}`}>
      <div
        className={`flex w-max animate-marquee items-center ${gapClass} group-hover:[animation-play-state:paused]`}
        style={{ animationDuration: `${durationSec}s` }}
      >
        <div className={`flex shrink-0 items-center ${gapClass}`}>{children}</div>
        <div className={`flex shrink-0 items-center ${gapClass}`} aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}
