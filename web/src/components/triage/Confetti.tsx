import { useEffect, useState } from "react";

const TONES = ["bg-chart-1", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-primary"];

export function Confetti({ trigger }: { trigger: number }) {
  // `trigger` already carries the count to celebrate, so visibility is derived
  // from it rather than mirrored into state. State only records which trigger
  // the timer has already dismissed — the one update an external system (the
  // timeout) genuinely drives.
  const [dismissed, setDismissed] = useState(0);
  const burst = trigger === dismissed ? 0 : trigger;

  useEffect(() => {
    if (!burst) return;
    const t = setTimeout(() => setDismissed(burst), 1500);
    return () => clearTimeout(t);
  }, [burst]);

  if (!burst) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-full border border-primary/30 bg-surface px-4 py-2 text-sm shadow-pop anim-pop-in">
        <span className="font-display font-bold">{burst}</span>&nbsp;triaged this session
      </div>
      {Array.from({ length: 60 }).map((_, i) => (
        <span
          key={i}
          className={`absolute top-1/3 size-2 rounded-[2px] ${TONES[i % TONES.length]}`}
          style={{
            left: `${50 + (Math.random() * 40 - 20)}%`,
            ["--dx" as string]: `${Math.random() * 520 - 260}px`,
            ["--rot" as string]: `${Math.random() * 900 - 450}deg`,
            animation: `confetti-fall ${0.9 + Math.random() * 0.7}s cubic-bezier(0.2,0.7,0.3,1) forwards`,
            animationDelay: `${Math.random() * 0.2}s`,
          }}
        />
      ))}
    </div>
  );
}
