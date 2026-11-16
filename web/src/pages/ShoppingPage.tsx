// Einkauf: Mindestbestand je Sorte oder Farbe; was darunter fällt, steht oben auf der Einkaufsliste mit Link zum Shop.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useState } from "react";
import { catalogBrand, catalogLine } from "../../../shared/catalog.ts";
import { GENERIC } from "../../../shared/colors.ts";
import { host, ruleMatches, ruleSub, ruleTitle, type StockRule, type StockRuleInput, type StockSource, type StockStatus } from "../../../shared/stock.ts";
import { fmtMoney, MATERIALS, type Spool, type SpoolInput } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader, useLive } from "../App.tsx";
import { useCatalog } from "../lib/catalog.ts";
import { useSetting } from "../lib/settings.ts";
import { useStock } from "../lib/stock.ts";
import { CatalogColors, SorteField } from "../ui/catalog.tsx";
import { Button, Card, Dialog, Field, Label, LoadError, Swatch, useToast } from "../ui/controls.tsx";
import { FilamentTabs } from "../ui/FilamentTabs.tsx";
import { FillBar, fmtG } from "../ui/spool.tsx";
import { SpoolDialog } from "./FilamentPage.tsx";

/** Vorlage fürs Nachkaufen: Angaben der letzten passenden Spule, sonst aus der Regel */
const presetOf = (x: StockStatus): Partial<SpoolInput> =>
  x.last
    ? {
        brand: x.last.brand, material: x.last.material, name: x.last.name, color: x.rule.color || x.last.color, color_name: x.rule.color_name || x.last.color_name,
        net_g: x.last.net_g, tare_g: x.last.tare_g, price: x.last.price, profile_id: x.last.profile_id, nozzle_min: x.last.nozzle_min, nozzle_max: x.last.nozzle_max,
        bed_temp: x.last.bed_temp, dry_temp: x.last.dry_temp, dry_hours: x.last.dry_hours, url: x.last.url, location: x.last.location,
      }
    : { brand: x.rule.brand, material: x.rule.material || "PLA", name: x.rule.line, color: x.rule.color, color_name: x.rule.color_name, url: x.rule.url };

export function ShoppingPage() {
  const { rules, spools, list, low } = useStock();
  const live = useLive();
  const [edit, setEdit] = useState<StockRule | Partial<StockRuleInput> | null>(null);
  const [buy, setBuy] = useState<Partial<SpoolInput> | null>(null);
  const ok = list.filter((x) => !x.low);

  return (
    <>
      <PageHeader
        title="Einkauf"
        sub={rules.data?.length ? (low.length ? `${low.length} unter Mindestbestand` : "Alles vorrätig") : undefined}
      >
        <Button kind="primary" onClick={() => setEdit({})}>
          <Plus size={16} /> Mindestbestand
        </Button>
      </PageHeader>
      <FilamentTabs view="einkauf" />
      <div className="mx-auto max-w-6xl space-y-6 px-4 sm:px-6 2xl:max-w-[88rem]">
        {rules.isError ? (
          <LoadError error={rules.error} retry={() => rules.refetch()} />
        ) : rules.isPending || spools.isPending ? (
          <div className="skeleton h-40 rounded-2xl" />
        ) : !list.length ? (
          <Card className="p-8 text-center">
            <ShoppingCart size={28} className="mx-auto text-ink3" />
            <div className="mt-2 text-lg font-bold">Noch kein Mindestbestand</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink2">
              Lege fest, wie viel mindestens im Regal stehen soll, etwa „Rot, PLA, 1 kg“, egal von welcher Marke. Fällt der Rest aller passenden Spulen
              darunter, landet es hier auf der Einkaufsliste, mit allen Shops, in denen du es schon gekauft hast, und dem letzten Preis.
            </p>
            <Button kind="primary" className="mt-4" onClick={() => setEdit({})}>
              <Plus size={16} /> Ersten Mindestbestand anlegen
            </Button>
          </Card>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="px-1 text-lg font-extrabold tracking-tight">Einkaufsliste</h2>
              {low.length ? (
                <Card className="divide-y divide-sep px-4">
                  {low.map((x) => (
                    <RuleRow key={x.rule.id} x={x} onEdit={() => setEdit(x.rule)} onBuy={() => setBuy(presetOf(x))} />
                  ))}
                </Card>
              ) : (
                <Card className="px-4 py-6 text-center text-sm text-ink3">Nichts nachzukaufen, alle Mindestbestände sind gedeckt.</Card>
              )}
            </section>
            {ok.length > 0 && (
              <section className="space-y-2">
                <h2 className="px-1 text-lg font-extrabold tracking-tight">Vorrätig</h2>
                <Card className="divide-y divide-sep px-4">
                  {ok.map((x) => (
                    <RuleRow key={x.rule.id} x={x} onEdit={() => setEdit(x.rule)} onBuy={() => setBuy(presetOf(x))} />
                  ))}
                </Card>
              </section>
            )}
          </>
        )}
      </div>
      {edit && <RuleDialog key={"id" in edit ? edit.id : "neu"} rule={edit} spools={spools.data ?? []} onClose={() => setEdit(null)} />}
      {buy && <SpoolDialog s={null} preset={buy} all={spools.data ?? []} live={live.data ?? []} onClose={() => setBuy(null)} onCopy={setBuy} />}
    </>
  );
}

function RuleRow({ x, onEdit, onBuy }: { x: StockStatus; onEdit: () => void; onBuy: () => void }) {
  const r = x.rule;
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
          {r.color ? <Swatch color={r.color} size={28} /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill text-[10px] font-black text-ink3">alle</span>}
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{ruleTitle(r)}</div>
            <div className="truncate text-xs text-ink3">{ruleSub(r)}</div>
          </div>
        </div>
        <div className="w-full min-w-40 sm:w-56">
          <div className="flex justify-between text-xs tnum">
            <span className={x.low ? "font-bold text-bad" : "font-semibold text-ink2"}>
              {fmtG(x.stock_g)}
              {x.spools > 1 ? ` · ${x.spools} Spulen` : x.spools === 1 ? " · 1 Spule" : ""}
            </span>
            <span className="text-ink3">mind. {fmtG(r.min_g)}</span>
          </div>
          <FillBar fraction={Math.min(1, x.stock_g / r.min_g)} color={r.color || "var(--c-accent)"} low={x.low} className="mt-1" />
        </div>
        <div className="flex items-center gap-1.5">
          <Button kind="ghost" onClick={onBuy} title="Gekaufte Spule ins Regal stellen">
            <Plus size={15} /> Gekauft
          </Button>
          <button onClick={onEdit} className="grid size-9 place-items-center rounded-lg text-ink2 hover:bg-hover" aria-label="Mindestbestand ändern">
            <Pencil size={15} />
          </button>
        </div>
      </div>
      {x.sources.length > 0 && <Sources sources={x.sources} />}
    </div>
  );
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });

/** Bezugsquellen nach Shop: je Produkt zuletzt gezahlter Preis, Preis je kg und Datum; der günstigste je kg ist hervorgehoben */
function Sources({ sources }: { sources: StockSource[] }) {
  const cur = useSetting<string>("filament", "currency");
  const groups = new Map<string, StockSource[]>();
  for (const src of sources) groups.set(src.host, [...(groups.get(src.host) ?? []), src]);
  return (
    <div className="mt-2 grid gap-1.5 sm:pl-10 lg:grid-cols-2">
      {[...groups].map(([h, list]) => (
        <div key={h} className={`min-w-0 rounded-lg bg-fill px-3 py-2 text-xs ${list.some((x) => x.cheapest) ? "ring-1 ring-accent" : ""}`}>
          <a href={list[0]!.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 font-bold hover:underline">
            <ExternalLink size={13} className="shrink-0 text-ink3" />
            <span className="truncate">{h}</span>
            {list.some((x) => x.cheapest) && <span className="ml-auto shrink-0 text-[10px] font-black tracking-[0.08em] text-accent uppercase">günstigster</span>}
          </a>
          {list.map((src) => (
            <a
              key={src.url}
              href={src.url}
              target="_blank"
              rel="noreferrer"
              title={[src.count > 1 ? `${src.count}× dort gekauft` : "", src.net_g && src.price != null ? `${fmtMoney(src.price, cur)} für ${fmtG(src.net_g)}` : "", src.url].filter(Boolean).join("\n")}
              className="mt-1 flex items-baseline gap-x-2 text-ink2 hover:text-ink"
            >
              <span className="min-w-0 flex-1 truncate">
                {src.label || (src.kind === "eigen" ? "Eigener Shop-Link" : "Shop der Marke (Katalog)")}
                {src.count > 1 && <span className="text-ink3"> · {src.count}×</span>}
              </span>
              {src.price != null && <span className="shrink-0 font-semibold text-ink tnum">{fmtMoney(src.price, cur)}</span>}
              {src.per_g != null && (
                <span className={`shrink-0 tnum ${src.cheapest ? "font-bold text-accent" : "text-ink3"}`}>{fmtMoney(src.per_g * 1000, cur)}/kg</span>
              )}
              {src.date && <span className="shrink-0 text-ink3 tnum">{fmtDate(src.date)}</span>}
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Mindestbestand anlegen oder ändern; aus dem Spulendialog vorbelegt mit Marke, Sorte und Farbe der Spule */
export function RuleDialog({ rule, spools, onClose }: { rule: StockRule | Partial<StockRuleInput>; spools: Spool[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const netDefault = useSetting<number>("filament", "net_g");
  useCatalog();
  const id = "id" in rule ? rule.id : null;
  const [v, setV] = useState({
    brand: rule.brand ?? "",
    line: rule.line ?? "",
    material: rule.material ?? "PLA",
    color: rule.color ?? "",
    color_name: rule.color_name ?? "",
    min_g: rule.min_g != null ? String(rule.min_g) : String(netDefault),
    url: rule.url ?? "",
  });
  const done = () => (void qc.invalidateQueries({ queryKey: ["stock"] }), onClose());
  const save = useMutation({
    mutationFn: () => {
      const b: StockRuleInput = {
        brand: v.brand.trim(),
        line: v.line.trim(),
        material: v.material.trim(),
        color: v.color,
        color_name: v.color_name.trim(),
        min_g: Number(v.min_g.replace(",", ".")) || 0,
        url: v.url.trim(),
      };
      return id ? api.updateStockRule(id, b) : api.addStockRule(b);
    },
    onSuccess: () => (toast(id ? "Mindestbestand gesichert" : "Mindestbestand angelegt"), done()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const del = useMutation({ mutationFn: () => api.deleteStockRule(id!), onSuccess: done, onError: (e) => toast((e as Error).message, "fehler") });

  const brands = [...new Set([...spools.map((s) => s.brand).filter(Boolean)])];
  const scope = { brand: v.brand, line: v.line, material: v.material, color: "", color_name: "" };
  // Eigene Farbtöne (Herstellernamen), die es in dieser Auswahl schon im Regal gab, auch leere
  const own = new Map<string, Spool>();
  for (const s of spools) {
    if (!ruleMatches(scope, s) || GENERIC.some((g) => g[1] === s.color_name)) continue; // Grundfarben stehen schon oben
    const k = (s.color_name || s.color).toLowerCase();
    if (!own.has(k)) own.set(k, s);
  }
  const allColors = !v.color && !v.color_name;
  const generic = GENERIC.find((g) => g[1] === v.color_name);
  const matching = spools.filter((s) => ruleMatches({ ...scope, color: v.color, color_name: v.color_name.trim() }, s));
  const net = spools.find((s) => s.brand === v.brand && s.name === v.line)?.net_g ?? netDefault;
  const shop = v.brand ? catalogBrand(v.brand)?.url : undefined;
  const quick: [string, number][] =
    net === 1000
      ? [["500 g", 500], ["1 kg", 1000], ["2 kg", 2000], ["3 kg", 3000]]
      : [["1 kg", 1000], ["2 kg", 2000], ["½ Spule", Math.round(net / 2)], ["1 Spule", net], ["2 Spulen", net * 2]];
  const chip = (on: boolean) => `flex h-7 items-center gap-1.5 rounded-full bg-card text-xs font-semibold shadow-seg ${on ? "ring-2 ring-accent" : ""}`;

  return (
    <Dialog title={id ? "Mindestbestand ändern" : "Mindestbestand"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <Label>Farbe</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setV({ ...v, color: "", color_name: "" })} className={`${chip(allColors)} px-2.5`}>
              Alle Farben
            </button>
            {GENERIC.map(([hex, name]) => (
              <button type="button" key={name} onClick={() => setV({ ...v, color: `#${hex}`, color_name: name })} className={`${chip(v.color_name === name)} pr-2.5 pl-1`}>
                <Swatch color={`#${hex}`} size={20} />
                {name}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-ink3">
            {generic
              ? `„${generic[1]}“ zählt alle Spulen in diesem Farbton, auch hellere und dunklere.`
              : "Eine Grundfarbe zählt alle passenden Spulen, unten geht es auch genau auf einen Farbton."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Marke" required={false}>
            <input className="field" value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })} list="rule-brands" placeholder="leer = alle Marken" />
          </Field>
          <Field label="Sorte" required={false}>
            <SorteField
              className="field"
              brand={v.brand}
              value={v.line}
              onText={(line) => setV({ ...v, line })}
              onLine={(l) => setV({ ...v, line: l.name, material: l.material })}
              placeholder="leer = alle Sorten"
            />
          </Field>
        </div>
        <datalist id="rule-brands">
          {brands.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        {!catalogLine(v.brand, v.line) && (
          <Field label="Material" required={false}>
            <input className="field" value={v.material} onChange={(e) => setV({ ...v, material: e.target.value })} list="rule-materials" placeholder="leer = alle Materialien" />
            <datalist id="rule-materials">
              {MATERIALS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
        )}
        {(own.size > 0 || catalogLine(v.brand, v.line)) && (
          <div>
            <Label>Genauer Farbton</Label>
            {own.size > 0 && (
              <div className="mt-1.5 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto overscroll-contain p-0.5">
                {[...own.values()].map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setV({ ...v, color: s.color, color_name: s.color_name })}
                    className={`${chip(v.color_name === s.color_name && v.color === s.color)} pr-2.5 pl-1`}
                  >
                    <Swatch color={s.color} size={20} />
                    {s.color_name || s.color}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 empty:hidden">
              <CatalogColors brand={v.brand} line={v.line} colorName={v.color_name} onPick={(color_name, hex) => setV({ ...v, color_name, color: `#${hex}` })} />
            </div>
          </div>
        )}
        <Field label="Mindestens (g)" hint="Zählt den Rest aller passenden Spulen im Regal, auch eingeschweißte.">
          <input className="field tnum" inputMode="decimal" value={v.min_g} onChange={(e) => setV({ ...v, min_g: e.target.value })} required />
        </Field>
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {quick.map(([label, g]) => (
            <button type="button" key={label} onClick={() => setV({ ...v, min_g: String(g) })} className={`${chip(Number(v.min_g) === g)} px-2.5 hover:bg-fill`}>
              {label}
            </button>
          ))}
        </div>
        <p className="-mt-1 text-xs text-ink2">
          Passt auf {matching.length === 1 ? "1 Spule" : `${matching.length} Spulen`}
          {matching.length > 0 && `, davon ${matching.filter((s) => !s.archived && s.remaining_g > 0).length} mit Rest im Regal`}.
        </p>
        <Field label="Shop-Link" required={false} hint={shop ? `Optional. Die Shops gekaufter Spulen stehen ohnehin dabei, sonst ${host(shop)} aus dem Katalog.` : "Optional. Die Shops gekaufter Spulen stehen ohnehin dabei."}>
          <input className="field" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} inputMode="url" placeholder="https://…" />
        </Field>
        <div className="flex items-center justify-between gap-2 pt-1">
          {id ? (
            <Button type="button" kind="ghost" className="text-bad" onClick={() => del.mutate()} busy={del.isPending}>
              <Trash2 size={15} /> Löschen
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={onClose}>
              Abbrechen
            </Button>
            <Button kind="primary" busy={save.isPending}>
              Sichern
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
