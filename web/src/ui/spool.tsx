import { useEffect, useId, useRef, useState } from "react";

/** Farben mischen: Anteil t (0–1) von b in a */
export function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Helligkeit 0–1 (für Kontrast von Schrift auf Filamentfarbe) */
export const luma = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) || 0) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Zahl weich auf den Zielwert bewegen (beim ersten Anzeigen von 0 aus: die Spule „wickelt sich auf“) */
export function useTween(target: number, ms = 1100, delay = 0) {
  const [v, setV] = useState(() => (reducedMotion() ? target : 0));
  const from = useRef(v);
  useEffect(() => {
    if (reducedMotion()) return setV(target);
    let raf = 0;
    const start = performance.now() + delay;
    const a = from.current;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / ms));
      const e = 1 - Math.pow(1 - k, 3);
      const x = a + (target - a) * e;
      from.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, delay]);
  return v;
}

const HUB = 33;
const MAX = 87;

/**
 * Filamentrolle von vorn: getönter Kunststoff-Flansch mit Rippen, Wicklung in Filamentfarbe (Dicke = Restmenge),
 * Lichtreflex, Nabe. `spinning` dreht Rippen, Nabe und Fadenende wie beim Abwickeln.
 */
export function SpoolArt({
  color,
  fraction,
  spinning,
  empty,
  className = "",
  delay = 0,
  glow,
  wrapped,
}: {
  color: string;
  fraction: number;
  spinning?: boolean;
  empty?: boolean;
  className?: string;
  delay?: number;
  glow?: boolean;
  wrapped?: boolean; // noch eingeschweißt: liegt im Lager und wartet auf den ersten Einsatz
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const c = /^#[0-9a-f]{6}$/i.test(color) ? color : "#9a9a9a";
  const f = useTween(empty ? 0 : Math.min(1, Math.max(0, fraction)), 1200, delay);
  const rOut = HUB + (MAX - HUB) * f;
  const has = rOut > HUB + 0.6;
  const rings: number[] = [];
  for (let r = HUB + 2.2; r < rOut - 0.8; r += 2.3) rings.push(r);
  const k = HUB / Math.max(rOut, HUB + 1);

  return (
    <svg viewBox="0 0 200 200" className={`block overflow-visible ${className}`} aria-hidden>
      <defs>
        <radialGradient id={`f${id}`} cx="100" cy="100" r={Math.max(rOut, HUB + 1)} gradientUnits="userSpaceOnUse">
          <stop offset={k} stopColor={mix(c, "#000000", 0.55)} />
          <stop offset={k + (1 - k) * 0.12} stopColor={mix(c, "#000000", 0.12)} />
          <stop offset={k + (1 - k) * 0.7} stopColor={c} />
          <stop offset={k + (1 - k) * 0.93} stopColor={mix(c, "#ffffff", 0.22)} />
          <stop offset="1" stopColor={mix(c, "#000000", 0.35)} />
        </radialGradient>
        <linearGradient id={`s${id}`} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="0.38" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="0.62" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.32" />
        </linearGradient>
        <radialGradient id={`h${id}`} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#5b6067" />
          <stop offset="1" stopColor="#24262a" />
        </radialGradient>
        <radialGradient id={`g${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.55" stopColor={c} stopOpacity="0.55" />
          <stop offset="1" stopColor={c} stopOpacity="0" />
        </radialGradient>
      </defs>

      {glow && <circle cx="100" cy="100" r="112" fill={`url(#g${id})`} className="spool-glow" />}

      {/* Rückwand des Flanschs */}
      <circle cx="100" cy="100" r="95" fill="#17191c" opacity="0.92" />
      <circle cx="100" cy="100" r="95" fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" />

      {/* Wicklung */}
      {has && (
        <>
          <circle cx="100" cy="100" r={(rOut + HUB) / 2} fill="none" stroke={`url(#f${id})`} strokeWidth={rOut - HUB} />
          {rings.map((r, i) => (
            <circle key={r} cx="100" cy="100" r={r} fill="none" stroke={i % 2 ? "#ffffff" : "#000000"} strokeOpacity={i % 2 ? 0.07 : 0.13} strokeWidth="0.7" />
          ))}
          <circle cx="100" cy="100" r={rOut} fill="none" stroke={mix(c, "#000000", 0.45)} strokeWidth="1.2" />
          <circle cx="100" cy="100" r={rOut} fill={`url(#s${id})`} />
        </>
      )}

      {/* Drehende Teile: Rippen, Fadenende, Nabenkerben */}
      <g className={spinning ? "spool-spin" : undefined}>
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <g key={a} transform={`rotate(${a} 100 100)`}>
            <rect x="98.2" y="8" width="3.6" height="58" rx="1.8" fill="#0d0e10" opacity="0.28" />
            <rect x="101.8" y="8" width="0.9" height="58" fill="#ffffff" opacity="0.1" />
          </g>
        ))}
        {has && f > 0.04 && (
          <path d={`M 100 ${100 - rOut + 0.6} q 9 -1.5 15 2.5`} fill="none" stroke={mix(c, "#000000", 0.2)} strokeWidth="2.2" strokeLinecap="round" />
        )}
        <circle cx="100" cy="100" r={HUB} fill={`url(#h${id})`} />
        <circle cx="100" cy="100" r={HUB - 0.6} fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1" />
        {[0, 90, 180, 270].map((a) => (
          <rect key={a} x="97" y={100 - HUB + 4} width="6" height="7" rx="1.5" fill="#0c0d0f" opacity="0.65" transform={`rotate(${a} 100 100)`} />
        ))}
        <circle cx="100" cy="100" r="17" fill="#0a0b0c" />
        <circle cx="100" cy="100" r="17" fill="none" stroke="#000000" strokeOpacity="0.6" strokeWidth="3" />
        <circle cx="100" cy="100" r="18.5" fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="1" />
      </g>

      {/* Vorderer Rand des Flanschs */}
      <circle cx="100" cy="100" r="93.5" fill="none" stroke="#2b2e33" strokeWidth="5" />
      <circle cx="100" cy="100" r="95.6" fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="0.9" />
      <path d="M 38 40 A 86 86 0 0 1 128 18" fill="none" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="2.2" strokeLinecap="round" />

      {/* Vakuumbeutel: Folie liegt in den Ecken außerhalb der Spule (milchig, mit Falten), über der Wicklung nur dünne
          Glanzlinien, damit die Farbe stimmt. Gequetschte Schweißnähte oben und unten, Kontur hell und dunkel für beide Modi */}
      {wrapped && (
        <g>
          <mask id={`m${id}`}>
            <rect x="-20" y="-20" width="240" height="240" fill="#ffffff" />
            <circle cx="100" cy="100" r="96.5" fill="#000000" />
          </mask>
          <pattern id={`p${id}`} width="4" height="10" patternUnits="userSpaceOnUse">
            <rect width="2" height="10" fill="#000000" fillOpacity="0.22" />
          </pattern>
          <rect x="-6" y="-4" width="212" height="208" rx="26" fill="#eef3f7" fillOpacity="0.62" mask={`url(#m${id})`} />
          <g mask={`url(#m${id})`} fill="none" stroke="#7c8790" strokeOpacity="0.55" strokeWidth="1.1" strokeLinecap="round">
            <path d="M -2 22 L 18 6 M 4 38 L 30 2 M 182 2 L 204 26 M 168 0 L 202 40" />
            <path d="M -2 176 L 22 200 M 2 158 L 40 202 M 202 172 L 180 200 M 204 154 L 162 204" />
          </g>
          <rect x="-6" y="-4" width="212" height="208" rx="26" fill="none" stroke="#000000" strokeOpacity="0.28" strokeWidth="3.4" />
          <rect x="-6" y="-4" width="212" height="208" rx="26" fill="none" stroke="#ffffff" strokeOpacity="0.95" strokeWidth="1.6" />
          {[-14, 194].map((y) => (
            <g key={y}>
              <rect x="-6" y={y} width="212" height="14" rx="3" fill="#f4f7fa" fillOpacity="0.92" stroke="#000000" strokeOpacity="0.25" strokeWidth="1" />
              <rect x="0" y={y + 3} width="200" height="8" fill={`url(#p${id})`} />
            </g>
          ))}
          <path d="M 34 52 A 78 78 0 0 1 64 24" fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="3" strokeLinecap="round" />
          <path d="M 28 72 A 80 80 0 0 1 32 60" fill="none" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="3" strokeLinecap="round" />
          <path d="M 150 176 A 82 82 0 0 0 176 148" fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" />
          <path d="M 60 150 L 150 60" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

export const pct = (s: { remaining_g: number; net_g: number }) => (s.net_g > 0 ? s.remaining_g / s.net_g : 0);

export const fmtG = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(2).replace(".", ",")} kg` : `${Math.round(g)} g`);

/** Anzeigename: Farbname, sonst Sorte, sonst Material */
export const spoolTitle = (s: { color_name: string; name: string; material: string }) => s.color_name || s.name || s.material;
/** Sorte als kurzes Schild auf der Spule: „PLA Meta“ → „Meta“, „PLA+“ bleibt, ohne Sorte nichts */
export const sorteTag = (s: { material: string; name: string }) => {
  const n = s.name.trim();
  const m = s.material.trim();
  return n.toLowerCase().startsWith(m.toLowerCase() + " ") ? n.slice(m.length).trim() : n;
};
export const spoolSub = (s: { brand: string; material: string; name: string; color_name: string }) =>
  [s.brand, s.color_name && s.name ? s.name : s.color_name || s.name ? s.material : ""].filter(Boolean).join(" · ") || s.material;

/** Rest schätzen bei angebrochenen Spulen ohne Chip: setzt den Rest auf einen Anteil vom Netto */
export function RestChips({ net, onPick }: { net: number; onPick: (rest: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink3">Rest schätzen:</span>
      {(
        [
          [1, "voll"],
          [0.75, "¾"],
          [0.5, "½"],
          [0.25, "¼"],
        ] as const
      ).map(([f, l]) => (
        <button key={l} type="button" onClick={() => onPick(Math.round(net * f))} className="h-7 min-w-9 rounded-full bg-fill px-2.5 text-xs font-bold text-ink2 hover:bg-hover">
          {l}
        </button>
      ))}
    </div>
  );
}

/**
 * Füllbalken in Filamentfarbe. Die Kontur in Schriftfarbe hält helle Farben (Weiß, Natur) im hellen und Schwarz im
 * dunklen Modus sichtbar, ohne die Farbe selbst zu verfälschen.
 */
export function FillBar({ fraction, color, low, className = "" }: { fraction: number; color: string; low?: boolean; className?: string }) {
  return (
    <span className={`relative block h-1.5 overflow-hidden rounded-full bg-fill2 ${className}`}>
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${Math.max(2, Math.min(1, fraction) * 100)}%`,
          background: low ? "var(--c-red)" : color,
          boxShadow: low ? undefined : "inset 0 0 0 1px color-mix(in srgb, var(--c-ink) 30%, transparent)",
        }}
      />
    </span>
  );
}
