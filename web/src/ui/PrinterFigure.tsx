import { useQuery } from "@tanstack/react-query";
import { Fan, Lightbulb, Wind } from "lucide-react";
import { AIRDUCT_LABEL, type PrinterLive, type Tray } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { trayColor } from "./Ams.tsx";

/**
 * Drucker als Zeichnung wie in Bambu Handy: P2S von vorn (geschlossenes Gehäuse, Glastür, Druckkopf, Bett), drumherum
 * Düse, Bett, Kammer und Lüfter als Schilder mit Linie zum Bauteil, darüber die AMS-Einheiten mit Schlauch zum Drucker; das
 * aktive Filament läuft in seiner Farbe bis in den Druckkopf. Koordinaten im viewBox 400 × H, Drucker um DY nach unten
 * versetzt, die Schilder liegen per Prozent darüber (links bis EDGE, rechts ab W − EDGE).
 */
const W = 400;
/** Platz oben für die AMS-Reihe */
const DY = 80;
const H = 250 + DY;
/** Zeichnung etwas größer als gezeichnet, Schilder enden bei EDGE bzw. W − EDGE */
const [CX, CY, S] = [200, 118, 1.06];
const EDGE = 106;
/** Weg des Druckkopfs je Richtung und Takt, gleich für Kopf, Linien und Punkte */
const SWING = 38;
const SMIL = { dur: "3.2s", repeatCount: "indefinite", calcMode: "spline", keyTimes: "0;0.5;1", keySplines: "0.45 0 0.55 1;0.45 0 0.55 1" } as const;
const px = (x: number) => CX + (x - CX) * S;
const py = (y: number) => CY + (y - CY) * S + DY;
/** Einlass der Schläuche oben hinten am Drucker (gezeichnete x), je AMS ein eigener */
const inlet = (i: number, n: number) => 214 + (n > 1 ? (i * 26) / (n - 1) : 13);

type Tag = { key: string; label: string; value: string; sub?: string; ax: number; ay: number; side: "l" | "r"; fan?: boolean; head?: boolean; onClick?: () => void };

/** Wo der Lüfter am Drucker sitzt (ID wie FAN_LABEL) */
const FAN_AT: Record<number, [number, number, "l" | "r"]> = {
  1: [210, 88, "r"], // Bauteil, am Druckkopf
  2: [140, 120, "l"], // Hilfslüfter, linke Wand
  3: [262, 46, "r"], // Kammer, hinten oben
  10: [248, 132, "r"], // Hilfslüfter 2
};

export function PrinterFigure({ l, onTemp, onFans, onLight }: { l?: PrinterLive; onTemp: (k: "nozzle" | "bed") => void; onFans: () => void; onLight: () => void }) {
  const on = !!l?.connected;
  // Druckkopf fährt beim Drucken hin und her (SMIL, damit Kopf, Linien und Punkte im Takt bleiben)
  const moving = on && (l.state === "RUNNING" || l.state === "PREPARE") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const printing = on && ["RUNNING", "PREPARE", "PAUSE"].includes(l.state);
  const light = on && !!l.light;
  const hotNozzle = on && (l.nozzle ?? 0) >= 60;
  const hotBed = on && (l.bed ?? 0) >= 40;
  const pct = printing ? Math.max(4, l.percent ?? 0) : 0;
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools, refetchInterval: 30_000, enabled: on });
  const byId = new Map((spools.data ?? []).map((x) => [x.id, x]));
  /** Farbe der Spule; "?" = Spule steckt, Farbe unbekannt; "" = Fach leer */
  const colorOf = (t: Tray) => trayColor(t, t.spool_id ? byId.get(t.spool_id) : undefined) || (t.loaded || t.type ? "?" : "");
  const units = on ? feeders(l) : [];
  const activeFeed = units.findIndex((u) => u.trays.some((t) => t.active));
  const activeTray = activeFeed >= 0 ? units[activeFeed]!.trays.find((t) => t.active)! : null;

  const tags: Tag[] = [
    { key: "nozzle", label: "Düse", ...temp(l?.nozzle, l?.nozzle_target), ax: 194, ay: 104, side: "l", head: true, onClick: on ? () => onTemp("nozzle") : undefined },
    { key: "bed", label: "Bett", ...temp(l?.bed, l?.bed_target), ax: 150, ay: 162, side: "l", onClick: on ? () => onTemp("bed") : undefined },
  ];
  if (!on || l.chamber != null) tags.push({ key: "chamber", label: "Kammer", ...temp(l?.chamber), ax: 236, ay: 70, side: "r" });
  if (on)
    for (const f of l.fans) {
      const [ax, ay, side] = FAN_AT[f.id] ?? [248, 120, "r"];
      tags.push({
        key: `fan${f.id}`,
        label: f.label === "Kammer" ? "Kammerlüfter" : f.label,
        value: f.speed ? `${f.speed} %` : "Aus",
        sub: f.target !== f.speed ? `→ ${f.target} %` : undefined,
        ax,
        ay,
        side,
        fan: true,
        head: f.id === 1,
        onClick: onFans,
      });
    }

  // Je Seite auf Höhe des Bauteils, bei Überschneidung nach unten (zur Not nach oben) geschoben; Höhen für die schmalste Breite
  const place = (side: "l" | "r") => {
    const list = tags.filter((t) => t.side === side).sort((a, b) => a.ay - b.ay);
    const half = list.map((t) => (t.sub ? 32 : 25));
    const y: number[] = [];
    list.forEach((t, i) => (y[i] = Math.max(py(t.ay), i ? y[i - 1]! + half[i - 1]! + half[i]! + 4 : DY - 6 + half[i]!)));
    for (let i = list.length - 1; i >= 0; i--) y[i] = Math.min(y[i]!, i < list.length - 1 ? y[i + 1]! - half[i + 1]! - half[i]! - 4 : H - half[i]!);
    return list.map((t, i) => ({ ...t, y: y[i]! }));
  };
  const placed = [...place("l"), ...place("r")];

  return (
    <div className="mx-auto w-full max-w-[38rem]">
      <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden>
          <defs>
            <linearGradient id="pf-glass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#4b5056" />
              <stop offset="1" stopColor="#2c2f33" />
            </linearGradient>
            <linearGradient id="pf-light" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff3d6" stopOpacity="0.42" />
              <stop offset="0.5" stopColor="#ffe7b8" stopOpacity="0.1" />
              <stop offset="1" stopColor="#ffe7b8" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="pf-body" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#2f3236" />
              <stop offset="0.5" stopColor="#25282b" />
              <stop offset="1" stopColor="#1e2023" />
            </linearGradient>
            <radialGradient id="pf-hot" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#ff8a3d" stopOpacity="0.9" />
              <stop offset="1" stopColor="#ff8a3d" stopOpacity="0" />
            </radialGradient>
          </defs>

          {units.length > 0 && <Feeders units={units} colorOf={colorOf} moving={moving} />}

          <g transform={`translate(0 ${DY}) translate(${CX} ${CY}) scale(${S}) translate(${-CX} ${-CY})`}>
          {/* Schatten und Füße */}
          <ellipse cx={200} cy={216} rx={86} ry={5} fill="var(--c-ink)" opacity={0.12} />
          <rect x={132} y={206} width={12} height={8} rx={2} fill="#141517" />
          <rect x={256} y={206} width={12} height={8} rx={2} fill="#141517" />

          {/* Gehäuse mit Glasdeckel */}
          <rect x={122} y={28} width={156} height={180} rx={11} fill="url(#pf-body)" stroke="var(--c-line)" strokeWidth={0.8} />
          <rect x={128} y={30} width={144} height={7} rx={3} fill="#3d4247" opacity={0.9} />
          {units.map((_, i) => (
            <rect key={i} x={inlet(i, units.length) - 3} y={26} width={6} height={5} rx={1.5} fill="#16181a" />
          ))}

          {/* Tür: Glas, Innenraum, Licht */}
          <rect x={132} y={42} width={136} height={134} rx={6} fill="url(#pf-glass)" />
          <g>
            {/* Rückwand-Kanten für Tiefe */}
            <path d="M140 50 L156 60 L244 60 L260 50" fill="none" stroke="#5a5f66" strokeWidth={0.8} opacity={0.6} />
            <path d="M156 60 L156 150 M244 60 L244 150" stroke="#5a5f66" strokeWidth={0.8} opacity={0.4} />
            {/* Lichtleiste */}
            <rect x={150} y={46} width={100} height={2.5} rx={1.2} fill={light ? "#fff2c8" : "#565b61"} />
            {/* Gantry */}
            <rect x={136} y={76} width={128} height={5} rx={1.5} fill="#16181a" />
            <rect x={136} y={76} width={128} height={1.2} fill="#4a4f55" />
            {/* Aktives Filament vom Einlass bis in den Druckkopf */}
            {activeTray && (
              <path
                d={tube(inlet(activeFeed, units.length), 34, 194, 68)}
                fill="none"
                stroke={paint(colorOf(activeTray))}
                strokeWidth={1.6}
                opacity={0.9}
                className={moving ? "flow" : undefined}
              >
                {moving && <animate attributeName="d" values={[-1, 1, -1].map((k) => tube(inlet(activeFeed, units.length), 34, 194 + k * SWING, 68)).join(";")} {...SMIL} />}
              </path>
            )}
            {/* Druckkopf */}
            <g>
              {moving && <animateTransform attributeName="transform" type="translate" values={`${-SWING} 0;${SWING} 0;${-SWING} 0`} {...SMIL} />}
              <rect x={180} y={68} width={28} height={33} rx={4} fill="#1b1d20" stroke="#3a3e43" strokeWidth={0.8} />
              <rect x={184} y={72} width={20} height={14} rx={2.5} fill="#2b2e32" />
              <circle cx={194} cy={79} r={3.2} fill="none" stroke={on ? "var(--c-accent)" : "#4a4f55"} strokeWidth={1.1} />
              <rect x={184} y={90} width={20} height={1.6} rx={0.8} fill={on ? "#7fd0a0" : "#3a3e43"} opacity={0.8} />
              <path d="M190 101 L198 101 L195.5 107 L192.5 107 Z" fill={hotNozzle ? "#ff8a3d" : "#8a8e93"} />
              {hotNozzle && <circle cx={194} cy={107} r={6} fill="url(#pf-hot)" className="pf-glow" />}
            </g>
            {/* Druckobjekt wächst mit dem Fortschritt */}
            {printing && (
              <rect x={184} y={162 - 0.34 * pct} width={20} height={0.34 * pct} rx={1.5} fill="var(--c-accent)" opacity={0.9} />
            )}
            {/* Bett */}
            {hotBed && <rect x={142} y={161} width={116} height={6} rx={3} fill="#ff8a3d" opacity={0.35} className="pf-glow" />}
            <rect x={144} y={162} width={112} height={4.5} rx={1} fill="#b59a6a" />
            <rect x={144} y={162} width={112} height={1} fill="#d8c296" />
            <rect x={150} y={166.5} width={100} height={4} rx={1} fill="#16181a" />
            <rect x={196} y={170} width={8} height={6} fill="#16181a" />
            {/* Licht im Raum */}
            {light && <rect x={132} y={42} width={136} height={134} rx={6} fill="url(#pf-light)" />}
            {/* Spiegelung auf dem Glas */}
            <path d="M138 172 L176 46 L196 46 L158 172 Z" fill="#ffffff" opacity={0.045} />
          </g>
          <rect x={132} y={42} width={136} height={134} rx={6} fill="none" stroke="#101113" strokeWidth={2} />
          {/* Türgriff */}
          <rect x={262} y={92} width={3} height={40} rx={1.5} fill="#5b6066" />

          {/* Bedienteil vorn */}
          <rect x={136} y={183} width={36} height={18} rx={2.5} fill="#0e0f11" stroke="#3a3e43" strokeWidth={0.6} />
          {on && (
            <g opacity={0.85}>
              <rect x={140} y={187} width={12} height={2} rx={1} fill="var(--c-accent)" />
              <rect x={140} y={192} width={22} height={1.5} rx={0.75} fill="#5a5f66" />
              <rect x={140} y={196} width={16} height={1.5} rx={0.75} fill="#5a5f66" />
            </g>
          )}
          <circle cx={258} cy={192} r={2.2} fill={on ? stateDot(l.state) : "#4a4f55"} />
          </g>

          {/* Linien zu den Schildern */}
          {placed.map((t) => {
            const x0 = t.side === "l" ? EDGE : W - EDGE;
            const xm = t.side === "l" ? EDGE + 5 : W - EDGE - 5;
            const [ax, ay] = [px(t.ax), py(t.ay)];
            return (
              <g key={t.key}>
                <path d={`M${x0} ${t.y} L${xm} ${t.y} L${ax} ${ay}`} fill="none" stroke="var(--c-ink3)" strokeWidth={0.9} opacity={0.55}>
                  {moving && t.head && (
                    <animate attributeName="d" values={[-1, 1, -1].map((k) => `M${x0} ${t.y} L${xm} ${t.y} L${ax + k * SWING * S} ${ay}`).join(";")} {...SMIL} />
                  )}
                </path>
                <circle cx={ax} cy={ay} r={2.6} fill="var(--c-card)" stroke="var(--c-accent)" strokeWidth={1.2}>
                  {moving && t.head && <animate attributeName="cx" values={[-1, 1, -1].map((k) => ax + k * SWING * S).join(";")} {...SMIL} />}
                </circle>
              </g>
            );
          })}
        </svg>

        {placed.map((t) => (
          <TagChip key={t.key} t={t} />
        ))}
      </div>

      {on && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <button
            onClick={onLight}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${light ? "bg-accent-soft text-accent" : "bg-fill text-ink2 hover:bg-hover"}`}
            aria-pressed={light}
          >
            <Lightbulb size={13} fill={light ? "currentColor" : "none"} /> Licht {light ? "an" : "aus"}
          </button>
          {l.airduct && (
            <button onClick={onFans} className="flex items-center gap-1.5 rounded-full bg-fill px-3 py-1.5 text-xs font-semibold text-ink2 hover:bg-hover">
              <Wind size={13} /> Luftstrom: {AIRDUCT_LABEL[l.airduct.mode] ?? "–"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TagChip({ t }: { t: Tag & { y: number } }) {
  const style = { top: `${(t.y / H) * 100}%`, ...(t.side === "l" ? { right: `${100 - (EDGE / W) * 100}%` } : { left: `${100 - (EDGE / W) * 100}%` }) };
  const spin = t.fan && t.value !== "Aus";
  const body = (
    <>
      <div className="text-[10px] font-bold tracking-[0.06em] whitespace-nowrap text-ink3 uppercase">{t.label}</div>
      <div className={`flex items-center gap-1 text-sm leading-tight font-bold whitespace-nowrap tnum ${t.side === "l" ? "justify-end" : ""}`}>
        {t.fan && <Fan size={12} className={`shrink-0 text-ink3 ${spin ? "animate-spin [animation-duration:1.6s]" : ""}`} />}
        {t.value}
      </div>
      {t.sub && <div className="text-[11px] leading-tight whitespace-nowrap text-ink3 tnum">{t.sub}</div>}
    </>
  );
  const cls = `absolute -translate-y-1/2 rounded-xl bg-fill px-2 py-1 ${t.side === "l" ? "text-right" : "text-left"}`;
  return t.onClick ? (
    <button style={style} className={`${cls} hover:bg-hover`} onClick={t.onClick} aria-label={`${t.label} einstellen`}>
      {body}
    </button>
  ) : (
    <div style={style} className={cls}>
      {body}
    </div>
  );
}

/** Ist groß, Ziel klein darunter (nur wenn geheizt wird) */
function temp(v?: number | null, target?: number | null): { value: string; sub?: string } {
  return { value: v == null ? "–" : `${Math.round(v)} °C`, sub: target ? `→ ${Math.round(target)} °C` : undefined };
}

function stateDot(s: string) {
  return s === "FAILED" ? "#ff6b5e" : s === "RUNNING" || s === "PREPARE" ? "#7fd0a0" : s === "PAUSE" ? "#f0a35c" : "#9aa0a6";
}

type Feeder = { key: string; label: string; trays: Tray[] };

/** AMS-Einheiten, dazu die externe Spule, wenn aus ihr gedruckt wird */
function feeders(l: PrinterLive): Feeder[] {
  const list: Feeder[] = l.ams.map((u) => ({ key: `ams${u.id}`, label: u.label, trays: u.trays }));
  if (l.external?.active) list.push({ key: "ext", label: "Extern", trays: [l.external] });
  return list;
}

/** Schlauch als weiche Kurve von oben nach unten */
const tube = (x0: number, y0: number, x1: number, y1: number) => {
  const k = Math.max(14, (y1 - y0) * 0.55);
  return `M${x0} ${y0} C${x0} ${y0 + k} ${x1} ${y1 - k} ${x1} ${y1}`;
};

/** AMS-Reihe oben: je Einheit ein Kasten mit vier Spulen, Schlauch vom Ausgang zum eigenen Einlass am Drucker */
function Feeders({ units, colorOf, moving }: { units: Feeder[]; colorOf: (t: Tray) => string; moving: boolean }) {
  const gap = 14;
  const widths = units.map((u) => (u.trays.length > 1 ? 4 : 1.2));
  const unit = Math.min(38, (W - 24 - gap * (units.length - 1)) / widths.reduce((a, b) => a + b, 0));
  const total = widths.reduce((a, b) => a + b * unit, 0) + gap * (units.length - 1);
  const y0 = 6;
  const h = 52;
  let x = (W - total) / 2;
  const boxes = units.map((u, i) => {
    const w = widths[i]! * unit;
    const b = { u, x, w, out: x + w / 2 };
    x += w + gap;
    return b;
  });
  const top = py(28) - 2;
  return (
    <g>
      {/* Schläuche zuerst, damit sie hinter den Kästen beginnen */}
      {boxes.map((b, i) => {
        const active = b.u.trays.find((t) => t.active);
        const d = tube(b.out, y0 + h - 2, px(inlet(i, units.length)), top);
        return (
          <g key={b.u.key}>
            <path d={d} fill="none" stroke="#3a3e43" strokeWidth={4.2} strokeLinecap="round" opacity={0.9} />
            <path d={d} fill="none" stroke="#8a8e93" strokeWidth={2.4} strokeLinecap="round" opacity={0.35} />
            {active && (
              <path d={d} fill="none" stroke={paint(colorOf(active))} strokeWidth={2.2} strokeLinecap="round" className={moving ? "flow" : undefined} />
            )}
          </g>
        );
      })}
      {boxes.map((b) => {
        const r = Math.min(unit * 0.36, 13);
        return (
          <g key={b.u.key}>
            <rect x={b.x} y={y0} width={b.w} height={h} rx={7} fill="#26292c" stroke="var(--c-line)" strokeWidth={0.8} />
            <rect x={b.x + 3} y={y0 + 3} width={b.w - 6} height={9} rx={4} fill="#3a3e43" />
            <text x={b.x + 8} y={y0 + 10} fontSize={6.5} fontWeight={700} fill="#b5b9be" letterSpacing={0.6}>
              {b.u.label.toUpperCase()}
            </text>
            <rect x={b.x + 3} y={y0 + 15} width={b.w - 6} height={h - 22} rx={4} fill="#1a1c1f" />
            {b.u.trays.map((t, j) => (
              <SpoolDot key={t.id} cx={b.x + (b.w * (j + 0.5)) / b.u.trays.length} cy={y0 + 15 + (h - 22) / 2} r={r} color={colorOf(t)} active={t.active} spin={moving && t.active} />
            ))}
            <rect x={b.out - 4} y={y0 + h - 3} width={8} height={4} rx={1.5} fill="#16181a" />
          </g>
        );
      })}
    </g>
  );
}

function SpoolDot({ cx, cy, r, color, active, spin }: { cx: number; cy: number; r: number; color: string; active: boolean; spin: boolean }) {
  return (
    <g>
      {active && <circle cx={cx} cy={cy} r={r + 2.6} fill="none" stroke="var(--c-accent)" strokeWidth={1.4} />}
      {color === "?" ? (
        <g>
          <circle cx={cx} cy={cy} r={r} fill="#4a4f55" />
          <text x={cx} y={cy + r * 0.36} textAnchor="middle" fontSize={r * 1.05} fontWeight={800} fill="#c9ccd0">
            ?
          </text>
        </g>
      ) : color ? (
        <g>
          {spin && <animateTransform attributeName="transform" type="rotate" values={`0 ${cx} ${cy};360 ${cx} ${cy}`} dur="2.6s" repeatCount="indefinite" />}
          <circle cx={cx} cy={cy} r={r} fill={color} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={0.8} />
          <circle cx={cx} cy={cy} r={r * 0.78} fill="none" stroke="#000" strokeOpacity={0.12} strokeWidth={0.8} />
          <circle cx={cx} cy={cy} r={r * 0.42} fill="#2b2e32" />
          <rect x={cx - 0.8} y={cy - r * 0.42} width={1.6} height={r * 0.3} fill="#5a5f66" />
          <circle cx={cx} cy={cy} r={r * 0.14} fill="#111214" />
        </g>
      ) : (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#4a4f55" strokeWidth={0.9} strokeDasharray="2 2" />
      )}
    </g>
  );
}

/** Strichfarbe für Filament, unbekannte Farbe als helles Grau */
const paint = (c: string) => (c && c !== "?" ? c : "#cfd2d6");
