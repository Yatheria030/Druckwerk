import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { fmtDuration, type StatsMonth } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { useCostBasis } from "../lib/cost.ts";
import { href } from "../lib/router.ts";
import { Card, Label, LoadError } from "../ui/controls.tsx";
import { fmtG } from "../ui/spool.tsx";

/** Unterseiten des Verlaufs; auf dem Desktop in der Seitenleiste, darunter als Tabs oben */
export function HistoryTabs({ view }: { view: "drucke" | "statistik" }) {
  const tab = (on: boolean) => `flex h-8 flex-1 items-center justify-center rounded-md px-3 text-[13px] font-semibold ${on ? "bg-[var(--c-seg-active)] text-ink shadow-seg" : "text-ink2"}`;
  return (
    <nav className="flex rounded-lg bg-fill p-0.5 md:hidden">
      <a href={href({ page: "history" })} className={tab(view === "drucke")}>
        Drucke
      </a>
      <a href={href({ page: "history", view: "statistik" })} className={tab(view === "statistik")}>
        Statistik
      </a>
    </nav>
  );
}

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monthShort = (m: string) => MONTHS[Number(m.slice(5)) - 1];
const monthLong = (m: string) => `${monthShort(m)} ${m.slice(0, 4)}`;

/** Runde Obergrenze für die Achse: 1, 2, 2,5 oder 5 × 10^n */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((f) => f * p >= v) ?? 10) * p;
}

type Metric = "grams" | "hours" | "cost";

export function StatsPage() {
  const q = useQuery({ queryKey: ["stats"], queryFn: api.stats, refetchInterval: 60_000 });
  const cost = useCostBasis();
  const [range, setRange] = useState<"12" | "all">("12");
  const [metric, setMetric] = useState<Metric>("grams");
  const [table, setTable] = useState(false);

  const months = useMemo(() => {
    const d = q.data ?? [];
    if (range === "all") return d;
    // Immer 12 Spalten, auch wenn die Daten jünger sind
    const out: StatsMonth[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const t = new Date(now.getFullYear(), now.getMonth() - i, 15);
      const m = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
      out.push(d.find((x) => x.month === m) ?? { month: m, prints: 0, fertig: 0, abgebrochen: 0, fehler: 0, print_s: 0, grams: 0, cost_filament: 0, cost_energy: 0, materials: {} });
    }
    return out;
  }, [q.data, range]);

  const sum = useMemo(() => {
    const t = { prints: 0, fertig: 0, abgebrochen: 0, fehler: 0, print_s: 0, grams: 0, cost: 0, materials: {} as Record<string, number> };
    for (const m of months) {
      t.prints += m.prints;
      t.fertig += m.fertig;
      t.abgebrochen += m.abgebrochen;
      t.fehler += m.fehler;
      t.print_s += m.print_s;
      t.grams += m.grams;
      t.cost += m.cost_filament + m.cost_energy;
      for (const [k, v] of Object.entries(m.materials)) t.materials[k] = (t.materials[k] ?? 0) + v;
    }
    const ended = t.fertig + t.abgebrochen + t.fehler;
    return { ...t, rate: ended ? Math.round((t.fertig / ended) * 100) : null };
  }, [months]);

  const value = (m: StatsMonth) => (metric === "grams" ? m.grams : metric === "hours" ? m.print_s / 3600 : m.cost_filament + m.cost_energy);
  const fmt = (v: number) =>
    metric === "grams" ? fmtG(v) : metric === "hours" ? `${v.toLocaleString("de-DE", { maximumFractionDigits: v < 10 ? 1 : 0 })} h` : cost.money(v);
  const axis = (v: number) => (metric === "grams" ? (v >= 1000 ? `${(v / 1000).toLocaleString("de-DE")} kg` : `${v.toLocaleString("de-DE")} g`) : metric === "hours" ? `${v.toLocaleString("de-DE")} h` : `${v.toLocaleString("de-DE")} ${cost.currency}`);
  const materials = Object.entries(sum.materials).sort((a, b) => b[1] - a[1]);
  const empty = !sum.prints && !sum.grams;

  return (
    <>
      <PageHeader width="max-w-4xl" title="Statistik">
        <Seg value={range} onChange={setRange} options={[["12", "12 Monate"], ["all", "Gesamt"]]} />
      </PageHeader>
      <div className="mx-auto max-w-4xl space-y-5 px-4 sm:px-6">
        <HistoryTabs view="statistik" />
        {q.isError ? (
          <LoadError error={q.error} retry={() => q.refetch()} />
        ) : q.isPending ? (
          <div className="skeleton h-64 rounded-2xl" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {(
                [
                  ["Drucke", String(sum.prints)],
                  ["Druckzeit", sum.print_s >= 36_000 ? `${Math.round(sum.print_s / 3600).toLocaleString("de-DE")} h` : fmtDuration(sum.print_s)],
                  ["Erfolg", sum.rate == null ? "–" : `${sum.rate} %`],
                  ["Filament", fmtG(sum.grams)],
                  ["Kosten", cost.money(sum.cost)],
                ] as const
              ).map(([k, v], i) => (
                <Card key={k} className={`px-4 py-3 ${i === 4 ? "col-span-2 sm:col-span-1" : ""}`}>
                  <Label>{k}</Label>
                  <div className="mt-1 truncate text-xl font-extrabold tnum sm:text-2xl">{v}</div>
                </Card>
              ))}
            </div>
            {empty ? (
              <Card className="px-4 py-10 text-center text-sm text-ink3">In diesem Zeitraum gibt es noch keine Drucke.</Card>
            ) : (
              <>
                <Card className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-[15px] font-bold">Pro Monat</h2>
                    <div className="flex items-center gap-2">
                      {!table && <Seg value={metric} onChange={setMetric} options={[["grams", "Filament"], ["hours", "Druckzeit"], ["cost", "Kosten"]]} />}
                      <button onClick={() => setTable(!table)} className="h-8 rounded-lg px-2 text-[13px] font-semibold text-ink2 hover:bg-hover hover:text-ink">
                        {table ? "Diagramm" : "Tabelle"}
                      </button>
                    </div>
                  </div>
                  {table ? (
                    <MonthTable months={months} money={cost.money} />
                  ) : (
                    <BarChart
                      months={months}
                      value={value}
                      axis={axis}
                      tip={(m) => (
                        <>
                          <b>{monthLong(m.month)}</b>
                          <div className="tnum">{fmt(value(m))}</div>
                          <div className="text-ink3">{m.prints === 1 ? "1 Druck" : `${m.prints} Drucke`}</div>
                        </>
                      )}
                    />
                  )}
                </Card>
                <div className="grid gap-5 lg:grid-cols-2">
                  <Card className="space-y-4 p-4 sm:p-5">
                    <h2 className="text-[15px] font-bold">Ergebnis je Monat</h2>
                    <OutcomeChart months={months} />
                  </Card>
                  <Card className="space-y-4 p-4 sm:p-5">
                    <h2 className="text-[15px] font-bold">Verbrauch nach Material</h2>
                    {materials.length ? (
                      <div className="space-y-2.5">
                        {materials.map(([k, g]) => (
                          <div key={k} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-[13px]" title={`${k}: ${fmtG(g)}`}>
                            <span className="truncate font-semibold">{k}</span>
                            <div className="h-3 rounded-r bg-fill">
                              <div className="h-full rounded-r bg-accent" style={{ width: `${Math.max(1, (g / materials[0][1]) * 100)}%` }} />
                            </div>
                            <span className="text-ink2 tnum">
                              {fmtG(g)} <span className="text-ink3">· {Math.round((g / sum.grams) * 100)} %</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-sm text-ink3">Noch kein Verbrauch gebucht. Er entsteht, wenn ein Druck einer Spule zugeordnet wird.</div>
                    )}
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex rounded-lg bg-fill p-0.5">
      {options.map(([k, l]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`h-7 rounded-md px-2.5 text-[13px] font-semibold ${value === k ? "bg-[var(--c-seg-active)] text-ink shadow-seg" : "text-ink2"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Achsenbeschriftung: bei vielen Monaten bzw. schmalem Diagramm nur jede n-te, damit nichts überlappt */
function MonthAxis({ months, narrow }: { months: StatsMonth[]; narrow?: boolean }) {
  const step = months.length > 24 ? 6 : months.length > 12 ? 3 : narrow && months.length > 6 ? 2 : 1;
  return (
    <div className="flex gap-[2px] pl-12 text-[11px] text-ink3">
      {months.map((m, i) => (
        <div key={m.month} className={`min-w-0 flex-1 overflow-visible text-center whitespace-nowrap ${step === 1 && months.length > 6 && i % 2 ? "max-sm:invisible" : ""}`}>
          {i % step === 0 ? monthShort(m.month) : ""}
          {i % step === 0 && (i === 0 || m.month.endsWith("-01")) && <div className="text-[10px]">{m.month.slice(0, 4)}</div>}
        </div>
      ))}
    </div>
  );
}

function Plot({ max, axis, children }: { max: number; axis: (v: number) => string; children: ReactNode }) {
  return (
    <div className="relative h-44 pl-12">
      {[1, 0.5, 0].map((f) => (
        <div key={f} className="absolute right-0 left-12 border-t border-sep" style={{ bottom: `${f * 100}%` }}>
          <span className="absolute -top-2 right-full pr-2 text-[11px] whitespace-nowrap text-ink3 tnum">{axis(max * f)}</span>
        </div>
      ))}
      <div className="relative flex h-full items-end gap-[2px]">{children}</div>
    </div>
  );
}

function Tip({ show, left, children }: { show: boolean; left: number; children: ReactNode }) {
  if (!show) return null;
  // Am Rand nach innen klappen
  const pos = left < 0.2 ? "left-0" : left > 0.8 ? "right-0" : "left-1/2 -translate-x-1/2";
  return <div className={`pointer-events-none absolute bottom-full z-10 mb-2 rounded-lg bg-card px-2.5 py-1.5 text-xs whitespace-nowrap shadow-pop ${pos}`}>{children}</div>;
}

function BarChart({ months, value, axis, tip }: { months: StatsMonth[]; value: (m: StatsMonth) => number; axis: (v: number) => string; tip: (m: StatsMonth) => ReactNode }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...months.map(value)));
  return (
    <div className="space-y-1.5" onMouseLeave={() => setHover(null)}>
      <Plot max={max} axis={axis}>
        {months.map((m, i) => {
          const v = value(m);
          return (
            <div
              key={m.month}
              className="relative flex h-full min-w-0 flex-1 cursor-default items-end"
              onMouseEnter={() => setHover(i)}
              onClick={() => setHover(i)}
            >
              {hover === i && <div className="absolute inset-0 rounded bg-hover" />}
              <div className="relative mx-auto w-[78%] rounded-t bg-accent" style={{ height: v > 0 ? `max(2px, ${(v / max) * 100}%)` : 0 }} />
              <Tip show={hover === i} left={i / months.length}>
                {tip(m)}
              </Tip>
            </div>
          );
        })}
      </Plot>
      <MonthAxis months={months} />
    </div>
  );
}

const OUTCOME = [
  ["fertig", "Fertig", "bg-good"],
  ["abgebrochen", "Abgebrochen", "bg-warn"],
  ["fehler", "Fehler", "bg-bad"],
] as const;

/** Gestapelte Balken: fertig, abgebrochen, Fehler (Statusfarben, mit Legende) */
function OutcomeChart({ months }: { months: StatsMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = (m: StatsMonth) => m.fertig + m.abgebrochen + m.fehler;
  const max = niceMax(Math.max(...months.map(total)));
  return (
    <div className="space-y-3" onMouseLeave={() => setHover(null)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink2">
        {OUTCOME.map(([, l, c]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${c}`} />
            {l}
          </span>
        ))}
      </div>
      <div className="space-y-1.5">
        <Plot max={max} axis={(v) => (Number.isInteger(v) ? String(v) : "")}>
          {months.map((m, i) => {
            const t = total(m);
            return (
              <div
                key={m.month}
                className="relative flex h-full min-w-0 flex-1 cursor-default items-end"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              >
                {hover === i && <div className="absolute inset-0 rounded bg-hover" />}
                <div className="relative mx-auto flex w-[78%] flex-col-reverse gap-[2px] overflow-hidden rounded-t" style={{ height: `${(t / max) * 100}%` }}>
                  {OUTCOME.map(([k, , c]) => (m[k] ? <div key={k} className={c} style={{ flexGrow: m[k], flexBasis: 0 }} /> : null))}
                </div>
                <Tip show={hover === i} left={i / months.length}>
                  <b>{monthLong(m.month)}</b>
                  {OUTCOME.map(([k, l]) => (
                    <div key={k} className="tnum">
                      {l}: {m[k]}
                    </div>
                  ))}
                </Tip>
              </div>
            );
          })}
        </Plot>
        <MonthAxis months={months} narrow />
      </div>
    </div>
  );
}

function MonthTable({ months, money }: { months: StatsMonth[]; money: (v: number) => string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="w-full text-[13px] tnum">
        <thead className="text-left text-[11px] tracking-wide text-ink3 uppercase">
          <tr className="*:py-1.5 *:pr-3 *:font-semibold">
            <th>Monat</th>
            <th className="text-right">Drucke</th>
            <th className="text-right">Fertig</th>
            <th className="text-right">Druckzeit</th>
            <th className="text-right">Filament</th>
            <th className="text-right">Kosten</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sep">
          {[...months].reverse().map((m) => (
            <tr key={m.month} className="*:py-1.5 *:pr-3 *:whitespace-nowrap">
              <td className="font-semibold">{monthLong(m.month)}</td>
              <td className="text-right">{m.prints}</td>
              <td className="text-right">{m.fertig}</td>
              <td className="text-right">{m.print_s ? fmtDuration(m.print_s) : "–"}</td>
              <td className="text-right">{m.grams ? fmtG(m.grams) : "–"}</td>
              <td className="text-right">{m.cost_filament + m.cost_energy ? money(m.cost_filament + m.cost_energy) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
