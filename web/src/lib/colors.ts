// Teams come from Linear dynamically; give each a stable, readable hue.
const HUES = [258, 195, 150, 330, 45, 85, 232, 20];

export function teamColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `oklch(0.62 0.14 ${HUES[h % HUES.length]})`;
}

// Linear label colors are hex; use them directly, falling back to muted.
export function labelColor(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "var(--muted-foreground)";
}
