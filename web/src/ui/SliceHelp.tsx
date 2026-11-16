// Hilfen im Slice-Dialog: Zweck als Einstieg, Düse, Schichthöhe, Wände und Stützen je mit kleiner Zeichnung und einem Satz,
// was die Wahl bewirkt. Zeichnungen in Filamentfarbe, Übergänge per useTween (ruhig bei prefers-reduced-motion).
import { AlertTriangle, Gauge, Sparkles, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { luma, mix, useTween } from "./spool.tsx";

/** Sehr dunkle Farben aufhellen, sonst verschwinden die Linien im dunklen Modus */
const ink = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? (luma(c) < 0.12 ? mix(c, "#9a9a9a", 0.45) : c) : c || "var(--c-accent)");

function Card({ figure, children }: { figure: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3.5 rounded-xl bg-card p-3 shadow-card">
      <div className="size-24 shrink-0 sm:size-28">{figure}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const Warn = ({ children }: { children: ReactNode }) => (
  <p className="mt-2 flex gap-1.5 text-xs leading-snug text-warn">
    <AlertTriangle size={13} className="mt-px shrink-0" />
    <span>{children}</span>
  </p>
);

// ---------- Zweck ----------

export type Purpose = "funktion" | "sicht" | "schnell";
type Proc = { name: string; layer: number | null; walls: number | null; infill: number | null; pattern: string };
export type PurposeSet = { process: string; walls: number; infill: number; pattern: string };

export const PURPOSES: { id: Purpose; label: string; hint: string; icon: typeof Wrench }[] = [
  { id: "funktion", label: "Funktionsteil", hint: "Halter, Organizer, Teile unter Last: 4 Wände, 25 % Gyroid", icon: Wrench },
  { id: "sicht", label: "Sichtteil", hint: "Figuren, Deko, glatte Flächen: feine Schichten, langsame Außenwand", icon: Sparkles },
  { id: "schnell", label: "Schnell", hint: "Probedruck, Rohbauteil: dicke Schichten, wenig Füllung", icon: Gauge },
];

/** Einstellungen je Zweck aus den Profilen der Düse: Schichthöhe relativ zum Düsendurchmesser */
export function purposeSet(p: Purpose, procs: Proc[], nozzle: number, def: string): PurposeSet | null {
  const ok = procs.filter((x) => x.layer && x.layer <= nozzle * 0.75 + 1e-6);
  if (!ok.length) return null;
  const near = (target: number, hq: boolean) =>
    [...ok].sort((a, b) => Math.abs(a.layer! - target) - Math.abs(b.layer! - target) || +/High Quality/i.test(hq ? b.name : a.name) - +/High Quality/i.test(hq ? a.name : b.name))[0]!;
  const base = procs.find((x) => x.name === def);
  if (p === "funktion") {
    const pr = base && base.layer && Math.abs(base.layer - nozzle / 2) < 0.03 ? base : near(nozzle / 2, false);
    return { process: pr.name, walls: 4, infill: 25, pattern: "gyroid" };
  }
  if (p === "sicht") {
    const pr = near(nozzle * 0.3, true);
    return { process: pr.name, walls: Math.max(3, pr.walls ?? 2), infill: 15, pattern: pr.pattern || "gyroid" };
  }
  const pr = [...ok].sort((a, b) => b.layer! - a.layer! || +/High Quality/i.test(a.name) - +/High Quality/i.test(b.name))[0]!;
  return { process: pr.name, walls: 2, infill: 10, pattern: "grid" };
}

export function PurposePicker({ active, standard, onPick }: { active: Purpose | null; standard: boolean; onPick: (p: Purpose) => void }) {
  const hint = PURPOSES.find((p) => p.id === active)?.hint;
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {PURPOSES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            aria-pressed={p.id === active}
            className={`flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-xs font-bold transition-colors ${p.id === active ? "bg-ink text-bg" : "bg-card shadow-seg hover:bg-hover"}`}
          >
            <p.icon size={18} strokeWidth={1.8} className={p.id === active ? "" : "text-accent"} />
            {p.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-ink3">{hint ?? `${standard ? "Standard des Druckers." : "Eigene Einstellungen."} Ein Zweck stellt Qualität, Wände und Füllung passend ein, danach ist alles frei änderbar.`}</p>
    </div>
  );
}

// ---------- Düse ----------

const NOZZLE_NOTE: Record<string, string> = {
  "0.2": "Sehr feine Details und Miniaturen, dafür langsam; verstopft leichter",
  "0.4": "Allrounder: guter Kompromiss aus Detail und Tempo, Standard",
  "0.6": "Schneller und stabilere Wände, Optik etwas gröber",
  "0.8": "Große Funktionsteile, sehr schnell, grobe Oberfläche",
};

/** Düse von der Seite: Öffnung und gelegte Bahn wachsen mit dem Durchmesser */
function NozzleFigure({ d, color }: { d: number; color: string }) {
  const v = useTween(d, 450) || d;
  const w = v * 38; // Öffnung in px
  const c = ink(color);
  return (
    <svg viewBox="0 0 120 120" className="size-full" aria-hidden>
      {/* Heizblock und Düse */}
      <rect x="30" y="8" width="60" height="26" rx="4" fill="var(--c-ink3)" opacity="0.55" />
      <path d={`M42 34H78L${60 + w / 2 + 3} 70H${60 - w / 2 - 3}Z`} fill="#c9a24a" />
      <path d={`M42 34H50L${60 - w / 2} 70H${60 - w / 2 - 3}Z`} fill="#fff" opacity="0.25" />
      {/* Schmelze in der Öffnung */}
      <rect x={60 - w / 2} y="66" width={w} height="8" fill={c} />
      {/* gelegte Bahn: etwas breiter als die Düse, flach gedrückt */}
      <ellipse cx="60" cy={88 - v * 6} rx={w * 0.58 + 2} ry={v * 9 + 1.5} fill={c} />
      <rect x="10" y="90" width="100" height="6" rx="2" fill="var(--c-ink3)" opacity="0.5" />
      <text x="60" y="112" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--c-ink2)">
        {`Ø ${d.toFixed(1).replace(".", ",")} mm`}
      </text>
    </svg>
  );
}

export function NozzlePicker({
  nozzles,
  value,
  installed,
  abrasive,
  color,
  onPick,
}: {
  nozzles: string[];
  value: string;
  installed: { diameter: string | null; type: string | null; highFlow: boolean } | null;
  /** Material im gewählten Fach mit Fasern (CF/GF) */
  abrasive: string | null;
  color: string;
  onPick: (n: string) => void;
}) {
  const inst = installed?.diameter ? Number(installed.diameter).toFixed(1) : null;
  const hard = !!installed?.type && /gehärtet|wolfram/i.test(installed.type);
  return (
    <Card figure={<NozzleFigure d={Number(value)} color={color} />}>
      <div className="flex flex-wrap gap-1.5">
        {nozzles.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPick(n)}
            className={`relative h-8 rounded-lg px-2.5 text-sm font-semibold tnum ${n === value ? "bg-ink text-bg" : "bg-fill text-ink2 hover:bg-hover"}`}
          >
            {n.replace(".", ",")}
            {n === inst && <span className="absolute -top-1 -right-1 size-2.5 rounded-full border-2 border-[var(--c-card)] bg-good" title="eingebaut" />}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-snug text-ink2">{NOZZLE_NOTE[value] ?? ""}</p>
      {installed && inst && (
        <p className="mt-1 text-[11px] text-ink3">
          <span className="mr-1 inline-block size-2 rounded-full bg-good" /> Eingebaut: {inst.replace(".", ",")} mm{installed.type ? `, ${installed.type}` : ""}
          {installed.highFlow ? " (High Flow: mehr Durchsatz, schneller)" : ""}
        </p>
      )}
      {inst && inst !== value && (
        <Warn>
          Im Drucker steckt die {inst.replace(".", ",")}-mm-Düse. Geslict für {value.replace(".", ",")} mm stimmen Fluss und Linienbreite nicht: erst die Düse
          wechseln und am Drucker einstellen.
        </Warn>
      )}
      {abrasive && installed?.type && !hard && (
        <Warn>{abrasive} enthält Fasern und schleift eine Edelstahldüse in wenigen Drucken aus. Dafür eine gehärtete Düse nehmen.</Warn>
      )}
    </Card>
  );
}

// ---------- Schichthöhe ----------

const layerNote = (h: number) =>
  h <= 0.1
    ? "Sehr fein: Rillen kaum sichtbar, für Figuren und Miniaturen; dauert etwa doppelt so lange"
    : h <= 0.14
      ? "Fein: glatte Rundungen für Sichtteile"
      : h <= 0.18
        ? "Ausgewogen, etwas feiner als Standard"
        : h <= 0.22
          ? "Standard: gut für Funktionsteile, Halter, Organizer"
          : "Grob und schnell: sichtbare Stufen, für Probedrucke und Rohbauteile";

/** Schnitt durch eine abgerundete Kante: je dicker die Schicht, desto gröber die Treppe an der Rundung */
function LayerFigure({ layer, color }: { layer: number; color: string }) {
  const h = Math.max(0.06, useTween(layer, 500) || layer);
  const px = h * 34; // Schichthöhe im Bild
  const c = ink(color);
  const [bottom, top, left, r] = [100, 30, 14, 52];
  const rows: { y: number; w: number }[] = [];
  for (let y = bottom; y - px >= top - 0.01; y -= px) {
    const mid = y - px / 2;
    // Profil: gerade bis zur Rundung, dann Viertelkreis (Mittelpunkt rechts unten der Rundung)
    const cy = top + r;
    const w = mid >= cy ? 92 : 92 - r + Math.sqrt(Math.max(0, r * r - (cy - mid) ** 2));
    rows.push({ y, w });
  }
  return (
    <svg viewBox="0 0 120 120" className="size-full" aria-hidden>
      {/* Sollform als feine Linie */}
      <path d={`M${left} ${bottom}V${top}H${left + 92 - r}A${r} ${r} 0 0 1 ${left + 92} ${top + r}V${bottom}`} fill="none" stroke="var(--c-ink4)" strokeDasharray="2 2" strokeWidth="0.8" />
      {rows.map((row, i) => (
        <rect key={i} x={left} y={row.y - px + 0.35} width={Math.max(0, row.w)} height={Math.max(0.6, px - 0.7)} rx={Math.min(px / 2, 2.5)} fill={c} opacity={i % 2 ? 0.86 : 1} />
      ))}
      <rect x="6" y={bottom} width="108" height="5" rx="2" fill="var(--c-ink3)" opacity="0.5" />
      <text x="60" y="116" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--c-ink2)">
        {`${layer.toFixed(2).replace(".", ",")} mm`}
      </text>
    </svg>
  );
}

export function QualityPicker({
  procs,
  value,
  def,
  nozzle,
  color,
  onPick,
}: {
  procs: Proc[];
  value: string;
  def: string;
  nozzle: number;
  color: string;
  onPick: (name: string) => void;
}) {
  const cur = procs.find((p) => p.name === value);
  const layer = cur?.layer ?? 0.2;
  const hq = cur && /High Quality/i.test(cur.name);
  return (
    <Card figure={<LayerFigure layer={layer} color={color} />}>
      <div className="grid grid-cols-4 gap-1.5">
        {procs.map((p) => {
          const on = p.name === value;
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => onPick(p.name)}
              title={p.name.replace(/ @BBL.*$/, "")}
              className={`flex flex-col items-center rounded-lg px-1 py-1 leading-tight ${on ? "bg-ink text-bg" : "bg-fill text-ink2 hover:bg-hover"}`}
            >
              <span className="text-[13px] font-bold tnum">
                {p.layer?.toFixed(2).replace(".", ",").replace(/^0/, "")}
                {p.name === def && <span className="opacity-60">*</span>}
              </span>
              <span className="text-[9.5px] font-semibold opacity-70">{/High Quality/i.test(p.name) ? "HQ" : /Strength/i.test(p.name) ? "Fest" : /Draft/i.test(p.name) ? "Entwurf" : "Std"}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs leading-snug text-ink2">
        {layerNote(layer)}
        {hq ? ". HQ: langsamere Außenwand für sauberere Oberfläche" : ""}
      </p>
      <p className="mt-1 text-[11px] text-ink3">Schichthöhe in mm · HQ = High Quality · * = Standard</p>
      {layer > nozzle * 0.75 + 1e-6 && <Warn>Mehr als 75 % der Düse: Die Schichten haften schlecht aneinander.</Warn>}
    </Card>
  );
}

// ---------- Wände ----------

const wallNote = (n: number) =>
  n <= 1
    ? "Nur für Vasen und Deko, bricht leicht"
    : n === 2
      ? "Standard: reicht für Deko und leichte Teile"
      : n === 3
        ? "Robuster: gut für Halter, Clips und Gewinde"
        : "Sehr fest für Teile unter Last";

/** Draufsicht auf eine Ecke: Wandlinien von außen nach innen, dahinter angedeutete Füllung */
function WallFigure({ walls, line, color }: { walls: number; line: number; color: string }) {
  const n = useTween(walls, 400) || walls;
  const c = ink(color);
  const step = 7;
  const shown = Math.round(n);
  return (
    <svg viewBox="0 0 120 120" className="size-full" aria-hidden>
      <defs>
        <pattern id="wall-fill" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="10" stroke={c} strokeWidth="1.4" opacity="0.5" />
        </pattern>
      </defs>
      <rect x="8" y="8" width="104" height="104" rx="10" fill={c} opacity="0.12" />
      <rect x={8 + n * step} y={8 + n * step} width={104 - 2 * n * step} height={104 - 2 * n * step} rx="4" fill="url(#wall-fill)" />
      {Array.from({ length: shown }, (_, i) => (
        <rect
          key={i}
          x={11 + i * step}
          y={11 + i * step}
          width={98 - 2 * i * step}
          height={98 - 2 * i * step}
          rx={Math.max(2, 8 - i * 1.5)}
          fill="none"
          stroke={c}
          strokeWidth="5.2"
          opacity={i === 0 ? 1 : 0.88}
        />
      ))}
      <text x="60" y="64" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--c-ink)">
        {`${(walls * line).toFixed(1).replace(".", ",")} mm`}
      </text>
    </svg>
  );
}

export function WallsPicker({ walls, profile, nozzle, color, onWalls }: { walls: number; profile: number | null; nozzle: number; color: string; onWalls: (n: number) => void }) {
  const line = nozzle * 1.05; // Linienbreite ≈ Düse + 5 %
  const btn = "flex size-9 items-center justify-center rounded-lg bg-fill text-lg font-bold text-ink2 hover:bg-hover disabled:opacity-40";
  return (
    <Card figure={<WallFigure walls={walls} line={line} color={color} />}>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => onWalls(walls - 1)} disabled={walls <= 1} aria-label="Eine Wand weniger">
          −
        </button>
        <span className="min-w-20 text-center text-2xl font-extrabold tracking-tight tnum">
          {walls} <span className="text-sm font-bold text-ink3">{walls === 1 ? "Wand" : "Wände"}</span>
        </span>
        <button type="button" className={btn} onClick={() => onWalls(walls + 1)} disabled={walls >= 8} aria-label="Eine Wand mehr">
          +
        </button>
        {profile != null && walls !== profile && (
          <button type="button" onClick={() => onWalls(profile)} className="ml-auto text-[11px] font-semibold text-ink3 hover:text-ink">
            Profil: {profile}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs leading-snug text-ink2">{wallNote(walls)}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink3">Tipp: Eine Wand mehr macht ein Teil meist fester als 20 % mehr Füllung, weil die Kräfte außen wirken.</p>
    </Card>
  );
}

// ---------- Stützen ----------

export const SUPPORT_NOTE = {
  aus: "Keine Stützen: Überhänge bis etwa 45° und kurze Brücken gehen meist ohne, steilere hängen durch",
  normal: "Gerades Gitter unter jedem Überhang: sehr stabil, aber schwerer zu lösen und hinterlässt Spuren",
  baum: "Äste wachsen um das Modell herum zum Überhang: weniger Material, leichter zu entfernen, gut für Figuren",
} as const;

/** Bauteil mit Überhang rechts: ohne Stützen hängt er durch, normal ein Gitter, Baum mit Ästen */
export function SupportFigure({ mode, color }: { mode: keyof typeof SUPPORT_NOTE; color: string }) {
  const c = ink(color);
  const s = "var(--c-ink3)";
  return (
    <svg viewBox="0 0 120 120" className="size-full" aria-hidden>
      <rect x="6" y="100" width="108" height="5" rx="2" fill="var(--c-ink3)" opacity="0.5" />
      {/* Säule und Arm */}
      <path d="M18 100V28H104V46H44V100Z" fill={c} />
      {mode === "aus" && (
        <g stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.8">
          <path d="M52 47q4 10 8 0M64 47q4 14 8 0M76 47q5 18 10 0M90 47q5 12 9 0" />
        </g>
      )}
      {mode === "normal" && (
        <g stroke={s} strokeWidth="1.6">
          {Array.from({ length: 10 }, (_, i) => (
            <line key={i} x1={48 + i * 6} y1="49" x2={48 + i * 6} y2="100" />
          ))}
          <line x1="46" y1="49" x2="104" y2="49" strokeWidth="2.2" />
        </g>
      )}
      {mode === "baum" && (
        <g stroke={s} strokeWidth="2.2" fill="none" strokeLinecap="round">
          <path d="M80 100V74" strokeWidth="3.4" />
          <path d="M80 74C80 64 62 60 58 49M80 74V49M80 74C80 64 98 60 100 49M80 66C86 60 88 54 89 49M80 66C74 60 71 54 69 49" />
        </g>
      )}
    </svg>
  );
}

// ---------- Vergleich mit dem Standard ----------

/** „+14 min · +2,1 g gegenüber Standard“; nichts, wenn gleich */
export function deltaText(cur: { s: number; g: number }, base: { s: number; g: number }) {
  const dm = Math.round((cur.s - base.s) / 60);
  const dg = Math.round((cur.g - base.g) * 10) / 10;
  if (!dm && !dg) return null;
  const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "±");
  const min = Math.abs(dm) >= 60 ? `${Math.floor(Math.abs(dm) / 60)} h ${Math.abs(dm) % 60} min` : `${Math.abs(dm)} min`;
  return { time: `${sign(dm)}${min}`, grams: `${sign(dg)}${Math.abs(dg).toFixed(1).replace(".", ",")} g`, faster: dm < 0, lighter: dg < 0 };
}

// ---------- Spülen beim Farbwechsel ----------

export const FLUSH_STEPS = [
  { value: 1, label: "100 %" },
  { value: 0.75, label: "75 %" },
  { value: 0.5, label: "50 %" },
] as const;

function flushNote(f: number) {
  if (f >= 1) return "Wie Bambu Studio: sicher saubere Farben, auch von dunkel nach hell, kostet am meisten Filament und Zeit";
  if (f >= 0.75) return "Reicht meist: kaum Unterschied, ein Viertel weniger Abfall. Bei Schwarz → Weiß kann ein Hauch Farbe bleiben";
  return "Halber Abfall: gut bei ähnlichen Farben oder hell → dunkel. Von dunkel nach hell bleiben oft Schlieren in den ersten Linien";
}

/** Faden von Farbe A nach B: der Mischbereich (wird ausgespült) wird mit der Spülmenge kürzer, darunter der Abfall-Klecks */
function FlushFigure({ flush, from, to }: { flush: number; from: string; to: string }) {
  const f = useTween(flush);
  const a = ink(from || "#202020");
  const b = ink(to || "#f2f2f2");
  const zone = 26 + 52 * f; // Länge des Mischbereichs
  const x0 = 60 - zone / 2;
  const r = 8 + 14 * f;
  return (
    <svg viewBox="0 0 120 120" className="size-full" aria-hidden>
      <defs>
        <linearGradient id="flush-mix" x1="0" x2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect x="6" y="30" width={x0 - 6} height="9" rx="4.5" fill={a} />
      <rect x={x0} y="30" width={zone} height="9" fill="url(#flush-mix)" />
      <rect x={x0 + zone} y="30" width={114 - x0 - zone} height="9" rx="4.5" fill={b} />
      <path d={`M${x0} 44 L${x0} 48 L${x0 + zone} 48 L${x0 + zone} 44`} fill="none" stroke="var(--c-ink3)" strokeWidth="1.2" />
      <line x1="60" y1="48" x2="60" y2={104 - r * 1.6} stroke="var(--c-ink3)" strokeWidth="1.2" strokeDasharray="2 2" />
      <ellipse cx="60" cy={106 - r * 0.8} rx={r * 1.25} ry={r * 0.8} fill="url(#flush-mix)" opacity="0.9" />
      <text x="60" y="22" textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--c-ink3)">
        {Math.round(flush * 100)} %
      </text>
    </svg>
  );
}

export function FlushPicker({ flush, from, to, onFlush }: { flush: number; from: string; to: string; onFlush: (v: number) => void }) {
  return (
    <Card figure={<FlushFigure flush={flush} from={from} to={to} />}>
      <div className="flex rounded-lg bg-fill p-0.5">
        {FLUSH_STEPS.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => onFlush(s.value)}
            className={`h-8 flex-1 rounded-md text-[13px] font-semibold tnum ${flush === s.value ? "bg-[var(--c-seg-active)] text-ink shadow-seg" : "text-ink2"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-snug text-ink2">{flushNote(flush)}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink3">Beim Farbwechsel drückt die Düse den Rest der alten Farbe heraus. 100 % ist Bambus Empfehlung je Farbpaar.</p>
    </Card>
  );
}

// ---------- Anzahl ----------

export const COPY_CHOICES = [1, 2, 3, 4, 6, 8];

/** Draufsicht aufs Bett: Exemplare im Raster, wie sie ungefähr liegen (die echte Anordnung zeigt der Viewer nach der Vorschau) */
function CopiesFigure({ n, color }: { n: number; color: string }) {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cell = Math.min(60 / cols, 60 / rows);
  const s = cell * 0.72;
  const c = ink(color);
  return (
    <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
      <rect x="8" y="8" width="84" height="84" rx="6" fill="#a5803f" opacity="0.9" />
      <rect x="8" y="8" width="84" height="84" rx="6" fill="none" stroke="var(--c-line)" />
      <path d="M8 14 L14 8 M8 20 L20 8" stroke="#1b1b1b" strokeOpacity="0.35" strokeWidth="1.5" />
      {Array.from({ length: n }, (_, i) => {
        const r = Math.floor(i / cols);
        const inRow = r === rows - 1 ? n - r * cols : cols;
        const x = 50 + ((i % cols) - (inRow - 1) / 2) * cell - s / 2;
        const y = 50 + (r - (rows - 1) / 2) * cell - s / 2;
        return (
          <g key={i} className="anim-fade">
            <rect x={x + 1} y={y + 1.5} width={s} height={s} rx={s * 0.18} fill="#000" opacity="0.25" />
            <rect x={x} y={y} width={s} height={s} rx={s * 0.18} fill={c} stroke="#000" strokeOpacity="0.25" strokeWidth="0.6" />
          </g>
        );
      })}
    </svg>
  );
}

export function CopiesPicker({
  copies,
  color,
  total,
  onCopies,
}: {
  copies: number;
  color: string;
  /** Werte der Vorschau für alle Exemplare zusammen, null = noch nicht gerechnet */
  total: { grams: number | null; seconds: number | null } | null;
  onCopies: (n: number) => void;
}) {
  const btn = "flex size-9 items-center justify-center rounded-lg bg-fill text-lg font-bold text-ink2 hover:bg-hover disabled:opacity-40";
  const g = (v: number) => `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} g`;
  const t = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`);
  return (
    <Card figure={<CopiesFigure n={copies} color={color} />}>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => onCopies(copies - 1)} disabled={copies <= 1} aria-label="Ein Exemplar weniger">
          −
        </button>
        <span className="min-w-20 text-center text-2xl font-extrabold tracking-tight tnum">
          {copies} <span className="text-sm font-bold text-ink3">Stück</span>
        </span>
        <button type="button" className={btn} onClick={() => onCopies(copies + 1)} disabled={copies >= 50} aria-label="Ein Exemplar mehr">
          +
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {COPY_CHOICES.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onCopies(n)}
            className={`h-7 min-w-7 rounded-md px-1.5 text-xs font-bold tnum ${n === copies ? "bg-ink text-bg" : "bg-fill text-ink2 hover:bg-hover"}`}
          >
            {n}×
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-snug text-ink2">
        {copies === 1
          ? "Mehrere Exemplare ordnet der Slicer wie Bambu Studio platzsparend auf der Platte an."
          : total?.grams != null && total.seconds != null
            ? `Je Stück ${g(total.grams / copies)} und ${t(total.seconds / copies)}, angeordnet vom Slicer wie in Bambu Studio.`
            : "Der Slicer ordnet die Exemplare wie Bambu Studio platzsparend an, die Ansicht zeigt danach ihre echte Lage."}
      </p>
    </Card>
  );
}
