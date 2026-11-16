// Füllung wählen wie auf einem Musterwürfel: Draufsicht auf eine Schicht, Wände in Filamentfarbe, darin das Füllmuster.
// Der Abstand der Linien folgt der Dichte (10 % ≈ zehnfache Linienbreite), beim Ziehen gleitet das Muster mit.
import { useId } from "react";
import { luma, mix, useTween } from "./spool.tsx";

export type InfillPattern = "grid" | "gyroid" | "honeycomb" | "cubic" | "triangles" | "lightning" | "zig-zag";

export const PATTERNS: { id: InfillPattern; label: string; hint: string }[] = [
  { id: "grid", label: "Gitter", hint: "Schnell und solide, Standard der Bambu-Profile" },
  { id: "gyroid", label: "Gyroid", hint: "Gleich fest in alle Richtungen, leise, gut für flexible Teile" },
  { id: "honeycomb", label: "Wabe", hint: "Sehr steif, braucht aber deutlich länger" },
  { id: "cubic", label: "Kubisch", hint: "3D-Gitter, fest bei wenig Material" },
  { id: "triangles", label: "Dreiecke", hint: "Steif in der Ebene, gut für flache Teile" },
  { id: "lightning", label: "Blitz", hint: "Stützt nur die Deckflächen: am schnellsten, für Deko (Dichte zählt kaum)" },
  { id: "zig-zag", label: "Linien", hint: "Wenig Material, je Schicht quer, eher schwach" },
];

/** Grobe Einordnung der Dichte; die Wände tragen bei den meisten Teilen mehr als die Füllung */
export const infillNote = (d: number) =>
  d === 0
    ? "Hohl: nur Wände, Boden und Deckel"
    : d < 10
      ? "Deko und Figuren, Deckel braucht genug Schichten"
      : d < 20
        ? "Standard für die meisten Teile"
        : d < 35
          ? "Funktionsteile, Halter, Gewinde"
          : d < 60
            ? "Stark belastete Teile; ab hier wächst vor allem Gewicht und Zeit"
            : d < 100
              ? "Fast massiv, kaum fester als 50 %, aber deutlich schwerer"
              : "Massiv";

const IN = { a: 13, b: 107 }; // Innenraum der Draufsicht (viewBox 0..120)
const LW = 1.7; // Linienbreite im Bild

/** Linien eines Musters bei Dichte d (0..1) im Innenraum */
function patternPath(p: InfillPattern, d: number): string {
  if (d <= 0.001) return "";
  const { a, b } = IN;
  const span = b - a;
  const out: string[] = [];
  const lines = (angle: number, gap: number, phase = 0) => {
    const r = (angle * Math.PI) / 180;
    const [cx, cy] = [60, 60];
    const ux = Math.cos(r), uy = Math.sin(r);
    const nx = -uy, ny = ux;
    const reach = span;
    for (let o = -reach + (phase % gap); o <= reach; o += gap) {
      out.push(`M${(cx + nx * o - ux * reach).toFixed(2)} ${(cy + ny * o - uy * reach).toFixed(2)}L${(cx + nx * o + ux * reach).toFixed(2)} ${(cy + ny * o + uy * reach).toFixed(2)}`);
    }
  };
  // Abstand so, dass die Fläche aus Linien ≈ Dichte ist (n Richtungen teilen sich die Dichte)
  const gap = (n: number) => Math.min(span * 2, (LW * n) / d);
  switch (p) {
    case "grid":
      lines(45, gap(2));
      lines(-45, gap(2));
      break;
    case "zig-zag":
      lines(45, gap(1));
      break;
    case "triangles":
    case "cubic":
      lines(0, gap(3), p === "cubic" ? gap(3) / 3 : 0);
      lines(60, gap(3));
      lines(120, gap(3), p === "cubic" ? -gap(3) / 3 : 0);
      break;
    case "gyroid": {
      const g = gap(1.15);
      for (let y = a - g; y <= b + g; y += g) {
        let dPath = `M${a - 2} ${y.toFixed(2)}`;
        for (let x = a - 2; x <= b + 2; x += 2) dPath += `L${x.toFixed(2)} ${(y + Math.sin(((x - a) / g) * Math.PI) * g * 0.32).toFixed(2)}`;
        out.push(dPath);
      }
      break;
    }
    case "honeycomb": {
      const s = Math.min(span, (LW * 1.6) / d); // Seitenlänge
      const h = Math.sqrt(3) * s;
      for (let row = -1, y = a - h; y <= b + h; row++, y += h / 2) {
        for (let x = a - 3 * s + (row % 2 ? 1.5 * s : 0); x <= b + 3 * s; x += 3 * s) {
          out.push(`M${(x - s).toFixed(2)} ${y.toFixed(2)}L${(x - s / 2).toFixed(2)} ${(y - h / 2).toFixed(2)}L${(x + s / 2).toFixed(2)} ${(y - h / 2).toFixed(2)}L${(x + s).toFixed(2)} ${y.toFixed(2)}`);
        }
      }
      break;
    }
    case "lightning": {
      // Äste von den Wänden zu den Deckflächen, Dichte ändert wenig
      const t = 0.6 + d * 0.4;
      out.push(
        `M${a} 92L38 80L52 ${84 - 6 * t}L66 74`,
        `M38 80L34 ${62 - 4 * t}`,
        `M${b} 30L88 40L76 ${38 + 6 * t}L64 50`,
        `M88 40L92 ${58 + 4 * t}`,
        `M60 ${a}L58 30L48 ${40 + 4 * t}`,
      );
      break;
    }
  }
  return out.join("");
}

/** Draufsicht auf eine Schicht mit Wänden und Füllmuster */
export function InfillFigure({ pattern, density, color, className = "" }: { pattern: InfillPattern; density: number; color: string; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const d = useTween(density, 450);
  const solid = d >= 99.5;
  // Sehr dunkles Filament etwas aufhellen, sonst verschwinden die Linien im dunklen Modus
  const hex = /^#[0-9a-f]{6}$/i.test(color);
  const c = hex ? (luma(color) < 0.12 ? mix(color, "#9a9a9a", 0.45) : color) : color.startsWith("var(") ? color : "var(--c-accent)";
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label={`Füllung ${Math.round(density)} %`}>
      <defs>
        <clipPath id={`in${id}`}>
          <rect x={IN.a} y={IN.a} width={IN.b - IN.a} height={IN.b - IN.a} />
        </clipPath>
        <linearGradient id={`sh${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      {/* Boden durch die Lücken sichtbar: dunkler Ton der Farbe */}
      <rect x={IN.a} y={IN.a} width={IN.b - IN.a} height={IN.b - IN.a} fill={c} opacity="0.22" />
      {solid ? (
        <rect x={IN.a} y={IN.a} width={IN.b - IN.a} height={IN.b - IN.a} fill={c} />
      ) : (
        <path d={patternPath(pattern, d / 100)} clipPath={`url(#in${id})`} fill="none" stroke={c} strokeWidth={LW} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {/* zwei Wandlinien */}
      <rect x="6" y="6" width="108" height="108" rx="5" fill="none" stroke={c} strokeWidth="7" />
      <rect x="9.5" y="9.5" width="101" height="101" rx="3" fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="0.5" />
      <rect x="2.5" y="2.5" width="115" height="115" rx="7" fill="none" stroke="#000" strokeOpacity="0.2" strokeWidth="0.6" />
      <rect x="2.5" y="2.5" width="115" height="115" rx="7" fill={`url(#sh${id})`} pointerEvents="none" />
    </svg>
  );
}

/** Dichte per Schieberegler, Muster als Kacheln mit kleiner Vorschau */
export function InfillPicker({
  density,
  pattern,
  profilePattern,
  color,
  onDensity,
  onPattern,
}: {
  density: number;
  pattern: InfillPattern;
  profilePattern: string;
  color: string;
  onDensity: (d: number) => void;
  onPattern: (p: InfillPattern) => void;
}) {
  const hint = PATTERNS.find((p) => p.id === pattern)?.hint ?? "";
  return (
    <div className="rounded-xl bg-card p-3 shadow-card">
      <div className="flex gap-3.5">
        <InfillFigure pattern={pattern} density={density} color={color} className="size-28 shrink-0 sm:size-32" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-extrabold tracking-tight tnum">{density} %</span>
            <span className="truncate text-xs font-semibold text-ink3">{PATTERNS.find((p) => p.id === pattern)?.label}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={density}
            onChange={(e) => onDensity(Number(e.target.value))}
            className="mt-1.5 w-full accent-[var(--c-accent)]"
            aria-label="Fülldichte"
          />
          <div className="relative mx-2 h-3.5 text-[10px] font-semibold text-ink4 tnum">
            {[0, 15, 50, 100].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onDensity(v)}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap hover:text-ink2"
                style={{ left: `${v}%` }}
              >
                {v} %
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs leading-snug text-ink2">{infillNote(density)}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {PATTERNS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPattern(p.id)}
            title={p.hint}
            aria-pressed={p.id === pattern}
            className={`flex flex-col items-center gap-1 rounded-lg p-1.5 text-[11px] font-semibold ${p.id === pattern ? "bg-ink text-bg" : "bg-fill text-ink2 hover:bg-hover"}`}
          >
            <InfillFigure pattern={p.id} density={p.id === "lightning" ? 15 : 20} color={p.id === pattern ? "var(--c-bg)" : "var(--c-ink2)"} className="size-8" />
            <span className="max-w-full truncate">
              {p.label}
              {p.id === profilePattern && <span className="opacity-60">*</span>}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink3">
        {hint}
        {profilePattern && " · * = Standard des Profils"}
      </p>
    </div>
  );
}
