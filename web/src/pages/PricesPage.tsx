// Preis-Leistung: Shoppreise der gängigen Sorten je kg, je Vergleichsgruppe als Preisleiste und Rangliste, daneben die Kennwerte
// aus dem Datenblatt (Festigkeit, Wärme) und was der Nutzer für eigene Spulen dieser Sorte gezahlt hat.
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Info, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CatalogBrand, CatalogLine } from "../../../shared/catalog.ts";
import { catalogLine } from "../../../shared/catalog.ts";
import { perKg, PRICE_GROUPS, priceGroup, type LinePrice, type PriceGroup } from "../../../shared/prices.ts";
import { fmtSpec } from "../../../shared/specs.ts";
import { host } from "../../../shared/stock.ts";
import { pricePerG } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { useCatalog } from "../lib/catalog.ts";
import { href, slug } from "../lib/router.ts";
import { Card, Label, LoadError } from "../ui/controls.tsx";
import { chipCls, FilamentTabs } from "../ui/FilamentTabs.tsx";
import { reducedMotion, SpoolArt } from "../ui/spool.tsx";

type Entry = {
  brand: CatalogBrand;
  line: CatalogLine;
  price: LinePrice;
  kg: number; // € je kg
  group: PriceGroup;
  owned: number; // Spulen im Regal (nicht archiviert)
  paid: number | null; // selbst gezahlt, Median € je kg aller eigenen Spulen dieser Sorte
};

/** Platz mit Gleichstand: gleich teure Sorten teilen sich den Platz */
const place = (list: Entry[], e: Entry) => 1 + list.filter((x) => x.kg < e.kg - 0.005).length;
const eur = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};
/** Farbe für die kleine Spule: erste bunte Farbe der Sorte, sonst die erste */
const lineColor = (l: CatalogLine) => {
  const hex = l.colors.find((c) => !/^(000000|FFFFFF)$/.test(c.hex))?.hex ?? l.colors[0]?.hex;
  return hex ? `#${hex}` : "#9a9a9a";
};

function useEntries() {
  const cat = useCatalog();
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools });
  const entries = useMemo(() => {
    const own = new Map<number, { n: number; kg: number[] }>();
    for (const s of spools.data ?? []) {
      const l = catalogLine(s.brand, s.name);
      if (!l) continue;
      const o = own.get(l.id) ?? { n: 0, kg: [] };
      if (!s.archived) o.n++;
      const g = pricePerG(s);
      if (g != null) o.kg.push(g * 1000);
      own.set(l.id, o);
    }
    const out: Entry[] = [];
    for (const brand of cat.data ?? [])
      for (const line of brand.lines) {
        const group = priceGroup(line);
        if (!line.price || !group) continue;
        const o = own.get(line.id);
        out.push({ brand, line, price: line.price, kg: perKg(line.price), group, owned: o?.n ?? 0, paid: o?.kg.length ? median(o.kg) : null });
      }
    return out.sort((a, b) => a.kg - b.kg);
  }, [cat.data, spools.data]);
  return { cat, entries };
}

export function PricesPage() {
  const { cat, entries } = useEntries();
  const [group, setGroup] = useState<PriceGroup | null>(null);
  const groups = PRICE_GROUPS.filter((g) => entries.some((e) => e.group === g.id));
  const date = entries[0]?.price.date;
  const shown = groups.filter((g) => !group || g.id === group);
  return (
    <>
      <PageHeader
        title="Preis-Leistung"
        sub={
          entries.length
            ? `${entries.length} Sorten aus ${new Set(entries.map((e) => e.brand.id)).size} Marken · Shoppreise vom ${date?.split("-").reverse().join(".")}`
            : undefined
        }
      />
      <FilamentTabs view="preise" />
      <div className="mx-auto max-w-6xl space-y-4 px-4 pb-10 sm:px-6 2xl:max-w-[88rem]">
        {cat.isError ? (
          <LoadError error={cat.error} retry={() => cat.refetch()} />
        ) : cat.isPending ? (
          <div className="skeleton h-72 rounded-2xl" />
        ) : !entries.length ? (
          <Card className="py-10 text-center text-sm text-ink3">Noch keine Preise hinterlegt.</Card>
        ) : (
          <>
            <Mine entries={entries} />
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
              <button className={chipCls(!group)} onClick={() => setGroup(null)}>
                Alle
              </button>
              {groups.map((g) => (
                <button key={g.id} className={chipCls(group === g.id)} onClick={() => setGroup(group === g.id ? null : g.id)}>
                  {g.label} <span className="opacity-55">{entries.filter((e) => e.group === g.id).length}</span>
                </button>
              ))}
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {shown.map((g) => (
                <GroupCard key={g.id} label={g.label} info={g.info} list={entries.filter((e) => e.group === g.id)} />
              ))}
            </div>
            <p className="flex gap-1.5 text-xs leading-relaxed text-ink3">
              <Info size={14} className="mt-0.5 shrink-0" />
              Preis der günstigsten Einzelspule im offiziellen Shop für Deutschland, inkl. MwSt. ohne Versand, einmal recherchiert. Aktionen und
              Mehrfachpacks ändern das schnell, der Link führt zum aktuellen Preis. Festigkeit und Wärme stammen aus dem Datenblatt (gedruckte Probekörper),
              soweit eins hinterlegt ist.
            </p>
          </>
        )}
      </div>
    </>
  );
}

/** Eigene Sorten oben: Platz in ihrer Gruppe und die günstigere Alternative */
function Mine({ entries }: { entries: Entry[] }) {
  const mine = entries.filter((e) => e.owned > 0 || e.paid != null);
  if (!mine.length) return null;
  return (
    <Card className="p-4 sm:p-5">
      <Label>Deine Sorten im Vergleich</Label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {mine.map((e) => {
          const list = entries.filter((x) => x.group === e.group);
          const pos = place(list, e);
          const best = list[0]!;
          const g = PRICE_GROUPS.find((x) => x.id === e.group)!;
          return (
            <div key={e.line.id} className="flex gap-3 rounded-xl bg-fill/60 p-3">
              <SpoolArt color={lineColor(e.line)} fraction={1} className="size-11 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-extrabold">
                  {e.brand.brand} {e.line.name}
                </div>
                <div className="text-xs text-ink2">
                  <span className="font-bold text-ink tnum">{eur(e.kg)}/kg</span> · Platz {pos} von {list.length} bei {g.label}
                </div>
                <div className="mt-1 text-xs text-ink3">
                  {pos === 1 ? (
                    <span className="font-semibold text-good">
                      {list.filter((x) => place(list, x) === 1).length > 1 ? "Gleichauf mit der günstigsten Sorte" : "Günstigste Sorte der Gruppe"}
                    </span>
                  ) : (
                    <>
                      Günstiger: <span className="font-semibold text-ink2">{best.brand.brand} {best.line.name}</span>{" "}
                      <span className="tnum">{eur(best.kg)}/kg</span> <span className="font-semibold text-good tnum">−{eur(e.kg - best.kg)}</span>
                    </>
                  )}
                </div>
                {e.paid != null && <div className="mt-0.5 text-xs text-ink3 tnum">Du zahlst ⌀ {eur(e.paid)}/kg</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Schiebt Balken und Punkte nach dem ersten Bild an ihren Platz (ohne Animation bei reduzierter Bewegung) */
function useShown() {
  const [on, setOn] = useState(reducedMotion());
  useEffect(() => {
    const t = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(t);
  }, []);
  return on;
}

function GroupCard({ label, info, list }: { label: string; info: string; list: Entry[] }) {
  const on = useShown();
  const lo = list[0]!.kg;
  const hi = list.at(-1)!.kg;
  const med = median(list.map((e) => e.kg));
  // Skala mit etwas Rand, damit die Punkte nicht am Ende kleben
  const pad = Math.max(1, (hi - lo) * 0.08);
  const x = (v: number) => ((v - (lo - pad)) / (hi + pad - (lo - pad))) * 100;
  const strong = list.map((e) => e.line.specs?.values.tensile_strength?.v).filter((v): v is number => v != null);
  const warm = list.map((e) => e.line.specs?.values.hdt_045?.v).filter((v): v is number => v != null);
  return (
    <Card className="overflow-hidden">
      <div className="p-4 pb-3 sm:p-5 sm:pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0">
            <div className="text-base font-extrabold">{label}</div>
            <div className="truncate text-xs text-ink3">{info}</div>
          </div>
          <div className="shrink-0 text-right text-xs text-ink3">
            Median <span className="font-bold text-ink2 tnum">{eur(med)}/kg</span>
          </div>
        </div>
        {/* Preisleiste: jede Sorte ein Punkt, eigene als Spule */}
        <div className="relative mt-5 mb-1 h-9" aria-hidden>
          <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-gradient-to-r from-[var(--c-green)]/50 via-fill2 to-[var(--c-red)]/45" />
          <div className="absolute top-2.5 h-4.5 w-px bg-ink3" style={{ left: `${x(med)}%` }} />
          {list.map((e, i) => (
            <span
              key={e.line.id}
              title={`${e.brand.brand} ${e.line.name}: ${eur(e.kg)}/kg`}
              className={`absolute top-[1.2rem] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-[left] duration-700 ease-out ${
                e.owned ? "z-10 size-4 bg-accent" : "size-2.5 bg-ink3"
              }`}
              style={{ left: `${on ? x(e.kg) : x(lo - pad)}%`, transitionDelay: `${i * 40}ms`, background: e.owned ? undefined : lineColor(e.line) }}
            />
          ))}
          <span className="absolute -bottom-1.5 left-0 text-[10.5px] font-semibold text-ink3 tnum">{eur(lo)}</span>
          <span className="absolute right-0 -bottom-1.5 text-[10.5px] font-semibold text-ink3 tnum">{eur(hi)}</span>
        </div>
      </div>
      <ol className="divide-y divide-sep border-t border-sep">
        {list.map((e, i) => (
          <Row key={e.line.id} e={e} pos={place(list, e)} best={place(list, e) === 1} delay={i} width={on ? (e.kg / hi) * 100 : 0} strongMax={Math.max(...strong, 0)} warmMax={Math.max(...warm, 0)} />
        ))}
      </ol>
    </Card>
  );
}

function Row({ e, pos, best, delay, width, strongMax, warmMax }: {
  e: Entry; pos: number; best: boolean; delay: number; width: number; strongMax: number; warmMax: number;
}) {
  const p = e.price;
  const ts = e.line.specs?.values.tensile_strength?.v;
  const hdt = e.line.specs?.values.hdt_045?.v;
  const sheet = e.line.specs ? href({ page: "filament", view: "kennwerte", brand: slug(e.brand.brand), line: slug(e.line.name) }) : null;
  return (
    <li className={`grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-5 ${e.owned ? "bg-accent/[0.06]" : ""}`}>
      <span className={`text-center text-sm font-extrabold tnum ${best ? "text-good" : "text-ink3"}`}>{best ? <Trophy size={15} className="mx-auto" /> : pos}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <a href={href({ page: "filament", view: "katalog", brand: slug(e.brand.brand) })} className="truncate text-sm font-bold hover:text-accent">
            {e.brand.brand} <span className="font-semibold text-ink2">{e.line.name}</span>
          </a>
          {e.owned > 0 && <span className="shrink-0 rounded-full bg-accent px-1.5 text-[10.5px] leading-[17px] font-bold text-on-accent">im Regal {e.owned}</span>}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill2">
          <div
            className={`h-full rounded-full transition-[width] duration-700 ease-out ${best ? "bg-[var(--c-green)]" : e.owned ? "bg-accent" : "bg-ink3/60"}`}
            style={{ width: `${width}%`, transitionDelay: `${delay * 35}ms` }}
          />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink3">
          <span className="tnum">
            {eur(p.price)} · {p.net_g >= 1000 ? `${(p.net_g / 1000).toLocaleString("de-DE")} kg` : `${p.net_g} g`}
            {p.regular != null && p.regular > p.price && <s className="ml-1 opacity-70">{eur(p.regular)}</s>}
            {p.refill != null && <span> · Refill {eur(p.refill)}</span>}
          </span>
          {ts != null && (
            <Spec href={sheet} label="Zug" value={fmtSpec("tensile_strength", ts)} unit="MPa" top={ts === strongMax && strongMax > 0} />
          )}
          {hdt != null && <Spec href={sheet} label="HDT" value={fmtSpec("hdt_045", hdt)} unit="°C" top={hdt === warmMax && warmMax > 0} />}
          {e.paid != null && <span className="tnum">du ⌀ {eur(e.paid)}/kg</span>}
          {p.note && (
            <span className="line-clamp-1 w-full text-ink3/80" title={p.note}>
              {p.note}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 self-start">
        <div className="text-right">
          <div className={`text-sm font-extrabold tnum ${best ? "text-good" : ""}`}>{eur(e.kg)}</div>
          <div className="text-[10.5px] font-semibold text-ink3">je kg</div>
        </div>
        <a href={p.url} target="_blank" rel="noreferrer" title={`Shop: ${host(p.url)}`} className="-mr-1.5 flex size-8 items-center justify-center rounded-full text-ink3 hover:bg-fill hover:text-accent">
          <ExternalLink size={14} />
        </a>
      </div>
    </li>
  );
}

function Spec({ href: to, label, value, unit, top }: { href: string | null; label: string; value: string; unit: string; top: boolean }) {
  const body = (
    <>
      {label} <span className={`font-bold tnum ${top ? "text-good" : "text-ink2"}`}>{value}</span> {unit}
    </>
  );
  return to ? (
    <a href={to} className="hover:text-ink" title="Datenblatt">
      {body}
    </a>
  ) : (
    <span>{body}</span>
  );
}
