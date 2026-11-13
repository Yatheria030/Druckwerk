// Farbkatalog: Marken mit ihren Sorten und Farben (Name, Hex, Herstellercode) aus der Datenbank, hier einsehbar und pflegbar.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { catalogBrand, type CatalogBrand, type CatalogColor, type CatalogLine } from "../../../shared/catalog.ts";
import { profileById, PROFILES } from "../../../shared/profiles.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { useCatalog } from "../lib/catalog.ts";
import { go, href, slug } from "../lib/router.ts";
import { Button, Card, Dialog, Field, Label, LoadError, useToast } from "../ui/controls.tsx";
import { chipCls, FilamentTabs } from "../ui/FilamentTabs.tsx";

const norm = (s: string) => s.toLowerCase().trim();
/** Grundmaterial für Gruppen und Filter: PA6-CF → PA, ASA-Aero → ASA, PETG bleibt */
const baseMat = (m: string) => m.split("-")[0]!.replace(/(?<=[A-Z])\d+$/, "") || m;
const colorCount = (b: CatalogBrand) => b.lines.reduce((n, l) => n + l.colors.length, 0);

/** Farbpunkt; ohne bekannten Farbcode gestrichelt mit „?“ */
function Dot({ hex, size = "size-5" }: { hex: string | null; size?: string }) {
  return hex ? (
    <span className={`${size} shrink-0 rounded-full`} style={{ background: `#${hex}`, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)" }} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full border border-dashed border-ink3 text-[10px] font-black text-ink3`}>?</span>
  );
}

type Edit =
  | { kind: "brand"; brand: CatalogBrand | null }
  | { kind: "line"; brandId: number; line: CatalogLine | null }
  | { kind: "color"; lineId: number; color: CatalogColor | null };

export function CatalogPage({ brand }: { brand?: string }) {
  const q = useCatalog();
  const spools = useQuery({ queryKey: ["spools"], queryFn: api.spools });
  const [edit, setEdit] = useState<Edit | null>(null);
  const b = brand ? q.data?.find((x) => slug(x.brand) === brand) : undefined;

  /** Eigene Spulen im Regal je Marke (`<id>`) und Sorte (`<id>|<sorte>`), Marke über ihr Stichwort wie bei den Farbnamen */
  const owned = useMemo(() => {
    const m = new Map<string, number>();
    const add = (k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const s of spools.data ?? []) {
      const cb = s.archived ? undefined : catalogBrand(s.brand);
      if (cb) (add(String(cb.id)), add(`${cb.id}|${norm(s.name)}`));
    }
    return m;
  }, [spools.data, q.data]);

  return (
    <>
      <PageHeader
        title={b ? b.brand : "Farbkatalog"}
        back={
          b && (
            <a href={href({ page: "filament", view: "katalog" })} className="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-ink3 hover:text-ink">
              <ChevronLeft size={16} /> Katalog
            </a>
          )
        }
      >
        {b ? (
          <>
            <Button onClick={() => setEdit({ kind: "brand", brand: b })}>
              <Pencil size={15} /> Marke
            </Button>
            <Button kind="primary" onClick={() => setEdit({ kind: "line", brandId: b.id, line: null })}>
              <Plus size={16} /> Sorte
            </Button>
          </>
        ) : (
          <Button kind="primary" onClick={() => setEdit({ kind: "brand", brand: null })}>
            <Plus size={16} /> Marke
          </Button>
        )}
      </PageHeader>
      <FilamentTabs view="katalog" brand={brand} />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 2xl:max-w-[88rem]">
        {q.isError ? (
          <LoadError error={q.error} retry={() => q.refetch()} />
        ) : q.isPending ? (
          <div className="skeleton h-72 rounded-2xl" />
        ) : brand && !b ? (
          <Card className="py-10 text-center text-sm text-ink3">Diese Marke steht nicht (mehr) im Katalog.</Card>
        ) : b ? (
          <BrandView b={b} owned={owned} onEdit={setEdit} />
        ) : (
          <Overview brands={q.data} owned={owned} />
        )}
      </div>
      {edit?.kind === "brand" && <BrandDialog brand={edit.brand} onClose={() => setEdit(null)} />}
      {edit?.kind === "line" && <LineDialog brandId={edit.brandId} line={edit.line} onClose={() => setEdit(null)} />}
      {edit?.kind === "color" && <ColorDialog lineId={edit.lineId} color={edit.color} onClose={() => setEdit(null)} />}
    </>
  );
}

/** Alle Marken als Karten mit Farbstreifen; die Suche findet Farben über alle Marken (Name, Hex, Code) */
function Overview({ brands, owned }: { brands: CatalogBrand[]; owned: Map<string, number> }) {
  const [search, setSearch] = useState("");
  const t = norm(search).replace(/^#/, "");
  const hits = t
    ? brands.flatMap((b) =>
        b.lines.flatMap((l) =>
          l.colors.filter((c) => [c.name, c.hex ?? "", c.code ?? "", l.name].some((x) => norm(x).includes(t))).map((c) => ({ b, l, c })),
        ),
      )
    : [];
  return (
    <div className="space-y-5">
      <SearchBox value={search} onChange={setSearch} placeholder="Farbe, Hex oder Code in allen Marken …" />
      {t ? (
        <Card className="divide-y divide-sep overflow-hidden">
          {hits.length === 0 && <div className="py-10 text-center text-sm text-ink3">Keine Farbe gefunden.</div>}
          {hits.slice(0, 200).map(({ b, l, c }) => (
            <a key={c.id} href={href({ page: "filament", view: "katalog", brand: slug(b.brand) })} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover">
              <Dot hex={c.hex} size="size-7" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{c.name}</div>
                <div className="truncate text-xs text-ink3">
                  {b.brand} · {l.name}
                </div>
              </div>
              <div className="shrink-0 text-right font-mono text-xs text-ink2">
                {c.hex ? `#${c.hex}` : "–"}
                {c.code && <div className="text-ink3">{c.code}</div>}
              </div>
            </a>
          ))}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {brands.map((b) => {
            const strip = b.lines.flatMap((l) => l.colors).filter((c) => c.hex);
            const mine = owned.get(String(b.id)) ?? 0;
            return (
              <a key={b.id} href={href({ page: "filament", view: "katalog", brand: slug(b.brand) })} className="group block">
                <Card className="overflow-hidden transition-transform group-hover:-translate-y-0.5">
                  <div className="flex h-10">
                    {strip.length ? (
                      strip.slice(0, 48).map((c) => <span key={c.id} className="flex-1" style={{ background: `#${c.hex}` }} />)
                    ) : (
                      <span className="flex-1 bg-fill" />
                    )}
                  </div>
                  <div className="p-4">
                    <div className="text-lg font-extrabold tracking-tight">{b.brand}</div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {(
                        [
                          ["Sorten", b.lines.length],
                          ["Farben", colorCount(b)],
                          ["Im Regal", mine],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k}>
                          <Label>{k}</Label>
                          <div className="text-base font-extrabold tnum">{v}</div>
                        </div>
                      ))}
                    </div>
                    {b.source && <p className="mt-2 line-clamp-2 text-xs text-ink3">Quelle: {b.source}</p>}
                  </div>
                </Card>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-card px-3 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
      <Search size={15} className="shrink-0 text-ink3" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
    </label>
  );
}

/** Eine Marke: Sorten nach Material, je Sorte die Farben als Chips mit Hex und Code */
function BrandView({ b, owned, onEdit }: { b: CatalogBrand; owned: Map<string, number>; onEdit: (e: Edit) => void }) {
  const [search, setSearch] = useState("");
  const [mat, setMat] = useState<string | null>(null);
  const materials = [...new Set(b.lines.map((l) => baseMat(l.material)))];
  const t = norm(search).replace(/^#/, "");
  const lines = b.lines
    .filter((l) => !mat || baseMat(l.material) === mat)
    .map((l) => ({
      l,
      colors: t && !norm(l.name).includes(t) ? l.colors.filter((c) => [c.name, c.hex ?? "", c.code ?? ""].some((x) => norm(x).includes(t))) : l.colors,
    }))
    .filter(({ l, colors }) => !t || colors.length || norm(l.name).includes(t));
  const groups = materials.filter((m) => lines.some(({ l }) => baseMat(l.material) === m));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink3">
        <span>
          {b.lines.length} Sorten · {colorCount(b)} Farben · Spulen mit „{b.match}“ in der Marke gehören dazu
        </span>
        {b.url && (
          <a href={b.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent">
            Shop <ExternalLink size={12} />
          </a>
        )}
        {b.source && <span className="basis-full">Quelle: {b.source}</span>}
      </div>
      <div className="space-y-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Sorte, Farbe, Hex oder Code …" />
        <div className="-mx-4 -mt-0.5 flex gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
          <button className={chipCls(!mat)} onClick={() => setMat(null)}>
            Alle
          </button>
          {materials.map((m) => (
            <button key={m} className={chipCls(mat === m)} onClick={() => setMat(mat === m ? null : m)}>
              {m} <span className="opacity-55">{b.lines.filter((l) => baseMat(l.material) === m).length}</span>
            </button>
          ))}
        </div>
      </div>
      {!lines.length && <Card className="py-10 text-center text-sm text-ink3">{b.lines.length ? "Nichts gefunden." : "Noch keine Sorte angelegt."}</Card>}
      {groups.map((m) => (
        <section key={m} className="space-y-3">
          <h2 className="px-1 text-lg font-extrabold tracking-tight">{m}</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {lines
              .filter(({ l }) => baseMat(l.material) === m)
              .map(({ l, colors }) => {
                const mine = owned.get(`${b.id}|${norm(l.name)}`) ?? 0;
                const prof = profileById(l.profile_id);
                return (
                  <Card key={l.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-extrabold">
                          {l.name}
                          {l.material !== m && !l.name.toUpperCase().includes(l.material.toUpperCase()) && <span className="ml-1.5 text-xs font-semibold text-ink3">{l.material}</span>}
                        </div>
                        <div className="truncate text-xs text-ink3">
                          {l.colors.length} Farben{prof ? ` · Profil ${prof.name} (${prof.id})` : l.profile_id ? ` · Profil ${l.profile_id}` : ""}
                          {mine > 0 && <span className="font-semibold text-accent"> · {mine} im Regal</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button kind="ghost" className="size-8 px-0" aria-label={`${l.name} bearbeiten`} onClick={() => onEdit({ kind: "line", brandId: b.id, line: l })}>
                          <Pencil size={15} />
                        </Button>
                        <Button kind="ghost" className="size-8 px-0" aria-label={`Farbe zu ${l.name} hinzufügen`} onClick={() => onEdit({ kind: "color", lineId: l.id, color: null })}>
                          <Plus size={16} />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {colors.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => onEdit({ kind: "color", lineId: l.id, color: c })}
                          title={[c.hex ? `#${c.hex}` : "Farbcode unbekannt", c.code && `Code ${c.code}`].filter(Boolean).join(" · ")}
                          className="flex h-8 items-center gap-1.5 rounded-full bg-fill pr-2.5 pl-1 text-xs font-semibold hover:bg-fill2"
                        >
                          <Dot hex={c.hex} size="size-6" />
                          <span>{c.name}</span>
                          <span className="font-mono text-[10.5px] font-medium text-ink3">{c.hex ? `#${c.hex}` : "?"}</span>
                          {c.code && <span className="rounded bg-card px-1 font-mono text-[10px] text-ink3">{c.code}</span>}
                        </button>
                      ))}
                      {!colors.length && <span className="text-xs text-ink3">Noch keine Farbe.</span>}
                    </div>
                  </Card>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

function useCatalogMutation(onClose: () => void, done?: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["catalog"] });
      if (done) toast(done);
      onClose();
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
}

function BrandDialog({ brand, onClose }: { brand: CatalogBrand | null; onClose: () => void }) {
  const [v, setV] = useState({ name: brand?.brand ?? "", match: brand?.match ?? "", url: brand?.url ?? "", source: brand?.source ?? "" });
  const m = useCatalogMutation(onClose);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const save = () =>
    m.mutate(async () => {
      const body = { name: v.name.trim(), match: (v.match.trim() || v.name.trim().split(/\s+/)[0] || "").toLowerCase(), url: v.url.trim(), source: v.source.trim() };
      if (brand) await api.updateBrand(brand.id, body);
      else await api.addBrand(body);
      if (!brand || body.name !== brand.brand) go({ page: "filament", view: "katalog", brand: slug(body.name) });
    });
  return (
    <Dialog title={brand ? "Marke bearbeiten" : "Neue Marke"} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), save())}>
        <Field label="Name">
          <input className="field" value={v.name} onChange={set("name")} placeholder="Polymaker" required autoFocus />
        </Field>
        <Field label="Stichwort" hint="Spulen, deren Marke dieses Wort enthält, nutzen den Katalog (Groß-/Kleinschreibung egal). Leer = erstes Wort des Namens.">
          <input className="field" value={v.match} onChange={set("match")} placeholder={(v.name.trim().split(/\s+/)[0] ?? "").toLowerCase()} />
        </Field>
        <Field label="Shop">
          <input className="field" value={v.url} onChange={set("url")} placeholder="https://" type="url" />
        </Field>
        <Field label="Quelle der Farben">
          <input className="field" value={v.source} onChange={set("source")} placeholder="Von Hand, Produktseite …" />
        </Field>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {brand ? (
            <Button
              type="button"
              kind="danger"
              onClick={() =>
                confirm(`${brand.brand} mit ${brand.lines.length} Sorten und ${colorCount(brand)} Farben aus dem Katalog löschen? Spulen bleiben.`) &&
                m.mutate(async () => (await api.deleteBrand(brand.id), go({ page: "filament", view: "katalog" })))
              }
            >
              <Trash2 size={15} /> Löschen
            </Button>
          ) : (
            <span />
          )}
          <Button kind="primary" type="submit" busy={m.isPending} disabled={!v.name.trim()}>
            Speichern
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Profile gruppiert: Bambu Lab zuerst, Generic danach, dann die übrigen Hersteller */
const PROFILE_GROUPS = (() => {
  const m = new Map<string, typeof PROFILES>();
  for (const p of PROFILES) m.set(p.vendor, [...(m.get(p.vendor) ?? []), p]);
  const rank = (v: string) => (v === "Bambu Lab" ? 0 : v === "Generic" ? 1 : 2);
  return [...m].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
})();

function LineDialog({ brandId, line, onClose }: { brandId: number; line: CatalogLine | null; onClose: () => void }) {
  const [v, setV] = useState({ material: line?.material ?? "PLA", name: line?.name ?? "", profile_id: line?.profile_id ?? "" });
  const m = useCatalogMutation(onClose);
  const save = () =>
    m.mutate(() => {
      const body = { material: v.material.trim(), name: v.name.trim(), profile_id: v.profile_id || null };
      return line ? api.updateLine(line.id, body) : api.addLine(brandId, body);
    });
  return (
    <Dialog title={line ? "Sorte bearbeiten" : "Neue Sorte"} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
          <Field label="Material">
            <input className="field" value={v.material} onChange={(e) => setV({ ...v, material: e.target.value })} required />
          </Field>
          <Field label="Sorte">
            <input className="field" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="PLA Matte" required autoFocus={!line} />
          </Field>
        </div>
        <Field label="Druckprofil" hint="Geht beim Einlegen ins AMS an den Drucker, wenn die Spule kein eigenes Profil hat.">
          <select className="field" value={v.profile_id} onChange={(e) => setV({ ...v, profile_id: e.target.value })}>
            <option value="">Automatisch nach Material</option>
            {PROFILE_GROUPS.map(([vendor, list]) => (
              <optgroup key={vendor} label={vendor}>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {line ? (
            <Button
              type="button"
              kind="danger"
              onClick={() => confirm(`Sorte ${line.name} mit ${line.colors.length} Farben löschen? Spulen bleiben.`) && m.mutate(() => api.deleteLine(line.id))}
            >
              <Trash2 size={15} /> Löschen
            </Button>
          ) : (
            <span />
          )}
          <Button kind="primary" type="submit" busy={m.isPending} disabled={!v.name.trim() || !v.material.trim()}>
            Speichern
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ColorDialog({ lineId, color, onClose }: { lineId: number; color: CatalogColor | null; onClose: () => void }) {
  const [v, setV] = useState({ name: color?.name ?? "", hex: color?.hex ?? "", code: color?.code ?? "" });
  const m = useCatalogMutation(onClose);
  const hex = v.hex.replace(/^#/, "").toUpperCase();
  const valid = !hex || /^[0-9A-F]{6}$/.test(hex);
  const save = () =>
    m.mutate(() => {
      const body = { name: v.name.trim(), hex: hex || null, code: v.code.trim() || null };
      return color ? api.updateColor(color.id, body) : api.addColor(lineId, body);
    });
  return (
    <Dialog title={color ? "Farbe bearbeiten" : "Neue Farbe"} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), save())}>
        <Field label="Name">
          <input className="field" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Kohlschwarz" required autoFocus={!color} />
        </Field>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3">
          <label className="block">
            <Label>Farbe</Label>
            <input
              type="color"
              value={valid && hex ? `#${hex}` : "#888888"}
              onChange={(e) => setV({ ...v, hex: e.target.value.slice(1).toUpperCase() })}
              className="mt-1.5 h-[2.375rem] w-12 cursor-pointer rounded-lg bg-card p-1 shadow-seg"
            />
          </label>
          <Field label="Hex">
            <input className="field font-mono" value={v.hex} onChange={(e) => setV({ ...v, hex: e.target.value })} placeholder="RRGGBB" maxLength={7} />
          </Field>
          <Field label="Code">
            <input className="field font-mono" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} placeholder="K1" />
          </Field>
        </div>
        <p className={`text-xs ${valid ? "text-ink3" : "font-semibold text-bad"}`}>
          {valid ? "Hex leer = Farbcode unbekannt. Code = Herstellercode, bei Bambu der Teil hinter „-“ vom Chip (z. B. K1)." : "Hex als RRGGBB, z. B. 1E64C8"}
        </p>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {color ? (
            <Button type="button" kind="danger" onClick={() => confirm(`Farbe ${color.name} löschen?`) && m.mutate(() => api.deleteColor(color.id))}>
              <Trash2 size={15} /> Löschen
            </Button>
          ) : (
            <span />
          )}
          <Button kind="primary" type="submit" busy={m.isPending} disabled={!v.name.trim() || !valid}>
            Speichern
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
