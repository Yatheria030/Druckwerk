// Kennwerte aus den Datenblättern: Vergleich und Rangliste aller Sorten je Kennwert, Materialübersicht (Median je Grundmaterial)
// und das Datenblatt einer Sorte bzw. eines Materials als Zeichnung mit Tabelle.
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, FileText, Info } from "lucide-react";
import { useMemo, useState } from "react";
import { catalogLine } from "../../../shared/catalog.ts";
import { fmtSpec, RANKABLE, SPEC_GROUPS, specMeta, SPECS, type LineSpecs, type SpecKey } from "../../../shared/specs.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { useCatalog } from "../lib/catalog.ts";
import { href, slug } from "../lib/router.ts";
import { Card, Label, LoadError } from "../ui/controls.tsx";
import { chipCls, FilamentTabs } from "../ui/FilamentTabs.tsx";
import { FlexFigure, ImpactFigure, materialSpecs, rank, RankBar, showVal, specEntries, TensileFigure, ThermoScale, type SpecEntry } from "../ui/specs.tsx";

const sheetHref = (e: SpecEntry) => href({ page: "filament", view: "kennwerte", brand: slug(e.brand.brand), line: slug(e.line.name) });
const matHref = (m: string) => href({ page: "filament", view: "kennwerte", material: m });

/** Eigene Spulen (nicht archiviert) je Katalogsorte */
function useOwned() {
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools });
  return useMemo(() => {
    const m = new Map<number, number>();
    for (const s of spools.data ?? []) {
      const l = s.archived ? undefined : catalogLine(s.brand, s.name);
      if (l) m.set(l.id, (m.get(l.id) ?? 0) + 1);
    }
    return m;
  }, [spools.data]);
}

export function SpecsPage({ brand, line, material }: { brand?: string; line?: string; material?: string }) {
  const q = useCatalog();
  const all = useMemo(() => specEntries(q.data), [q.data]);
  const entry = brand && line ? all.find((e) => slug(e.brand.brand) === brand && slug(e.line.name) === line) : undefined;
  const catLine = brand && line && !entry ? q.data?.find((b) => slug(b.brand) === brand)?.lines.find((l) => slug(l.name) === line) : undefined;
  const mat = material ? [...new Set(all.map((e) => e.base))].find((m) => slug(m) === slug(material)) : undefined;
  const back = (
    <a href={href({ page: "filament", view: "kennwerte" })} className="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-ink3 hover:text-ink">
      <ChevronLeft size={16} /> Kennwerte
    </a>
  );
  const sub = entry ? (
    <>
      <a href={href({ page: "filament", view: "katalog", brand: slug(entry.brand.brand) })} className="font-semibold hover:text-ink">
        {entry.brand.brand}
      </a>
      {" · "}
      <a href={matHref(entry.base)} className="font-semibold hover:text-ink">
        {entry.line.material}
      </a>
    </>
  ) : catLine ? (
    `${q.data?.find((b) => slug(b.brand) === brand)?.brand} · ${catLine.material}`
  ) : mat ? (
    `Median aus ${all.filter((e) => e.base === mat).length} Sorten, gedruckte Probekörper`
  ) : (
    `${all.length} Sorten aus ${new Set(all.map((e) => e.brand.id)).size} Marken, gedruckte Probekörper`
  );

  return (
    <>
      <PageHeader title={entry ? entry.line.name : catLine ? catLine.name : mat ? `${mat} im Vergleich` : "Kennwerte"} sub={q.data && sub} back={(entry || mat || catLine || brand) && back} />
      <FilamentTabs view="kennwerte" />
      <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6 2xl:max-w-[88rem]">
        {q.isError ? (
          <LoadError error={q.error} retry={() => q.refetch()} />
        ) : q.isPending ? (
          <div className="skeleton h-72 rounded-2xl" />
        ) : entry ? (
          <LineSheet e={entry} all={all} />
        ) : catLine ? (
          <Card className="py-10 text-center text-sm text-ink3">Für {catLine.name} gibt es keine Kennwerte an gedruckten Probekörpern.</Card>
        ) : brand ? (
          <Card className="py-10 text-center text-sm text-ink3">Diese Sorte steht nicht (mehr) im Katalog.</Card>
        ) : mat ? (
          <MaterialSheet mat={mat} all={all} />
        ) : material ? (
          <Card className="py-10 text-center text-sm text-ink3">Für {material} gibt es keine Sorte mit Datenblatt.</Card>
        ) : all.length ? (
          <Compare all={all} />
        ) : (
          <Card className="py-10 text-center text-sm text-ink3">Noch keine Kennwerte hinterlegt.</Card>
        )}
      </div>
    </>
  );
}

// ————————————————————————————————————————————— Datenblatt —————————————————————————————————————————————

function Figures({ specs }: { specs: LineSpecs }) {
  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-extrabold">Temperatur</div>
          <div className="truncate text-[11px] text-ink3">gestrichelt: Auto im Sommer ≈ 70 °C, kochendes Wasser</div>
        </div>
        <div className="mt-3">
          <ThermoScale specs={specs} />
        </div>
      </Card>
      <Card className="grid gap-6 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-3">
        <TensileFigure specs={specs} />
        <FlexFigure specs={specs} />
        <ImpactFigure specs={specs} />
      </Card>
    </div>
  );
}

/** Alle Kennwerte als Tabelle; Antippen einer Zeile erklärt den Wert */
function SpecTable({ specs, rankIn, extra }: { specs: LineSpecs; rankIn?: { label: string; pool: SpecEntry[] }[]; extra?: (k: SpecKey) => string | null }) {
  const [open, setOpen] = useState<SpecKey | null>(null);
  return (
    <Card className="overflow-hidden">
      {SPEC_GROUPS.map((g) => {
        const rows = SPECS.filter((s) => s.group === g.id && specs.values[s.key]);
        if (!rows.length) return null;
        return (
          <div key={g.id}>
            <div className="bg-fill/60 px-4 py-2">
              <Label>{g.label}</Label>
            </div>
            <div className="divide-y divide-sep">
              {rows.map((m) => {
                const s = specs.values[m.key]!;
                const on = open === m.key;
                return (
                  <button key={m.key} onClick={() => setOpen(on ? null : m.key)} className="block w-full px-4 py-2.5 text-left hover:bg-hover">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <div className="flex min-w-[11rem] flex-1 items-center gap-1.5 text-sm font-semibold">
                        {m.label}
                        <Info size={13} className="shrink-0 text-ink4" />
                      </div>
                      <div className="w-36 text-sm font-extrabold tnum">
                        {showVal(m.key, s.v)}
                        {s.z != null && <span className="ml-1.5 text-xs font-semibold text-ink3">Z {fmtSpec(m.key, s.z)}</span>}
                      </div>
                      {rankIn && m.better && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1">
                          {rankIn.map(({ label, pool }) => {
                            const r = rank(m.key, s.v, pool);
                            return r && r.of > 1 ? (
                              <span key={label} className="flex items-center gap-2 text-xs whitespace-nowrap text-ink2 tnum">
                                <RankBar pos={r.pos} of={r.of} />
                                {r.pos}. von {r.of} {label}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                      <div className="basis-full text-xs text-ink3 lg:ml-auto lg:basis-auto lg:text-right">{[s.std, extra?.(m.key)].filter(Boolean).join(" · ")}</div>
                    </div>
                    {on && <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-ink2">{m.info}</p>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function LineSheet({ e, all }: { e: SpecEntry; all: SpecEntry[] }) {
  const owned = useOwned();
  const mine = owned.get(e.line.id) ?? 0;
  const strip = e.line.colors.filter((c) => c.hex);
  const same = all.filter((x) => x.base === e.base);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-fill px-2.5 py-1 font-semibold text-ink2">Werte an gedruckten Probekörpern</span>
        {mine > 0 && <span className="rounded-full bg-accent-soft px-2.5 py-1 font-semibold text-accent">{mine} im Regal</span>}
        {e.specs.source && (
          <a href={e.specs.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-fill px-2.5 py-1 font-semibold text-accent hover:bg-fill2">
            <FileText size={13} /> Datenblatt des Herstellers <ExternalLink size={11} />
          </a>
        )}
        {strip.length > 0 && (
          <span className="ml-auto flex h-5 w-40 overflow-hidden rounded-full" title={`${e.line.colors.length} Farben`}>
            {strip.slice(0, 30).map((c) => (
              <span key={c.id} className="flex-1" style={{ background: `#${c.hex}` }} />
            ))}
          </span>
        )}
      </div>
      {e.specs.note && <p className="text-sm text-ink2">{e.specs.note}</p>}
      <Figures specs={e.specs} />
      <SpecTable
        specs={e.specs}
        rankIn={[
          { label: e.base, pool: same },
          { label: "gesamt", pool: all },
        ]}
      />
      <p className="text-xs text-ink3">
        Herstellerangaben aus dem technischen Datenblatt, gemessen an gedruckten Probekörpern. Z-Werte (quer zu den Schichten) liegen
        unter den XY-Werten; vergleichbar sind Werte nur bei gleicher Norm.
      </p>
    </div>
  );
}

function MaterialSheet({ mat, all }: { mat: string; all: SpecEntry[] }) {
  const list = all.filter((e) => e.base === mat);
  const m = materialSpecs(list);
  const [k, setK] = useState<SpecKey>(RANKABLE.find((s) => m.counts[s.key])?.key ?? "hdt_045");
  return (
    <div className="space-y-4">
      <Figures specs={m.specs} />
      <SpecTable
        specs={m.specs}
        extra={(key) => {
          const r = m.range[key];
          return r && r[0] !== r[1] ? `Spanne ${fmtSpec(key, r[0])}–${fmtSpec(key, r[1])} ${specMeta(key).unit}` : null;
        }}
      />
      <h2 className="px-1 pt-2 text-lg font-extrabold tracking-tight">Sorten</h2>
      <KeyChips value={k} onChange={setK} available={(key) => !!m.counts[key]} />
      <Ranking list={list} k={k} />
    </div>
  );
}

// ————————————————————————————————————————————— Vergleich —————————————————————————————————————————————

const readKey = (): SpecKey => {
  try {
    const k = localStorage.getItem("specs.key") as SpecKey | null;
    return k && RANKABLE.some((s) => s.key === k) ? k : "hdt_045";
  } catch {
    return "hdt_045";
  }
};

function KeyChips({ value, onChange, available }: { value: SpecKey; onChange: (k: SpecKey) => void; available: (k: SpecKey) => boolean }) {
  return (
    <div className="space-y-1.5">
      {SPEC_GROUPS.filter((g) => RANKABLE.some((s) => s.group === g.id)).map((g) => (
        <div key={g.id} className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
          <span className="w-20 shrink-0 text-[11px] font-bold tracking-[0.08em] text-ink3 uppercase">{g.label}</span>
          {RANKABLE.filter((s) => s.group === g.id && available(s.key)).map((s) => (
            <button key={s.key} className={chipCls(value === s.key)} onClick={() => onChange(s.key)} title={s.label}>
              {s.short}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function Compare({ all }: { all: SpecEntry[] }) {
  const owned = useOwned();
  const [k, setK0] = useState<SpecKey>(readKey);
  const setK = (x: SpecKey) => {
    setK0(x);
    try {
      localStorage.setItem("specs.key", x);
    } catch {
      /* ohne Speicher eben nicht merken */
    }
  };
  const [mat, setMat] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const meta = specMeta(k);
  const pool = all.filter((e) => !mine || owned.has(e.line.id));
  const withK = pool.filter((e) => e.specs.values[k]);
  const mats = [...new Set(withK.map((e) => e.base))].sort((a, b) => withK.filter((e) => e.base === b).length - withK.filter((e) => e.base === a).length);
  const list = mat ? withK.filter((e) => e.base === mat) : withK;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <KeyChips value={k} onChange={setK} available={(key) => all.some((e) => e.specs.values[key])} />
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
          <span className="w-20 shrink-0 text-[11px] font-bold tracking-[0.08em] text-ink3 uppercase">Auswahl</span>
          <button className={chipCls(mine)} onClick={() => setMine(!mine)}>
            Im Regal <span className="opacity-55">{all.filter((e) => owned.has(e.line.id)).length}</span>
          </button>
        </div>
      </div>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="text-base font-extrabold">
            {meta.label} <span className="font-semibold text-ink3">in {meta.unit}</span>
          </div>
          <div className="text-xs text-ink3">{meta.better === "high" ? "Rechts = höher = besser" : "Links = besser"} · Strich = Median</div>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink2">{meta.info}</p>
        <MaterialStrips entries={withK} k={k} mat={mat} onMat={(m) => setMat(mat === m ? null : m)} />
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-lg font-extrabold tracking-tight">
          Rangliste{mat && <span className="text-ink3"> · {mat}</span>}
        </h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
          <button className={chipCls(!mat)} onClick={() => setMat(null)}>
            Alle
          </button>
          {mats.map((m) => (
            <button key={m} className={chipCls(mat === m)} onClick={() => setMat(mat === m ? null : m)}>
              {m}
            </button>
          ))}
        </div>
      </div>
      <Ranking list={list} k={k} owned={owned} />
      <p className="text-xs text-ink3">
        Herstellerangaben aus den technischen Datenblättern, alle an gedruckten Probekörpern. Normen (ISO/ASTM) unterscheiden sich in
        Probe und Geschwindigkeit, im Zweifel auf die Norm achten.
      </p>
    </div>
  );
}

/** Runde Schrittweite für Achsen: 1, 2, 2,5 oder 5 × 10ⁿ */
const niceStep = (raw: number) => {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
};

/** Untergrenze der Achse: Temperaturen ab Raumtemperatur, alles andere ab 0 */
const axisMin = (k: SpecKey) => (specMeta(k).unit === "°C" ? 20 : 0);

/** Je Grundmaterial eine Zeile mit allen Sorten als Punkte und dem Median als Strich; Antippen filtert die Rangliste */
function MaterialStrips({ entries, k, mat, onMat }: { entries: SpecEntry[]; k: SpecKey; mat: string | null; onMat: (m: string) => void }) {
  const [tip, setTip] = useState<{ e: SpecEntry; x: number; row: string } | null>(null);
  const meta = specMeta(k);
  const groups = [...new Set(entries.map((e) => e.base))]
    .map((m) => {
      const xs = entries.filter((e) => e.base === m);
      const vals = xs.map((e) => e.specs.values[k]!.v).sort((a, b) => a - b);
      return { m, xs, med: vals.length % 2 ? vals[(vals.length - 1) / 2]! : (vals[vals.length / 2 - 1]! + vals[vals.length / 2]!) / 2 };
    })
    .sort((a, b) => (meta.better === "low" ? a.med - b.med : b.med - a.med));
  const lo = Math.min(axisMin(k), ...entries.map((e) => e.specs.values[k]!.v));
  const top = Math.max(...entries.map((e) => e.specs.values[k]!.v));
  const step = niceStep((top - lo) / 4);
  const max = Math.ceil((top * 1.02) / step) * step;
  const ticks = Array.from({ length: Math.floor((max - lo) / step) + 1 }, (_, i) => Math.ceil(lo / step) * step + i * step).filter((x) => x >= lo && x <= max);
  const pct = (v: number) => ((v - lo) / (max - lo || 1)) * 100;
  if (!groups.length) return <div className="py-8 text-center text-sm text-ink3">Keine Sorte mit diesem Wert für die Auswahl.</div>;
  return (
    <div className="mt-4 space-y-1">
      {groups.map(({ m, xs, med }) => (
        <div key={m} className={`grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-1 ${mat && mat !== m ? "opacity-40" : ""}`}>
          <button onClick={() => onMat(m)} className="truncate text-left text-sm font-bold hover:text-accent">
            {m} <span className="text-xs font-semibold text-ink3 tnum">{xs.length}</span>
          </button>
          <div className="relative h-8" onMouseLeave={() => setTip(null)}>
            <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--c-grid)]" />
            {xs.map((e) => {
              const v = e.specs.values[k]!.v;
              return (
                <a
                  key={e.line.id}
                  href={sheetHref(e)}
                  onMouseEnter={() => setTip({ e, x: pct(v), row: m })}
                  onFocus={() => setTip({ e, x: pct(v), row: m })}
                  className="absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                  style={{ left: `${pct(v)}%` }}
                  aria-label={`${e.brand.brand} ${e.line.name}: ${showVal(k, v)}`}
                >
                  <span className="size-2.5 rounded-full bg-accent opacity-70 ring-2 ring-card" />
                </a>
              );
            })}
            <span className="pointer-events-none absolute top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${pct(med)}%` }} />
            {tip?.row === m && (
              <div
                className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-bg shadow-card"
                style={{ left: `clamp(4.5rem, ${tip.x}%, calc(100% - 4.5rem))` }}
              >
                <div className="font-bold">
                  {tip.e.brand.brand} {tip.e.line.name}
                </div>
                <div className="tnum opacity-80">
                  {showVal(k, tip.e.specs.values[k]!.v)}
                  {tip.e.specs.values[k]!.std && ` · ${tip.e.specs.values[k]!.std}`}
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 px-1 pt-1">
        <span />
        <div className="relative h-4 text-[11px] text-ink3 tnum">
          {ticks.map((x, i) => (
            <span key={x} className={`absolute whitespace-nowrap ${i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${pct(x)}%` }}>
              {fmtSpec(k, x)}
              {i === ticks.length - 1 && ` ${meta.unit}`}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Sorten nach einem Kennwert, als Balken ab Raumtemperatur bzw. 0 */
function Ranking({ list, k, owned }: { list: SpecEntry[]; k: SpecKey; owned?: Map<number, number> }) {
  const [more, setMore] = useState(false);
  const meta = specMeta(k);
  const sorted = list.filter((e) => e.specs.values[k]).sort((a, b) => (meta.better === "low" ? 1 : -1) * (a.specs.values[k]!.v - b.specs.values[k]!.v));
  if (!sorted.length) return <Card className="py-10 text-center text-sm text-ink3">Keine Sorte mit diesem Wert.</Card>;
  const max = Math.max(...sorted.map((e) => Math.max(e.specs.values[k]!.v, e.specs.values[k]!.z ?? 0)));
  const lo = Math.min(axisMin(k), ...sorted.map((e) => e.specs.values[k]!.v));
  const w = (v: number) => `${Math.max(1.5, ((v - lo) / (max - lo || 1)) * 100)}%`;
  const shown = more ? sorted : sorted.slice(0, 40);
  return (
    <Card className="divide-y divide-sep overflow-hidden">
      {shown.map((e, i) => {
        const s = e.specs.values[k]!;
        const mine = owned?.get(e.line.id) ?? 0;
        return (
          <a key={e.line.id} href={sheetHref(e)} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-hover md:grid-cols-[2rem_minmax(0,16rem)_minmax(0,1fr)_7.5rem]">
            <span className="text-sm font-extrabold text-ink3 tnum">{i + 1}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{e.line.name}</div>
              <div className="truncate text-xs text-ink3">
                {e.brand.brand} · {e.base}
                {mine > 0 && <span className="font-semibold text-accent"> · {mine} im Regal</span>}
              </div>
            </div>
            <div className="col-span-2 col-start-2 row-start-2 space-y-1 md:col-span-1 md:col-start-3 md:row-start-1">
              <div className="h-2.5 rounded-r-[4px] bg-accent" style={{ width: w(s.v) }} title={s.std ?? undefined} />
              {s.z != null && <div className="h-1.5 rounded-r-[4px] bg-[var(--c-chart-muted)]" style={{ width: w(s.z) }} title="Z-Richtung" />}
            </div>
            <div className="col-start-3 row-start-1 text-right text-sm font-extrabold tnum md:col-start-4">
              {showVal(k, s.v)}
              {s.z != null && <div className="text-[11px] font-semibold text-ink3">Z {fmtSpec(k, s.z)}</div>}
            </div>
          </a>
        );
      })}
      {sorted.length > shown.length && (
        <button onClick={() => setMore(true)} className="block w-full py-3 text-center text-sm font-semibold text-accent hover:bg-hover">
          Alle {sorted.length} zeigen
        </button>
      )}
    </Card>
  );
}
