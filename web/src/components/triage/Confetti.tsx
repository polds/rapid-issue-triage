import { useCallback, useEffect, useState } from "react";

const TONES = ["bg-chart-1", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-primary"];

type Piece = { left: number; dx: number; rot: number; duration: number; delay: number };

// Rolled once per burst, never during render: `Math.random()` in a render body
// reshuffles every particle on any unrelated re-render, which would restart the
// fall mid-animation.
function rollPieces(): Piece[] {
  return Array.from({ length: 60 }, () => ({
    left: 50 + (Math.random() * 40 - 20),
    dx: Math.random() * 520 - 260,
    rot: Math.random() * 900 - 450,
    duration: 0.9 + Math.random() * 0.7,
    delay: Math.random() * 0.2,
  }));
}

export function Confetti({ trigger }: { trigger: number }) {
  // `trigger` already carries the count to celebrate, so what to show is derived
  // from it rather than copied into state by an effect. State records only which
  // trigger the timeout has dismissed — the one update an external system drives.
  const [dismissed, setDismissed] = useState(0);
  const done = useCallback(() => setDismissed(trigger), [trigger]);

  if (!trigger || trigger === dismissed) return null;
  // Keyed by trigger, so each milestone mounts a fresh Burst with its own roll.
  return <Burst key={trigger} count={trigger} onDone={done} />;
}

function Burst({ count, onDone }: { count: number; onDone: () => void }) {
  // A lazy initialiser keeps the roll out of the render body while still giving
  // every burst its own particles — the remount does what setBurst used to.
  const [pieces] = useState(rollPieces);

  useEffect(() => {
    const t = setTimeout(onDone, 1500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <div className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-full border border-primary/30 bg-surface px-4 py-2 text-sm shadow-pop anim-pop-in">
        <span className="font-display font-bold">{count}</span>&nbsp;triaged this session
      </div>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`absolute top-1/3 size-2 rounded-[2px] ${TONES[i % TONES.length]}`}
          style={{
            left: `${p.left}%`,
            ["--dx" as string]: `${p.dx}px`,
            ["--rot" as string]: `${p.rot}deg`,
            animation: `confetti-fall ${p.duration}s cubic-bezier(0.2,0.7,0.3,1) forwards`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
