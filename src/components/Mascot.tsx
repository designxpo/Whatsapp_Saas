// Talko — the portal's mascot.
//
// Original artwork, deliberately. The obvious route was Bible Strong Avatar
// Lab, which is excellent and is AGPL-3.0: its §13 network clause reaches a
// hosted SaaS, so shipping it inside a closed-source product invites an
// obligation to publish this app's source. Not a risk worth a decoration.
//
// So: ~70 lines of SVG, no dependency, nothing to keep updated, and it echoes
// the logo rather than a generic blob — the blue speech bubble with a face in
// it, which is already the brand's own mascot.
//
// Motion needs no guard here: globals.css collapses every animation under
// prefers-reduced-motion, and the mood still reads from eye shape alone when
// it does.

export type Mood =
  | "idle"       // default — blinks, breathes
  | "thinking"   // working on something
  | "happy"      // a thing succeeded
  | "sleeping"   // nothing here yet
  | "searching"  // looking for results
  | "oops";      // something failed

const EYE = "#0a1a2f";

/** Eye shapes carry the mood. Colour and motion only reinforce it. */
function Eyes({ mood }: { mood: Mood }) {
  if (mood === "sleeping" || mood === "happy") {
    // Closed-curve eyes: a downward arc reads asleep, an upward one reads
    // pleased. Same primitive, opposite sweep.
    const sweep = mood === "happy" ? 1 : 0;
    return (
      <g stroke={EYE} strokeWidth="3.4" strokeLinecap="round" fill="none">
        <path d={`M19 ${mood === "happy" ? 33 : 31} a 6 4.5 0 0 ${sweep} 10 0`} />
        <path d={`M35 ${mood === "happy" ? 33 : 31} a 6 4.5 0 0 ${sweep} 10 0`} />
      </g>
    );
  }
  if (mood === "oops") {
    // Mismatched eyes read as "that didn't work" without a frown.
    return (
      <g fill={EYE}>
        <rect x="20" y="26" width="7" height="7" rx="3.5" />
        <rect x="37" y="28" width="7" height="4.5" rx="2.2" />
      </g>
    );
  }
  const cls =
    mood === "thinking" ? "animate-talko-glance"
    : mood === "searching" ? "animate-talko-scan"
    : "animate-talko-blink";
  return (
    <g fill={EYE} className={cls} style={{ transformOrigin: "32px 30px" }}>
      <rect x="20" y="25" width="7" height="10" rx="3.5" />
      <rect x="37" y="25" width="7" height="10" rx="3.5" />
    </g>
  );
}

export function Mascot({
  mood = "idle", size = 72, className = "", label,
}: { mood?: Mood; size?: number; className?: string; label?: string }) {
  // Decorative beside a heading that already says the same thing; labelled
  // only when a caller gives it something of its own to announce.
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={`${className} animate-talko-float`} {...a11y}>
      <defs>
        <linearGradient id="talko-skin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0783fd" />
          <stop offset="55%" stopColor="#4f6bff" />
          <stop offset="100%" stopColor="#8a5cff" />
        </linearGradient>
      </defs>

      {/* Ground shadow — anchors the float so it reads as hovering, not
          drifting. Sits at 61, clear of the bubble's tail (which ends at ~57):
          at 58 the two overlapped and both went muddy. */}
      <ellipse cx="32" cy="61" rx="12" ry="2.3" fill="#0a1a2f" opacity="0.10" className="animate-talko-shadow" />

      {/* Antenna: the one asymmetric detail, so it doesn't read as a plain pill. */}
      <line x1="32" y1="9" x2="32" y2="5" stroke="#4f6bff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="32" cy="4" r="2.6" fill="#8a5cff" className="animate-talko-pulse" />

      {/* The speech bubble from the logo, with its tail. */}
      <path
        d="M14 10 h36 a10 10 0 0 1 10 10 v20 a10 10 0 0 1 -10 10 h-22 l-10 7 v-7 h-4 a10 10 0 0 1 -10 -10 v-20 a10 10 0 0 1 10 -10 z"
        fill="url(#talko-skin)"
      />
      {/* Face plate — the white robot face inside the bubble. */}
      <rect x="13" y="19" width="38" height="22" rx="10" fill="#ffffff" opacity="0.94" />
      <Eyes mood={mood} />
    </svg>
  );
}
