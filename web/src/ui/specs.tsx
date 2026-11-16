// Datenblatt-Kennwerte als Zeichnung: Temperaturskala (Glasübergang, HDT, Vicat, Schmelze, Druck- und Betttemperatur),
// Zugstab nach ISO 527, Drei-Punkt-Biegung und Schlagpendel, die Werte direkt am Bauteil. Breite wird gemessen, damit die
// Schrift auf dem iPhone so groß bleibt wie auf dem Desktop (viewBox = echte Pixel).
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CatalogBrand, CatalogLine } from "../../../shared/catalog.ts";
import { baseMaterial, fmtSpec, median, specMeta, SPECS, type LineSpecs, type SpecKey } from "../../../shared/specs.ts";

/** Sorte mit Datenblatt samt Marke und Grundmaterial, für Rangfolgen */
export type SpecEntry = { brand: CatalogBrand; line: CatalogLine; base: string; specs: LineSpecs };

export function specEntries(cat: CatalogBrand[] | undefined): SpecEntry[] {
  return (cat ?? []).flatMap((brand) =>
    brand.lines.filter((l) => l.specs && Object.keys(l.specs.values).length).map((line) => ({ brand, line, base: baseMaterial(line.material), specs: line.specs! })),
  );
}

/** Rang eines Werts unter allen Einträgen mit diesem Kennwert (1 = bester), null ohne Wertung */
export function rank(key: SpecKey, v: number, pool: SpecEntry[]): { pos: number; of: number } | null {
  const dir = specMeta(key).better;
  if (!dir) return null;
  const vals = pool.map((e) => e.specs.values[key]?.v).filter((x): x is number => x != null);
  if (!vals.length) return null;
  return { pos: 1 + vals.filter((x) => (dir === "high" ? x > v : x < v)).length, of: vals.length };
}

/** Mittelwerte (Median) eines Materials als Pseudo-Datenblatt für die Materialseite */
export function materialSpecs(list: SpecEntry[]): { specs: LineSpecs; counts: Partial<Record<SpecKey, number>>; range: Partial<Record<SpecKey, [number, number]>> } {
  const values: LineSpecs["values"] = {};
  const counts: Partial<Record<SpecKey, number>> = {};
  const range: Partial<Record<SpecKey, [number, number]>> = {};
  for (const s of SPECS) {
    const xs = list.map((e) => e.specs.values[s.key]?.v).filter((x): x is number => x != null);
    const zs = list.map((e) => e.specs.values[s.key]?.z).filter((x): x is number => x != null);
    if (!xs.length) continue;
    values[s.key] = { v: median(xs), z: zs.length ? median(zs) : null, std: `Median aus ${xs.length} Sorte${xs.length > 1 ? "n" : ""}` };
    counts[s.key] = xs.length;
    range[s.key] = [Math.min(...xs), Math.max(...xs)];
  }
  return { specs: { source: null, specimen: null, values, note: null }, counts, range };
}

export const unitOf = (k: SpecKey) => specMeta(k).unit;
export const showVal = (k: SpecKey, v: number) => `${fmtSpec(k, v)} ${unitOf(k)}`.replace(" %", " %");

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Grobe Textbreite für Kollisionen (Manrope, 12–13 px) */
const textW = (s: string, px = 12.5) => s.length * px * 0.56;

// ————————————————————————————————————————————— Temperatur —————————————————————————————————————————————

const THERMAL: { key: SpecKey; label: string }[] = [
  { key: "tg", label: "Tg" },
  { key: "hdt_18", label: "HDT 1,8 MPa" },
  { key: "hdt_045", label: "HDT 0,45 MPa" },
  { key: "vicat", label: "Vicat" },
  { key: "melt", label: "Schmelze" },
];

/** Temperaturachse von Raumtemperatur bis über die Düse: oben die Einsatzgrenzen als Fähnchen, unten Düse, Bett und Trocknung */
export function ThermoScale({ specs }: { specs: LineSpecs }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const val = specs.values;
  const raw = THERMAL.filter((t) => val[t.key]).map((t) => ({ ...t, t: val[t.key]!.v }));
  const bands = [
    { label: "Düse", lo: val.nozzle_min?.v, hi: val.nozzle_max?.v, color: "var(--c-accent)" },
    { label: "Bett", lo: val.bed_min?.v, hi: val.bed_max?.v, color: "var(--c-ink3)" },
    { label: `Trocknen${val.dry_hours ? ` · ${fmtSpec("dry_hours", val.dry_hours.v)} h` : ""}`, lo: val.dry_temp?.v, hi: val.dry_temp?.v, color: "var(--c-green)" },
  ].filter((b) => b.lo != null || b.hi != null) as { label: string; lo?: number; hi?: number; color: string }[];
  const top = Math.max(150, ...raw.map((p) => p.t + 30), ...bands.map((b) => (b.hi ?? b.lo ?? 0) + 20));
  const tMax = Math.ceil(top / 50) * 50;
  const [L, R] = [14, 14];
  // Achse ab Raumtemperatur; liegt ein Wert darunter (Tg von TPU), ab dem nächsten 50er darunter
  const t0 = Math.min(20, Math.floor((Math.min(...raw.map((p) => p.t)) - 10) / 50) * 50);
  const x = (t: number) => L + ((t - t0) / (tMax - t0)) * Math.max(1, w - L - R);

  // Fähnchen, deren Linien kaum auseinanderliegen, teilen sich ein Schild („HDT 0,45 · Vicat“, „57 · 55 °C“)
  const pins: { key: SpecKey; label: string; ts: number[]; t: number }[] = [];
  for (const p of [...raw].sort((a, b) => b.t - a.t)) {
    const g = pins.find((q) => Math.abs(x(q.t) - x(p.t)) < 7);
    if (g) {
      g.label += ` · ${p.label}`;
      if (!g.ts.includes(p.t)) g.ts.push(p.t);
    } else pins.push({ key: p.key, label: p.label, ts: [p.t], t: p.t });
  }

  // Fähnchen auf Ebenen verteilen, damit sich die Schilder nicht überlappen
  // Die Linie eines höheren Fähnchens kreuzt alle Ebenen darunter, also darf dort kein Schild über ihr liegen.
  // Heißeste zuerst (nah an der Achse): die Linien der kälteren liegen dann links von deren Schildern
  type Placed = (typeof pins)[number] & { px: number; value: string; right: boolean; lvl: number; a: number; b: number };
  const placed: Placed[] = [];
  for (const p of [...pins].sort((a, b) => b.t - a.t)) {
    const px = x(p.t);
    const value = `${p.ts.map((t) => fmtSpec(p.key, t)).join(" · ")} °C`;
    const width = Math.max(textW(p.label, 11), textW(value, 13)) + 8;
    const right = px + width < w - 4; // Schild rechts neben der Linie, sonst links
    const [a, b] = right ? [px - 4, px + width] : [px - width, px + 4];
    // Konflikte je Ebene zählen und die erste freie nehmen; geht keine ganz frei, die mit den wenigsten (endlich viele Ebenen)
    const clashes = (L: number) =>
      placed.filter((q) => !(q.lvl === L ? b < q.a || a > q.b : q.lvl < L ? px < q.a || px > q.b : q.px < a || q.px > b)).length;
    const cand = Array.from({ length: placed.length + 1 }, (_, L) => [L, clashes(L)] as const);
    const lvl = (cand.find(([, c]) => c === 0) ?? [...cand].sort((x, y) => x[1] - y[1])[0]!)[0];
    placed.push({ ...p, px, value, right, lvl, a, b });
  }
  const nl = Math.max(1, ...placed.map((p) => p.lvl + 1));
  const axisY = 16 + nl * 38;
  const bandY = axisY + 34;
  const h = bandY + bands.length * 26 + 4;
  const first = t0 < 20 ? t0 + 50 : 50;
  const ticks = Array.from({ length: Math.floor((tMax - first) / 50) + 1 }, (_, i) => first + i * 50);

  const laid = bands.map((b, i) => {
    const y = bandY + i * 26;
    const lo = b.lo ?? b.hi!;
    const hi = b.hi ?? b.lo!;
    const [a, z] = [x(lo), Math.max(x(hi), x(lo) + 6)];
    const text = `${b.label} ${lo === hi ? fmtSpec("nozzle_min", lo) : `${fmtSpec("nozzle_min", lo)}–${fmtSpec("nozzle_min", hi)}`} °C`;
    const tw = textW(text, 12);
    const right = z + 8 + tw < w;
    return { ...b, y, a, z, text, right, l: right ? a : a - 8 - tw, r: right ? z + 8 + tw : z };
  });

  return (
    <div ref={ref} className="w-full">
      {w > 0 && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block overflow-visible" role="img" aria-label="Temperaturskala mit Einsatz- und Verarbeitungstemperaturen">
          <defs>
            <linearGradient id="thermo" x1="0" x2="1">
              <stop offset="0" stopColor="#5b8fc9" stopOpacity="0.55" />
              <stop offset="0.45" stopColor="var(--c-fill2)" />
              <stop offset="1" stopColor="var(--c-accent)" stopOpacity="0.8" />
            </linearGradient>
          </defs>
          {/* Alltag zum Vergleich: Auto im Sommer ≈ 70 °C, kochendes Wasser 100 °C */}
          {[70, 100].map((t) => (
            <line key={t} x1={x(t)} x2={x(t)} y1={axisY - 10} y2={axisY + 14} stroke="var(--c-ink4)" strokeDasharray="2 3" />
          ))}
          <rect x={L} y={axisY - 5} width={Math.max(0, w - L - R)} height={10} rx={5} fill="url(#thermo)" />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={axisY + 5} y2={axisY + 10} stroke="var(--c-ink3)" />
              <text x={x(t)} y={axisY + 22} textAnchor="middle" fontSize={10.5} fill="var(--c-ink3)" className="tnum">
                {t}
              </text>
            </g>
          ))}
          {placed.map((p) => {
            const y = axisY - 14 - p.lvl * 38;
            return (
              <g key={p.key}>
                <line x1={p.px} x2={p.px} y1={y - 24} y2={axisY + 5} stroke="var(--c-ink)" strokeWidth={1.5} />
                <circle cx={p.px} cy={axisY} r={4} fill="var(--c-card)" stroke="var(--c-ink)" strokeWidth={2} />
                <text x={p.px + (p.right ? 5 : -5)} y={y - 13} textAnchor={p.right ? "start" : "end"} fontSize={11} fontWeight={700} fill="var(--c-ink3)">
                  {p.label}
                </text>
                <text x={p.px + (p.right ? 5 : -5)} y={y + 3} textAnchor={p.right ? "start" : "end"} fontSize={13} fontWeight={800} fill="var(--c-ink)" className="tnum">
                  {p.value}
                </text>
              </g>
            );
          })}
          {laid.map((b, i) => (
            <g key={b.label}>
              {/* Verbindung zur Achse nur, wenn sie kein Schild darüber schneidet */}
              {laid.slice(0, i).every((q) => b.a < q.l - 2 || b.a > q.r + 2) && (
                <line x1={b.a} x2={b.a} y1={axisY + 26} y2={b.y} stroke={b.color} strokeOpacity={0.35} />
              )}
              <rect x={b.a} y={b.y - 4} width={b.z - b.a} height={8} rx={4} fill={b.color} />
              <text x={b.right ? b.z + 8 : b.a - 8} y={b.y + 4} textAnchor={b.right ? "start" : "end"} fontSize={12} fontWeight={600} fill="var(--c-ink2)" className="tnum">
                {b.text}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

// ————————————————————————————————————————————— Mechanik —————————————————————————————————————————————

type Tag = { key: SpecKey; label: string };
const val2 = (specs: LineSpecs, k: SpecKey) => {
  const s = specs.values[k];
  if (!s) return null;
  return `${showVal(k, s.v)}${s.z != null ? ` · Z ${fmtSpec(k, s.z)}` : ""}`;
};

/** Schild mit Bezeichnung und Wert an einem Punkt der Zeichnung */
function SvgTag({ x, y, anchor = "middle", label, value }: { x: number; y: number; anchor?: "start" | "middle" | "end"; label: string; value: string | null }) {
  return (
    <g>
      <text x={x} y={y} textAnchor={anchor} fontSize={11} fontWeight={700} fill="var(--c-ink3)">
        {label}
      </text>
      <text x={x} y={y + 16} textAnchor={anchor} fontSize={13.5} fontWeight={800} fill={value ? "var(--c-ink)" : "var(--c-ink4)"} className="tnum">
        {value ?? "–"}
      </text>
    </g>
  );
}

/** Karte mit Zeichnung; ohne einen einzigen Wert blass mit Hinweis */
function Figure({ title, sub, children, empty }: { title: string; sub: string; children: (w: number) => ReactNode; empty: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-extrabold">{title}</div>
        <div className="truncate text-[11px] text-ink3">{sub}</div>
      </div>
      <div ref={ref} className={`mt-2 ${empty ? "opacity-40" : ""}`}>
        {w > 0 && children(w)}
      </div>
      {empty && <div className="-mt-6 text-center text-xs text-ink3">Im Datenblatt nicht angegeben</div>}
    </div>
  );
}

/** Schulterstab nach ISO 527, an beiden Enden eingespannt und auseinandergezogen */
export function TensileFigure({ specs }: { specs: LineSpecs }) {
  const tags: Tag[] = [
    { key: "tensile_strength", label: "Zugfestigkeit" },
    { key: "tensile_modulus", label: "E-Modul" },
    { key: "elongation", label: "Bruchdehnung" },
  ];
  const empty = tags.every((t) => !specs.values[t.key]);
  return (
    <Figure title="Zugversuch" sub="ISO 527 · Schulterstab" empty={empty}>
      {(w) => {
        const h = 150;
        const len = Math.min(w - 20, 300);
        const x0 = (w - len) / 2;
        const cy = 64;
        const [gw, nw] = [13, 7]; // halbe Höhe an Kopf und Steg
        const head = len * 0.2;
        const path = `M${x0} ${cy - gw} H${x0 + head} C${x0 + head + 18} ${cy - gw} ${x0 + head + 14} ${cy - nw} ${x0 + head + 32} ${cy - nw}
          H${x0 + len - head - 32} C${x0 + len - head - 14} ${cy - nw} ${x0 + len - head - 18} ${cy - gw} ${x0 + len - head} ${cy - gw} H${x0 + len}
          V${cy + gw} H${x0 + len - head} C${x0 + len - head - 18} ${cy + gw} ${x0 + len - head - 14} ${cy + nw} ${x0 + len - head - 32} ${cy + nw}
          H${x0 + head + 32} C${x0 + head + 14} ${cy + nw} ${x0 + head + 18} ${cy + gw} ${x0 + head} ${cy + gw} H${x0} Z`;
        return (
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block overflow-visible" role="img" aria-label="Zugversuch">
            <g className="spec-pull">
              <path d={path} fill="var(--c-accent-soft)" stroke="var(--c-accent)" strokeWidth={1.5} />
              {[x0 - 4, x0 + len - head * 0.7 + 4].map((cx) => (
                <rect key={cx} x={cx} y={cy - gw - 6} width={head * 0.7} height={(gw + 6) * 2} rx={3} fill="var(--c-ink2)" opacity={0.85} />
              ))}
            </g>
            {/* Zugkraft */}
            {[
              [x0 - 6, -1],
              [x0 + len + 6, 1],
            ].map(([ax, d]) => (
              <path key={ax} d={`M${ax} ${cy} h${d! * 16} m${-d! * 6} -5 l${d! * 6} 5 l${-d! * 6} 5`} fill="none" stroke="var(--c-ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            ))}
            {/* Messlänge */}
            <path d={`M${x0 + head + 36} ${cy - nw - 8} v-6 M${x0 + len - head - 36} ${cy - nw - 8} v-6 M${x0 + head + 36} ${cy - nw - 11} H${x0 + len - head - 36}`} stroke="var(--c-ink4)" fill="none" />
            <SvgTag x={w / 2} y={18} label="Zugfestigkeit" value={val2(specs, "tensile_strength")} />
            <SvgTag x={Math.max(textW("E-Modul") / 2 + 4, x0 + len * 0.22)} y={cy + gw + 32} label="E-Modul" value={val2(specs, "tensile_modulus")} />
            <SvgTag x={Math.min(w - textW("Bruchdehnung") / 2 - 4, x0 + len * 0.76)} y={cy + gw + 32} label="Bruchdehnung" value={val2(specs, "elongation")} />
          </svg>
        );
      }}
    </Figure>
  );
}

/** Drei-Punkt-Biegung: Balken auf zwei Auflagern, Stempel in der Mitte */
export function FlexFigure({ specs }: { specs: LineSpecs }) {
  const empty = !specs.values.flexural_strength && !specs.values.flexural_modulus;
  return (
    <Figure title="Biegeversuch" sub="ISO 178 · drei Punkte" empty={empty}>
      {(w) => {
        const h = 150;
        const len = Math.min(w - 30, 260);
        const x0 = (w - len) / 2;
        const y = 54;
        const sag = 9;
        return (
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block overflow-visible" role="img" aria-label="Biegeversuch">
            <path
              className="spec-bend"
              d={`M${x0} ${y - 5} Q${w / 2} ${y - 5 + sag * 2} ${x0 + len} ${y - 5} V${y + 5} Q${w / 2} ${y + 5 + sag * 2} ${x0} ${y + 5} Z`}
              fill="var(--c-accent-soft)"
              stroke="var(--c-accent)"
              strokeWidth={1.5}
            />
            {[x0 + 16, x0 + len - 16].map((sx) => (
              <path key={sx} d={`M${sx} ${y + 7} l9 15 h-18 Z`} fill="var(--c-ink2)" />
            ))}
            <path d={`M${w / 2} ${y - 30} v${18 + sag}`} stroke="var(--c-ink)" strokeWidth={2} strokeLinecap="round" />
            <path d={`M${w / 2 - 6} ${y - 18 + sag} l6 6 l6 -6`} fill="none" stroke="var(--c-ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <SvgTag x={Math.max(textW("Biegefestigkeit") / 2 + 4, w * 0.27)} y={y + 44} label="Biegefestigkeit" value={val2(specs, "flexural_strength")} />
            <SvgTag x={Math.min(w - textW("Biege-E-Modul") / 2 - 4, w * 0.73)} y={y + 44} label="Biege-E-Modul" value={val2(specs, "flexural_modulus")} />
          </svg>
        );
      }}
    </Figure>
  );
}

/** Schlagpendel (Charpy): Hammer schwingt gegen die stehende Probe */
export function ImpactFigure({ specs }: { specs: LineSpecs }) {
  const keys: SpecKey[] = ["impact", "impact_notched", "izod_jm", "hardness"];
  const empty = keys.every((k) => !specs.values[k]);
  const notched = specs.values.impact_notched ? "impact_notched" : specs.values.izod_jm ? "izod_jm" : "impact_notched";
  return (
    <Figure title="Schlag und Härte" sub="ISO 179 · Charpy" empty={empty}>
      {(w) => {
        const h = 150;
        const px = Math.min(w * 0.3, 90);
        const py = 14;
        const r = 62;
        return (
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block overflow-visible" role="img" aria-label="Schlagpendel">
            <path d={`M${px - r * 0.7} ${py + r * 0.7} A${r} ${r} 0 0 0 ${px + r * 0.7} ${py + r * 0.7}`} fill="none" stroke="var(--c-ink4)" strokeDasharray="3 4" />
            <g className="spec-swing" style={{ transformOrigin: `${px}px ${py}px` }}>
              <line x1={px} y1={py} x2={px} y2={py + r - 8} stroke="var(--c-ink2)" strokeWidth={2.5} strokeLinecap="round" />
              <rect x={px - 12} y={py + r - 10} width={24} height={16} rx={3} fill="var(--c-ink2)" />
            </g>
            <circle cx={px} cy={py} r={4} fill="var(--c-ink)" />
            <rect x={px - 4} y={py + r + 8} width={8} height={30} rx={1.5} fill="var(--c-accent-soft)" stroke="var(--c-accent)" strokeWidth={1.5} />
            <path d={`M${px - 4} ${py + r + 21} l4 2 l-4 2`} fill="var(--c-card)" stroke="var(--c-accent)" strokeWidth={1} />
            <path d={`M${px - 26} ${py + r + 40} H${px + 26}`} stroke="var(--c-ink3)" strokeWidth={2} />
            {(() => {
              const tx = px + 46;
              const rows: [string, SpecKey][] = [
                ["Ungekerbt", "impact"],
                [notched === "izod_jm" ? "Izod gekerbt" : "Gekerbt", notched],
                ["Shore-Härte", "hardness"],
              ];
              return rows.filter(([, k]) => specs.values[k]).map(([label, k], i) => (
                <SvgTag
                  key={k}
                  x={tx}
                  y={14 + i * 44}
                  anchor="start"
                  label={k === "hardness" && specs.values.hardness?.std ? `Härte ${specs.values.hardness.std.match(/Shore\s*[AD]/i)?.[0] ?? ""}`.trim() : label}
                  value={k === "hardness" && specs.values.hardness ? fmtSpec("hardness", specs.values.hardness.v) : val2(specs, k)}
                />
              ));
            })()}
          </svg>
        );
      }}
    </Figure>
  );
}

/** Kleiner Balken für die Position in einer Rangliste (rechts = bester) */
export function RankBar({ pos, of }: { pos: number; of: number }) {
  const p = of > 1 ? (pos - 1) / (of - 1) : 0;
  return (
    <span className="relative inline-block h-1.5 w-16 rounded-full bg-fill2 align-middle" aria-hidden>
      <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-card" style={{ left: `${(1 - p) * 100}%` }} />
    </span>
  );
}

export { baseMaterial };
