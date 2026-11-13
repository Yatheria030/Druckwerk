import { autoColorName } from "../../../shared/colors.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Copy, Link2, Nfc, Plus, Scale, Search, Sparkles, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { autoProfile, profileById, PROFILES } from "../../../shared/profiles.ts";
import { awaitsChip, MATERIALS, paidPrice, type PrinterLive, type Spool, type SpoolDraft, type SpoolInput } from "../../../shared/types.ts";
import { api, type Pushed } from "../api.ts";
import { AmsPanel, CHIP_LOCKED, pushedToast } from "../ui/Ams.tsx";
import { CatalogColors, SorteField, carryColorName } from "../ui/catalog.tsx";
import { DragProvider, useDrag, type DragItem, type Draggable, type DropTarget } from "../ui/drag.tsx";
import { PageHeader, useLive } from "../App.tsx";
import { useCatalog } from "../lib/catalog.ts";
import { useSetting } from "../lib/settings.ts";
import { go, type FilamentView as FView } from "../lib/router.ts";
import { CatalogPage } from "./CatalogPage.tsx";
import { chipCls, FilamentTabs } from "../ui/FilamentTabs.tsx";
import { Button, Card, Dialog, Field, fmtDate, Label, LoadError, useToast } from "../ui/controls.tsx";
import { FillBar, fmtG, pct, RestChips, SpoolArt, sorteTag, spoolSub, spoolTitle } from "../ui/spool.tsx";

type Group = "material" | "brand" | "location";
type Sort = "farbe" | "rest" | "anteil" | "preis" | "zuletzt" | "name";

const LOW = (s: Spool) => s.remaining_g < 120 || pct(s) < 0.12;

const store = {
  get: <T extends string>(k: string, d: T): T => {
    try {
      return (localStorage.getItem(`filament.${k}`) as T) || d;
    } catch {
      return d;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`filament.${k}`, v);
    } catch {}
  },
};

/** Farbton-Sortierung: bunte Spulen als Regenbogen, Grau/Schwarz/Weiß am Ende nach Helligkeit */
function hueKey(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) || 0) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.15 || l < 0.08 || l > 0.94) return 1000 + (1 - l) * 100;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h;
}

function groupOf(s: Spool, g: Group) {
  if (g === "material") return s.material || "Sonstiges";
  if (g === "brand") return s.brand || "Ohne Marke";
  return s.slot ? "Im AMS" : s.location || "Ohne Lagerort";
}

/** Spulen, die gerade drucken (aktives Fach während RUNNING) */
const activeSpools = (live: PrinterLive[] | undefined) =>
  new Set((live ?? []).filter((l) => l.state === "RUNNING").flatMap((l) => l.trays.filter((t) => t.active && t.spool_id).map((t) => t.spool_id!)));

/** Ziehbare Spule aus Regal oder Liste; Bambu-Spulen mit Chip legt der Drucker selbst ins Fach */
const dragItem = (s: Spool): Draggable =>
  s.archived ? null : s.rfid ? CHIP_LOCKED : { spoolId: s.id, color: s.color, fraction: pct(s), from: s.printer_id != null && s.tray != null ? { printer_id: s.printer_id, tray: s.tray } : null };

export function FilamentPage(p: { view: FView; brand?: string; spoolId?: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const live = useLive();
  const move = useMutation({
    mutationFn: ({ item, target }: { item: DragItem; target: DropTarget }) =>
      api.setSlot(item.spoolId, target.kind === "shelf" ? null : { printer_id: target.printer_id, tray: target.tray, swap: true }),
    onSuccess: (r, { target }) => {
      pushedToast(toast, r.pushed, target.kind === "shelf" ? "Aus dem Fach genommen" : undefined);
      if (target.kind === "tray" && !r.pushed.some((x) => x.text)) toast("Ins Fach gelegt");
      void qc.invalidateQueries({ queryKey: ["spools"] });
      void qc.invalidateQueries({ queryKey: ["live"] });
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const onDrop = (item: DragItem, target: DropTarget) => {
    if (target.kind === "shelf") return item.from && move.mutate({ item, target });
    if (item.from?.printer_id === target.printer_id && item.from.tray === target.tray) return;
    const t = live.data?.find((l) => l.id === target.printer_id)?.trays.find((x) => x.id === target.tray);
    if (t?.rfid) return toast(`In Fach ${t.label} steckt eine Bambu-Spule mit Chip, das Fach stellt der Drucker selbst ein.`, "fehler");
    move.mutate({ item, target });
  };
  if (p.view === "katalog") return <CatalogPage brand={p.brand} />;
  return (
    <DragProvider onDrop={onDrop} onBlocked={(m) => toast(m)}>
      <SpoolsView key={p.view} view={p.view} spoolId={p.spoolId} />
    </DragProvider>
  );
}

function SpoolsView({ view, spoolId }: { view: "regal" | "spulen"; spoolId?: number }) {
  const q = useQuery({ queryKey: ["spools"], queryFn: api.spools, refetchInterval: 20_000 });
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const live = useLive();
  const drag = useDrag();
  const [search, setSearch] = useState("");
  const [mat, setMat] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>(() => store.get("group", "material"));
  const [sort, setSort] = useState<Sort>(() => store.get("sort", "farbe"));
  const [desc, setDesc] = useState(() => store.get<string>("desc", "0") === "1");
  const [archived, setArchived] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [creating, setCreating] = useState<Partial<SpoolInput> | null>(null);
  const spinning = activeSpools(live.data);

  useEffect(() => store.set("group", group), [group]);
  useEffect(() => (store.set("sort", sort), store.set("desc", desc ? "1" : "0")), [sort, desc]);
  useCatalog(); // Farbnamen im Dialog

  const all = q.data ?? [];
  const current = all.filter((s) => !s.archived);
  const materials = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of current) m.set(s.material, (m.get(s.material) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [current]);

  const list = all.filter((s) => {
    if (s.archived !== archived) return false;
    if (mat && s.material !== mat) return false;
    if (waiting && !awaitsChip(s)) return false;
    const t = search.trim().toLowerCase();
    return !t || [s.brand, s.material, s.name, s.color_name, s.location, s.color, s.slot ?? ""].some((x) => x.toLowerCase().includes(t));
  });

  const groups = useMemo(() => {
    const m = new Map<string, Spool[]>();
    for (const s of list) {
      const k = groupOf(s, group);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    const by = view === "regal" ? sortKey("farbe") : sortKey(sort);
    const dir = view === "spulen" && desc ? -1 : 1;
    for (const v of m.values()) v.sort((a, b) => dir * by(a, b) || hueKey(a.color) - hueKey(b.color) || b.remaining_g - a.remaining_g);
    return [...m].sort(([a, x], [b, y]) => Number(b === "Im AMS") - Number(a === "Im AMS") || y.length - x.length || a.localeCompare(b));
  }, [list, group, sort, desc, view]);
  const onSort = (k: Sort) => (k === sort ? setDesc(!desc) : (setSort(k), setDesc(false)));

  const stats = {
    count: current.length,
    grams: current.reduce((s, x) => s + x.remaining_g, 0),
    // Lagerwert zum Normalpreis, bezahlter Angebotswert in Klammern dahinter
    value: current.reduce((s, x) => s + ((x.price ?? paidPrice(x)) != null && x.net_g ? ((x.price ?? paidPrice(x))! * x.remaining_g) / x.net_g : 0), 0),
    paid: current.reduce((s, x) => s + (paidPrice(x) != null && x.net_g ? (paidPrice(x)! * x.remaining_g) / x.net_g : 0), 0),
    low: current.filter(LOW).length,
    unpriced: current.filter((x) => paidPrice(x) == null || !x.net_g).length,
  };

  const awaiting = current.filter(awaitsChip);
  useClaimToast(all);
  const open = spoolId ? all.find((s) => s.id === spoolId) : undefined;
  let idx = 0;

  const printersWithAms = view === "regal" ? (live.data ?? []).filter((l) => l.ams.length || l.external) : [];
  const cur = useSetting<string>("filament", "currency");
  const eur = (v: number) => `${Math.round(v).toLocaleString("de-DE")} ${cur}`;
  const facts: [ReactNode, string | null][] = [
    [`${stats.count} ${stats.count === 1 ? "Spule" : "Spulen"}`, null],
    [fmtG(stats.grams), null],
    ...(stats.value
      ? ([[<>{eur(stats.value)} Lagerwert{Math.round(stats.paid) !== Math.round(stats.value) && <span className="text-ink3"> ({eur(stats.paid)})</span>}</>, null]] as [
          ReactNode,
          null,
        ][])
      : []),
    // Lagerwert zählt nur Spulen mit Preis, sonst wirkt er viel zu niedrig
    ...(stats.value && stats.unpriced ? ([[`${stats.unpriced} ohne Preis`, "text-ink3"]] as [string, string][]) : []),
    ...(stats.low ? ([[`${stats.low} fast leer`, "font-semibold text-bad"]] as [string, string][]) : []),
  ];
  return (
    <>
      <PageHeader
        title="Filament"
        sub={
          all.length > 0 && (
            <span className="block overflow-hidden">
              {/* Trennpunkt am Zeilenanfang liegt links außerhalb und wird abgeschnitten */}
              <span className="-ml-4 flex flex-wrap tnum">
                {facts.map(([t, cls], i) => (
                  <span key={i} className={`relative pl-4 whitespace-nowrap before:absolute before:left-[0.4rem] before:text-ink3 before:content-['·'] ${cls ?? ""}`}>
                    {t}
                  </span>
                ))}
              </span>
            </span>
          )
        }
      >
        <Button kind="primary" onClick={() => setCreating({})}>
          <Plus size={16} /> Spule
        </Button>
      </PageHeader>
      <FilamentTabs view={view} />
      <div className="mx-auto max-w-6xl space-y-6 px-4 sm:px-6 2xl:max-w-[88rem]">
        {printersWithAms.map((l, _, arr) => (
          <section key={l.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1">
              <h2 className="text-lg font-extrabold tracking-tight">{arr.length > 1 ? (printers.data?.find((x) => x.id === l.id)?.name ?? "Drucker") : "Im Drucker"}</h2>
              <p className="text-xs text-ink3">
                Spule aufs Fach ziehen<span className="pointer-coarse:inline hidden"> (lange drücken)</span>, Profil und Farbe gehen an den Drucker. Fächer mit
                Bambu-Chip stellt der Drucker selbst ein.
                {!current.some((s) => !s.rfid) && " Noch keine Spule ohne Chip da: erst mit „+ Spule“ anlegen (Link auslesen geht auch), dann hierher ziehen."}
              </p>
            </div>
            <AmsPanel l={l} printerId={l.id} drag />
          </section>
        ))}

        <div className="space-y-5">
          {all.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl bg-card px-3 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
                  <Search size={16} className="shrink-0 text-ink3" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Farbe, Marke, Material …" className="field text-[15px]" />
                  {search && (
                    <button onClick={() => setSearch("")} className="text-ink3 hover:text-ink" aria-label="Suche leeren">
                      <X size={16} />
                    </button>
                  )}
                </label>
                <div className="flex items-center gap-2">
                  <Seg value={group} onChange={setGroup} className="flex-1 *:flex-1 sm:flex-none sm:*:flex-none" items={[["material", "Material"], ["brand", "Marke"], ["location", "Ort"]]} />
                  {view === "spulen" && (
                    <div className="flex shrink-0 items-center gap-1 lg:hidden">
                      <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-10 rounded-xl bg-card px-2 text-[13px] font-semibold shadow-seg" aria-label="Sortieren">
                        {SORTS.map(([k, l]) => (
                          <option key={k} value={k}>
                            {l.replace("€", cur)}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => setDesc(!desc)} className="flex size-10 items-center justify-center rounded-xl bg-card text-ink2 shadow-seg" aria-label="Richtung umkehren">
                        {desc ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="no-scrollbar -mx-4 -mt-0.5 flex gap-2 overflow-x-auto px-4 py-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
                <Chip on={!mat && !archived && !waiting} onClick={() => (setMat(null), setArchived(false), setWaiting(false))}>
                  Alle <span className="opacity-55">{current.length}</span>
                </Chip>
                {materials.map(([m, n]) => (
                  <Chip key={m} on={mat === m && !archived} onClick={() => (setMat(mat === m ? null : m), setArchived(false))}>
                    {m} <span className="opacity-55">{n}</span>
                  </Chip>
                ))}
                {awaiting.length > 0 && (
                  <Chip on={waiting && !archived} onClick={() => (setWaiting(!waiting), setArchived(false))}>
                    <Nfc size={13} className={waiting && !archived ? "" : "text-accent"} />
                    Wartet auf Chip <span className="opacity-55">{awaiting.length}</span>
                  </Chip>
                )}
                {all.some((s) => s.archived) && (
                  <Chip on={archived} onClick={() => (setArchived(!archived), setMat(null), setWaiting(false))}>
                    <Archive size={13} />
                    Leer & archiviert
                  </Chip>
                )}
              </div>
            </div>
          )}

          <div
            data-drop={view === "regal" ? "shelf" : undefined}
            className={`min-w-0 space-y-5 rounded-2xl transition-[outline-color] ${view === "regal" && drag.item?.from ? (drag.over === "shelf" ? "drop-over" : "drop-ok") : ""}`}
          >
            {q.isError ? (
              <LoadError error={q.error} retry={() => q.refetch()} />
            ) : q.isPending ? (
              <div className="skeleton h-72 rounded-2xl" />
            ) : !all.length ? (
              <Card className="overflow-hidden">
                <div className="shelf-wall flex justify-center gap-3 px-6 pt-8">
                  {["#E8462B", "#F4C430", "#2B6CB0", "#2F855A", "#F2F2F2"].map((c, i) => (
                    <div key={c} className="roll-in w-16 sm:w-20" style={{ animationDelay: `${i * 90}ms` }}>
                      <SpoolArt color={c} fraction={0.9 - i * 0.12} delay={i * 90} />
                    </div>
                  ))}
                </div>
                <div className="shelf-board relative h-3.5" />
                <div className="p-6 text-center">
                  <div className="text-lg font-bold">Das Regal ist noch leer</div>
                  <p className="mx-auto mt-1 max-w-md text-sm text-ink2">
                    Spulen von Hand anlegen. Bambu-Spulen mit RFID-Chip erscheinen von selbst, sobald sie im AMS liegen. Jeder Druck zieht seinen Verbrauch ab.
                  </p>
                  <Button kind="primary" className="mt-4" onClick={() => setCreating({})}>
                    <Plus size={16} /> Erste Spule anlegen
                  </Button>
                </div>
              </Card>
            ) : !list.length ? (
              <Card className="py-10 text-center text-sm text-ink3">Keine Spule in dieser Auswahl.</Card>
            ) : view === "regal" ? (
              groups.map(([title, items]) => {
                const start = idx;
                idx += items.length;
                return <Shelf key={title} title={title} items={items} spinning={spinning} startIndex={start} />;
              })
            ) : (
              <SpoolTable groups={groups} spinning={spinning} sort={sort} desc={desc} onSort={onSort} />
            )}
          </div>
        </div>
      </div>
      {(open || creating) && (
        <SpoolDialog
          s={open ?? null}
          preset={creating ?? {}}
          all={all}
          live={live.data ?? []}
          onClose={() => {
            setCreating(null);
            if (spoolId) go({ page: "filament", view });
          }}
          onCopy={(p) => (go({ page: "filament", view }), setCreating(p))}
        />
      )}
    </>
  );
}

function Seg<T extends string>({ value, onChange, items, className = "" }: { value: T; onChange: (v: T) => void; items: [T, React.ReactNode][]; className?: string }) {
  return (
    <div className={`flex h-10 rounded-xl bg-fill p-1 *:justify-center ${className}`}>
      {items.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`flex items-center rounded-lg px-3 text-[13px] font-semibold ${value === k ? "bg-[var(--c-seg-active)] text-ink shadow-seg" : "text-ink2"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}


function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={chipCls(on)}>
      {children}
    </button>
  );
}

/** Meldung, wenn eine wartende Spule ihren Chip bekommen hat (der Server verknüpft, die Liste lädt alle 20 s neu) */
function useClaimToast(all: Spool[]) {
  const toast = useToast();
  const prev = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!all.length) return;
    const now = new Set(all.filter(awaitsChip).map((s) => s.id));
    for (const id of prev.current ?? []) {
      const s = all.find((x) => x.id === id);
      if (s?.rfid) toast(`${spoolTitle(s)} (${s.name || s.material}) am Chip erkannt${s.slot ? `, liegt in ${s.slot.split(" · ").pop()}` : ""}`);
    }
    prev.current = now;
  }, [all, toast]);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    setW(ref.current.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Regalboden: Spulen stehen auf einem durchgehenden Brett, Etiketten hängen darunter */
function Shelf({ title, items, spinning, startIndex }: { title: string; items: Spool[]; spinning: Set<number>; startIndex: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const min = width < 560 ? 104 : 136;
  const cols = Math.max(2, Math.floor(width / min) || 3);
  const cell = width / cols || 120;
  const rows: Spool[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  const total = items.reduce((s, x) => s + x.remaining_g, 0);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
        <div className="text-xs font-semibold text-ink3 tnum">
          {items.length} {items.length === 1 ? "Spule" : "Spulen"} · {fmtG(total)}
        </div>
      </div>
      <div className="shelf-wall overflow-hidden rounded-2xl px-2.5 pt-5 pb-1 shadow-card sm:px-4">
        <div ref={ref}>
          {rows.map((row, r) => (
            <div key={r} className="relative mb-4">
              <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {row.map((s, i) => (
                  <ShelfSpool key={s.id} s={s} size={cell} active={spinning.has(s.id)} delay={Math.min(900, (startIndex + r * cols + i) * 45)} />
                ))}
              </div>
              <div className="shelf-board pointer-events-none absolute right-[-1rem] left-[-1rem] h-3.5" style={{ top: cell * 0.86 }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ShelfSpool({ s, size, active, delay }: { s: Spool; size: number; active: boolean; delay: number }) {
  const low = LOW(s);
  const wait = awaitsChip(s);
  const tag = sorteTag(s);
  const spool = size * 0.86;
  const d = useDrag();
  return (
    <button
      onClick={() => go({ page: "filament", spool: s.id })}
      {...d.bind(dragItem(s))}
      className={`group relative flex min-w-0 flex-col items-center px-1 text-left ${d.item?.spoolId === s.id ? "opacity-35" : ""}`}
      aria-label={spoolTitle(s)}
    >
      <div className="relative flex w-full items-end justify-center" style={{ height: spool }}>
        <span className="absolute bottom-0 h-2 w-[62%] rounded-[50%] bg-black/35 blur-[3px]" />
        <div className="roll-in relative" style={{ width: spool * 0.94, animationDelay: `${delay}ms` }}>
          <SpoolArt color={s.color} fraction={pct(s)} spinning={active} glow={active} delay={delay + 200} wrapped={wait} className="spool-hover w-full" />
        </div>
        {tag && (
          <span className="absolute top-1 left-0.5 max-w-[62%] truncate rounded-full bg-card/90 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-[0.06em] text-ink2 uppercase shadow">
            {tag}
          </span>
        )}
        {wait && (
          <span className="absolute top-0.5 right-0.5 flex size-6 items-center justify-center" title="Wartet auf Chip">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent/40 motion-reduce:hidden" />
            <span className="relative flex size-6 items-center justify-center rounded-full bg-accent text-white shadow">
              <Nfc size={13} aria-label="Wartet auf Chip" />
            </span>
          </span>
        )}
        {s.slot && (
          <span
            className={`absolute top-1 right-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold text-white shadow ${active ? "animate-pulse bg-accent" : "bg-[#24272b]/85"}`}
          >
            {s.slot.split(" · ").pop()}
          </span>
        )}
        {s.rfid && !s.slot && <Nfc size={13} className="absolute top-1 right-1 text-ink3" aria-label="RFID" />}
      </div>
      {/* Platz für das Brett */}
      <div className="h-3.5 w-full" />
      <div className="relative mt-2 w-[92%] rounded-md bg-card px-1.5 pt-1 pb-1.5 shadow-[0_2px_6px_rgba(0,0,0,0.12),0_0_0_1px_var(--c-sep)] transition-transform group-hover:translate-y-0.5">
        <span className="absolute -top-2 left-1/2 h-2 w-px bg-ink4" />
        <div className="truncate text-[11.5px] leading-tight font-bold sm:text-xs">{spoolTitle(s)}</div>
        <div className="truncate text-[10.5px] leading-tight text-ink3 sm:text-[11px]">{s.brand || s.material}</div>
        <div className="mt-1 flex items-center gap-1.5">
          <FillBar fraction={pct(s)} color={s.color} low={low} className="flex-1" />
          <span className={`text-[10.5px] font-bold tnum ${low ? "text-bad" : "text-ink2"}`}>{fmtG(s.remaining_g)}</span>
        </div>
      </div>
    </button>
  );
}

const SORTS: [Sort, string][] = [
  ["farbe", "Farbe"],
  ["name", "Name"],
  ["rest", "Rest"],
  ["anteil", "Füllstand"],
  ["preis", "€/kg"],
  ["zuletzt", "Zuletzt benutzt"],
];

const perKg = (s: Spool) => (paidPrice(s) != null && s.net_g ? (paidPrice(s)! * 1000) / s.net_g : null);

function sortKey(k: Sort): (a: Spool, b: Spool) => number {
  if (k === "rest") return (a, b) => b.remaining_g - a.remaining_g;
  if (k === "anteil") return (a, b) => pct(b) - pct(a);
  if (k === "preis") return (a, b) => (perKg(b) ?? -1) - (perKg(a) ?? -1);
  if (k === "zuletzt") return (a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? "");
  if (k === "name") return (a, b) => spoolTitle(a).localeCompare(spoolTitle(b), "de") || a.brand.localeCompare(b.brand, "de");
  return (a, b) => hueKey(a.color) - hueKey(b.color);
}

/** Spalten der Spulenliste: schmal Karte je Spule, ab 42rem Breite Tabelle, ab 64rem mit Preis und letztem Druck */
const COLS = "grid-cols-[2.75rem_minmax(0,1fr)_6.5rem] @2xl:grid-cols-[2.75rem_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1fr)_8.5rem] @5xl:grid-cols-[2.75rem_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1fr)_4.5rem_5.5rem_9rem]";

function SpoolTable({ groups, spinning, sort, desc, onSort }: { groups: [string, Spool[]][]; spinning: Set<number>; sort: Sort; desc: boolean; onSort: (k: Sort) => void }) {
  const cur = useSetting<string>("filament", "currency");
  const H = ({ k, children, className = "" }: { k: Sort; children: React.ReactNode; className?: string }) => (
    <button onClick={() => onSort(k)} className={`flex items-center gap-1 text-[11px] font-bold tracking-[0.08em] uppercase hover:text-ink ${sort === k ? "text-accent" : ""} ${className}`}>
      {children}
      {sort === k && (desc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );
  return (
    <div className="@container space-y-5">
      {groups.map(([title, items]) => (
        <section key={title}>
          <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
            <div className="text-xs font-semibold text-ink3 tnum">
              {items.length} {items.length === 1 ? "Spule" : "Spulen"} · {fmtG(items.reduce((s, x) => s + x.remaining_g, 0))}
            </div>
          </div>
          <Card className="overflow-hidden">
            <div className={`hidden items-center gap-x-4 border-b border-sep px-4 py-2 text-ink3 @2xl:grid ${COLS}`}>
              <span />
              <H k="name">Spule</H>
              <span className="text-[11px] font-bold tracking-[0.08em] uppercase">Material & Profil</span>
              <span className="text-[11px] font-bold tracking-[0.08em] uppercase">Ort & Füllstand</span>
              <H k="preis" className="hidden justify-end @5xl:flex">
                {cur}/kg
              </H>
              <H k="zuletzt" className="hidden @5xl:flex">
                Zuletzt
              </H>
              <H k={sort === "anteil" ? "anteil" : "rest"} className="justify-end">
                {sort === "anteil" ? "Füllstand" : "Rest"}
              </H>
            </div>
            <div className="divide-y divide-sep">
              {items.map((s) => (
                <SpoolRow key={s.id} s={s} active={spinning.has(s.id)} />
              ))}
            </div>
          </Card>
        </section>
      ))}
    </div>
  );
}

function SpoolRow({ s, active }: { s: Spool; active: boolean }) {
  const low = LOW(s);
  const wait = awaitsChip(s);
  const prof = profileById(s.profile_id);
  const auto = prof ? null : autoProfile(s.material, s.name);
  const nozzle = s.nozzle_min && s.nozzle_max ? `${s.nozzle_min}–${s.nozzle_max} °C` : (prof ?? auto) ? `${(prof ?? auto)!.nozzle_min}–${(prof ?? auto)!.nozzle_max} °C` : "";
  const kg = perKg(s);
  const cur = useSetting<string>("filament", "currency");
  const hex = s.color.replace(/^#/, "").slice(0, 6).toUpperCase();
  const where = s.slot ?? (s.location || "Lager");
  const chip = s.rfid ? (s.track === "rfid" ? "Chip, folgt dem AMS" : "Chip, eigene Zählung") : wait ? "Wartet auf Chip" : "ohne Chip";
  return (
    <button
      onClick={() => go({ page: "filament", view: "spulen", spool: s.id })}
      className={`grid w-full items-center gap-x-4 gap-y-1 px-3 py-3 text-left hover:bg-hover sm:px-4 ${COLS}`}
    >
      <SpoolArt color={s.color} fraction={pct(s)} spinning={active} wrapped={wait} className="row-span-2 size-11 @2xl:row-span-1" />
      <div className="min-w-0">
        <div className="truncate text-sm font-bold">{spoolTitle(s)}</div>
        <div className="truncate text-xs text-ink2">{[s.brand, s.name || s.material].filter(Boolean).join(" · ")}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink3">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)" }} />
          <span className="font-mono">#{hex}</span>
          {s.note && <span className="truncate">· {s.note}</span>}
        </div>
      </div>
      <div className="hidden min-w-0 text-xs @2xl:block">
        <div className="truncate font-semibold">{s.material}</div>
        <div className="truncate text-ink3">{prof ? prof.name : auto ? `${auto.name} (auto)` : "ohne Profil"}</div>
        {nozzle && <div className="truncate text-ink3 tnum">Düse {nozzle}</div>}
      </div>
      <div className="hidden min-w-0 text-xs @2xl:block">
        <div className={`truncate font-semibold ${s.slot ? "text-accent" : ""}`}>{where}</div>
        <div className={`flex items-center gap-1 truncate ${wait ? "font-semibold text-accent" : "text-ink3"}`}>
          {(s.rfid || wait) && <Nfc size={11} className="shrink-0" />}
          {chip}
        </div>
      </div>
      <div className="hidden text-right text-xs font-semibold tnum @5xl:block">{kg != null ? `${kg.toFixed(2).replace(".", ",")} ${cur}` : "–"}</div>
      <div className="hidden text-xs text-ink3 tnum @5xl:block">{s.last_used_at ? fmtDate(s.last_used_at).split(",")[0] : "–"}</div>
      <div className="min-w-0">
        <div className={`text-right text-sm font-bold tnum ${low ? "text-bad" : ""}`}>{fmtG(s.remaining_g)}</div>
        <div className="text-right text-[11px] text-ink3 tnum">
          {Math.round(pct(s) * 100)} % von {fmtG(s.net_g)}
        </div>
        <FillBar fraction={pct(s)} color={s.color} low={low} className="mt-1" />
      </div>
      {/* schmal: Ort, Chip und Profil als zweite Zeile */}
      <div className="col-span-2 col-start-2 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-ink3 @2xl:hidden">
        <span className={s.slot ? "font-semibold text-accent" : ""}>{where}</span>
        <span className={wait ? "font-semibold text-accent" : ""}>{chip}</span>
        <span>{prof ? prof.name : auto ? `${auto.name} (auto)` : s.material}</span>
        {kg != null && <span className="tnum">{kg.toFixed(2).replace(".", ",")} {cur}/kg</span>}
        {s.last_used_at && <span className="tnum">zuletzt {fmtDate(s.last_used_at).split(",")[0]}</span>}
      </div>
    </button>
  );
}

/** Profile gruppiert: Bambu Lab zuerst, Generic danach, dann die übrigen Hersteller */
const PROFILE_GROUPS = (() => {
  const m = new Map<string, typeof PROFILES>();
  for (const p of PROFILES) m.set(p.vendor, [...(m.get(p.vendor) ?? []), p]);
  const rank = (v: string) => (v === "Bambu Lab" ? 0 : v === "Generic" ? 1 : 2);
  return [...m].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
})();

const PALETTE = ["#FFFFFF", "#000000", "#8E9089", "#E8462B", "#F28C28", "#F4C430", "#3B9C4B", "#00AE42", "#2B6CB0", "#0A2E5C", "#7B3FA0", "#E86FA0", "#8B5A2B", "#C9B28B"];

function SpoolDialog({
  s,
  preset,
  all,
  live,
  onClose,
  onCopy,
}: {
  s: Spool | null;
  preset: Partial<SpoolInput>;
  all: Spool[];
  live: PrinterLive[];
  onClose: () => void;
  onCopy: (p: Partial<SpoolInput>) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const netDefault = useSetting<number>("filament", "net_g");
  const cur = useSetting<string>("filament", "currency");
  const str = (x: number | null | undefined) => (x != null ? String(x).replace(".", ",") : "");
  const [v, setV] = useState({
    brand: s?.brand ?? preset.brand ?? "",
    material: s?.material ?? preset.material ?? "PLA",
    name: s?.name ?? preset.name ?? "",
    color: s?.color ?? preset.color ?? "",
    color_name: s?.color_name ?? preset.color_name ?? "",
    net_g: String(s?.net_g ?? preset.net_g ?? netDefault),
    rest: String(s ? Math.round(s.remaining_g) : (preset.net_g ?? 1000)),
    tare_g: s?.tare_g != null ? String(s.tare_g) : preset.tare_g != null ? String(preset.tare_g) : "",
    price: s?.price != null ? String(s.price) : preset.price != null ? String(preset.price) : "",
    price_sale: s?.price_sale != null ? String(s.price_sale) : preset.price_sale != null ? String(preset.price_sale) : "",
    location: s?.location ?? preset.location ?? "",
    note: s?.note ?? preset.note ?? "",
    count: "1",
    profile_id: s?.profile_id ?? preset.profile_id ?? "",
    nozzle_min: str(s?.nozzle_min ?? preset.nozzle_min),
    nozzle_max: str(s?.nozzle_max ?? preset.nozzle_max),
    bed_temp: str(s?.bed_temp ?? preset.bed_temp),
    dry_temp: str(s?.dry_temp ?? preset.dry_temp),
    dry_hours: str(s?.dry_hours ?? preset.dry_hours),
    url: s?.url ?? preset.url ?? "",
  });
  const [draft, setDraft] = useState<SpoolDraft | null>(null);
  const [book, setBook] = useState("");
  const [gross, setGross] = useState("");
  const usage = useQuery({ queryKey: ["spool-usage", s?.id], queryFn: () => api.spoolUsage(s!.id), enabled: !!s });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["spools"] });
    void qc.invalidateQueries({ queryKey: ["spool-usage", s?.id] });
    void qc.invalidateQueries({ queryKey: ["live"] });
  };
  const num = (x: string) => (x.trim() === "" ? null : Number(x.replace(",", ".")));
  const input = (): SpoolInput => ({
    brand: v.brand.trim(),
    material: v.material.trim() || "PLA",
    name: v.name.trim(),
    color: v.color.toUpperCase(),
    color_name: v.color_name.trim(),
    net_g: num(v.net_g) ?? netDefault,
    tare_g: num(v.tare_g),
    price: num(v.price),
    price_sale: num(v.price_sale),
    profile_id: v.profile_id || null,
    nozzle_min: num(v.nozzle_min),
    nozzle_max: num(v.nozzle_max),
    bed_temp: num(v.bed_temp),
    dry_temp: num(v.dry_temp),
    dry_hours: num(v.dry_hours),
    url: v.url.trim(),
    location: v.location.trim(),
    note: v.note,
  });

  const save = useMutation({
    mutationFn: async () => {
      const b = input();
      const rest = Math.max(0, num(v.rest) ?? b.net_g);
      if (!s) return (await api.addSpool({ ...b, used_g: Math.max(0, b.net_g - rest), count: Math.max(1, Math.min(20, Number(v.count) || 1)) }), undefined);
      const r = await api.updateSpool(s.id, b);
      // Rest von Hand geändert: als Korrektur buchen, damit der Verlauf stimmt
      const net = b.net_g;
      const before = Math.max(0, net - s.used_g);
      if (Math.abs(before - rest) >= 0.5) await api.bookUsage(s.id, { grams: Math.round((before - rest) * 10) / 10, note: "Korrektur" });
      return r.pushed;
    },
    onSuccess: (pushed) => (pushedToast(toast, pushed, s ? "Spule gesichert" : "Spule ins Regal gestellt"), refresh(), onClose()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const act = useMutation({
    mutationFn: (f: () => Promise<unknown>) => f(),
    onSuccess: (r) => (pushedToast(toast, (r as { pushed?: Pushed[] } | undefined)?.pushed), refresh()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  // Link-Import: das Modell liest die Produktseite, das Formular übernimmt alles Gefundene (Rest bleibt bei bestehenden Spulen)
  const scrape = useMutation({
    mutationFn: () => api.scrapeSpool(v.url.trim()),
    onSuccess: (d) => {
      setDraft(d);
      const f = (x: number | null, old: string) => (x != null ? str(x) : old);
      setV((o) => ({
        ...o,
        brand: d.brand || o.brand,
        material: d.material || o.material,
        name: d.name || o.name,
        color: d.color ?? o.color,
        color_name: d.color_name || o.color_name,
        net_g: f(d.net_g, o.net_g),
        rest: s ? o.rest : f(d.net_g, o.rest),
        tare_g: f(d.tare_g, o.tare_g),
        price: f(d.price, o.price),
        price_sale: d.price != null ? (d.price_sale != null ? str(d.price_sale) : "") : o.price_sale,
        profile_id: s?.rfid ? o.profile_id : (d.profile_id ?? o.profile_id),
        nozzle_min: f(d.nozzle_min, o.nozzle_min),
        nozzle_max: f(d.nozzle_max, o.nozzle_max),
        bed_temp: f(d.bed_temp, o.bed_temp),
        dry_temp: f(d.dry_temp, o.dry_temp),
        dry_hours: f(d.dry_hours, o.dry_hours),
        note: d.note && !o.note.includes(d.note) ? (o.note ? `${o.note}\n${d.note}` : d.note) : o.note,
      }));
      toast("Angaben übernommen, bitte prüfen");
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const net = num(v.net_g) ?? netDefault;
  const rest = num(v.rest) ?? net;
  const valid = /^#[0-9a-f]{6}$/i.test(v.color);
  const regular = num(v.price);
  const sale = num(v.price_sale);
  const discount = regular && sale != null && sale < regular ? Math.round((1 - sale / regular) * 100) : 0;
  const brands = [...new Set(all.map((x) => x.brand).filter(Boolean))];
  const places = [...new Set(all.map((x) => x.location).filter(Boolean))];
  const trays = live.flatMap((l) => l.trays.map((t) => ({ printer: l.id, t })));
  const profile = profileById(v.profile_id);
  const auto = autoProfile(v.material, v.name);
  const shown = profile ?? auto;
  const urlOk = /^https?:\/\/\S+\.\S+/i.test(v.url.trim());

  return (
    <Dialog title={s ? spoolTitle(s) : "Neue Spule"} onClose={onClose} wide>
      <form
        className="grid gap-5 sm:grid-cols-[200px_minmax(0,1fr)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) save.mutate();
        }}
      >
        <div className="flex flex-col items-center gap-3 sm:sticky sm:top-0 sm:self-start">
          <div className="shelf-wall w-full rounded-2xl px-6 pt-5 pb-0">
            <SpoolArt
              color={valid ? v.color : "#888888"}
              fraction={net > 0 ? rest / net : 0}
              spinning={!!s && activeSpools(live).has(s.id)}
              glow={!!s && activeSpools(live).has(s.id)}
              wrapped={!!s && awaitsChip(s)}
              className="mx-auto w-full max-w-44"
            />
            <div className="shelf-board relative -mx-6 mt-1 h-3" />
          </div>
          <div className="text-center">
            <div className="text-2xl font-extrabold tnum">{fmtG(Math.max(0, rest))}</div>
            <div className="text-xs text-ink3 tnum">
              von {fmtG(net)} · {net > 0 ? Math.round((Math.max(0, rest) / net) * 100) : 0} %
            </div>
            {s?.slot && <div className="mt-1.5 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">{s.slot}</div>}
            {s && awaitsChip(s) && (
              <div className="mt-2.5 max-w-64 rounded-xl border border-dashed border-accent/60 bg-accent-soft px-3 py-2 text-left">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-accent">
                  <Nfc size={14} /> Wartet auf Chip
                </div>
                <p className="mt-1 text-[11px] leading-snug text-ink2">
                  Liegt eingeschweißt im Lager. Sobald du sie ins AMS legst, liest der Drucker den Chip und die App hängt ihn an diese Spule
                  (gleiche Sorte, ähnliche Farbe, älteste zuerst). Ab dann folgt der Füllstand dem AMS.
                </p>
              </div>
            )}
            {s?.rfid && (
              <div className="mt-1.5 flex items-center justify-center gap-1 text-xs text-ink3">
                <Nfc size={13} /> Bambu RFID · {s.track === "rfid" ? "Schätzung des Druckers" : "eigene Zählung"}
              </div>
            )}
            {s?.rfid && (
              <div className="mt-2 max-w-60 text-[11px] leading-snug text-ink3">
                {s.track === "rfid"
                  ? "Der Rest folgt dem Füllstand, den das AMS meldet. Ab einer vollen Spule, nach dem Wiegen oder einer Korrektur zählt die App selbst."
                  : s.rfid_full
                    ? "Das AMS meldet 100 %, die App zählt deshalb selbst. Meldet es nach dem Einlesen weniger, gilt wieder sein Wert."
                    : "Die App zieht den Verbrauch jedes Drucks ab, der Füllstand des AMS zählt nicht mehr."}
                <button
                  type="button"
                  className="mt-1 block w-full font-bold text-accent hover:underline"
                  onClick={() => act.mutate(() => api.updateSpool(s.id, { track: s.track === "rfid" ? "eigen" : "rfid" }))}
                >
                  {s.track === "rfid" ? "Ab jetzt selbst zählen" : "Wieder dem AMS folgen"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Produktlink</Label>
            <div className="mt-1.5 flex gap-2">
              <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-card px-2.5 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
                <Link2 size={15} className="shrink-0 text-ink3" />
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  value={v.url}
                  onChange={set("url")}
                  inputMode="url"
                  placeholder="https://… Shop oder Hersteller"
                  aria-label="Produktlink"
                />
              </label>
              <Button type="button" disabled={!urlOk} busy={scrape.isPending} onClick={() => scrape.mutate()}>
                <Sparkles size={15} /> {scrape.isPending ? "Liest …" : "Auslesen"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink3">
              {scrape.isPending
                ? "Das Modell liest die Seite, das dauert meist 20–60 Sekunden."
                : "Füllt Marke, Sorte, Farbe, Preis und Temperaturen aus und wählt das passende Bambu-Profil."}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Marke">
              <input className="field" value={v.brand} onChange={set("brand")} list="brands" placeholder="Bambu Lab" />
            </Field>
            <Field label="Material">
              <input className="field" value={v.material} onChange={set("material")} list="materials" required />
            </Field>
          </div>
          <datalist id="brands">
            {[...new Set([...brands, "Bambu Lab", "Polymaker", "Prusament", "eSun", "Sunlu", "Elegoo", "Extrudr", "Das Filament"])].map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <datalist id="materials">
            {MATERIALS.flatMap((m) => [m, `${m}-CF`]).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sorte">
              <SorteField
                className="field"
                brand={v.brand}
                value={v.name}
                onText={(name) => setV({ ...v, name })}
                onLine={(l) => setV({ ...v, name: l.name, material: l.material, color_name: carryColorName(l, v.color_name), profile_id: s?.rfid ? v.profile_id : (l.profile_id ?? v.profile_id) })}
              />
            </Field>
            <Field label="Farbname">
              <input className="field" value={v.color_name} onChange={set("color_name")} placeholder={autoColorName({ color: v.color, brand: v.brand, name: v.name, profile_id: v.profile_id }) || "Feuerrot"} />
            </Field>
          </div>
          <div>
            <Label>Farbe</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <label
                className="relative flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full text-sm font-black text-ink3 shadow-seg"
                style={{ background: valid ? v.color : "var(--c-fill)" }}
              >
                {!valid && "?"}
                <input type="color" value={valid ? v.color.toLowerCase() : "#888888"} onChange={(e) => setV({ ...v, color: e.target.value.toUpperCase() })} className="absolute inset-0 opacity-0" aria-label="Farbe wählen" />
              </label>
              <input className="h-8 w-24 rounded-lg bg-card px-2 font-mono text-sm uppercase shadow-seg outline-none focus:shadow-[0_0_0_2px_var(--c-accent)]" value={v.color} onChange={set("color")} placeholder="#RRGGBB" aria-label="Farbe als Hex" />
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setV({ ...v, color: c })}
                  className={`size-6 rounded-full ${v.color.toUpperCase() === c ? "ring-2 ring-accent ring-offset-2 ring-offset-[var(--c-bg)]" : ""}`}
                  style={{ background: c, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)" }}
                  aria-label={c}
                />
              ))}
            </div>
            <div className="mt-3 empty:hidden">
              <CatalogColors brand={v.brand} line={v.name} colorName={v.color_name} onPick={(color_name, hex) => setV({ ...v, color_name, color: hex ? `#${hex}` : "" })} />
            </div>
            {!s && /bambu/i.test(v.brand) && (
              <p className="mt-2 text-[11px] leading-snug text-ink3">
                Bambu-Spule mit Chip? Einfach vorab ins Regal stellen: Beim ersten Einlegen ins AMS übernimmt sie den Chip (gleiche Sorte und Farbe,
                älteste zuerst), statt doppelt angelegt zu werden.
              </p>
            )}
            {!!draft?.colors.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {draft.colors.map((c) => (
                  <button
                    type="button"
                    key={c.name + c.hex}
                    onClick={() => setV({ ...v, color: c.hex, color_name: c.name })}
                    className={`flex h-7 items-center gap-1.5 rounded-full bg-card pr-2.5 pl-1 text-xs font-semibold shadow-seg ${v.color_name === c.name ? "ring-2 ring-accent" : ""}`}
                  >
                    <span className="size-5 rounded-full" style={{ background: c.hex, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.18)" }} />
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Netto (g)">
              <input className="field tnum" inputMode="decimal" value={v.net_g} onChange={set("net_g")} required />
            </Field>
            <Field label="Rest (g)">
              <input className="field tnum" inputMode="decimal" value={v.rest} onChange={set("rest")} />
            </Field>
            <Field label="Leer (g)">
              <input className="field tnum" inputMode="decimal" value={v.tare_g} onChange={set("tare_g")} placeholder="Spule" />
            </Field>
          </div>
          {!s?.rfid && (
            <div className="-mt-1 space-y-1">
              <RestChips net={net} onPick={(r) => setV({ ...v, rest: String(r) })} />
              <p className="text-[11px] leading-snug text-ink3">
                {s ? "Rest geändert: wird als Korrektur gebucht, danach zieht die App jeden Druck davon ab." : "Angebrochene Spule? Rest eintragen oder schätzen, ab dann zieht die App jeden Druck davon ab."}
              </p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Preis (${cur})`}>
              <input className="field tnum" inputMode="decimal" value={v.price} onChange={set("price")} placeholder="19,99" />
            </Field>
            <Field label={discount ? `Reduziert · −${discount} %` : `Reduziert (${cur})`}>
              <input className="field tnum" inputMode="decimal" value={v.price_sale} onChange={set("price_sale")} placeholder="falls Angebot" />
            </Field>
          </div>
          <div className="space-y-3 rounded-xl bg-card p-3 shadow-card">
            <div>
              <Label>Druckprofil</Label>
              {s?.rfid ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold">
                  <Nfc size={14} className="text-ink3" /> {profile?.name ?? (v.profile_id || "unbekannt")}
                  <span className="text-xs font-normal text-ink3">vom Chip, stellt der Drucker selbst ein</span>
                </div>
              ) : (
                <>
                  <select className="field mt-1.5" value={v.profile_id} onChange={set("profile_id")} aria-label="Druckprofil">
                    <option value="">Automatisch{auto ? ` (${auto.name})` : ""}</option>
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
                  <p className="mt-1 text-[11px] leading-snug text-ink3">
                    {draft?.profile_reason && draft.profile_id === v.profile_id
                      ? draft.profile_reason
                      : "Geht beim Einlegen ins AMS an den Drucker, mit Farbe und Düsentemperatur. Bambu-Profile laufen meist am besten, auch für Fremdfilament."}
                  </p>
                </>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Düse min °C">
                <input className="field tnum" inputMode="numeric" value={v.nozzle_min} onChange={set("nozzle_min")} placeholder={shown ? String(shown.nozzle_min) : ""} />
              </Field>
              <Field label="Düse max °C">
                <input className="field tnum" inputMode="numeric" value={v.nozzle_max} onChange={set("nozzle_max")} placeholder={shown ? String(shown.nozzle_max) : ""} />
              </Field>
              <Field label="Bett °C">
                <input className="field tnum" inputMode="numeric" value={v.bed_temp} onChange={set("bed_temp")} placeholder={shown ? String(shown.bed) : ""} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Trocknen °C">
                <input className="field tnum" inputMode="numeric" value={v.dry_temp} onChange={set("dry_temp")} placeholder="55" />
              </Field>
              <Field label="Trocknen Stunden">
                <input className="field tnum" inputMode="decimal" value={v.dry_hours} onChange={set("dry_hours")} placeholder="8" />
              </Field>
            </div>
          </div>
          <Field label="Lagerort">
            <input className="field" value={v.location} onChange={set("location")} list="places" placeholder="Regal, Trockenbox …" />
          </Field>
          <datalist id="places">
            {places.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {!s && (
            <Field label="Anzahl gleicher Spulen">
              <input className="field tnum" inputMode="numeric" value={v.count} onChange={set("count")} />
            </Field>
          )}
          <Field label="Notiz">
            <textarea className="field min-h-14 resize-y" value={v.note} onChange={set("note")} placeholder="Trocknen bei 55 °C, Druckprofil …" />
          </Field>

          {s && (
            <div className="space-y-3 rounded-xl bg-card p-3 shadow-card">
              <div className="grid gap-2">
                <div className="flex gap-2">
                  <input className="h-9 min-w-0 flex-1 rounded-lg bg-bg px-2.5 text-sm shadow-seg tnum" inputMode="decimal" placeholder="Verbrauch in g" value={book} onChange={(e) => setBook(e.target.value)} />
                  <Button type="button" disabled={!num(book)} onClick={() => act.mutate(() => api.bookUsage(s.id, { grams: num(book)!, note: "von Hand" }).then(() => setBook("")))}>
                    Abziehen
                  </Button>
                </div>
                <div className="flex gap-2">
                  <input
                    className="h-9 min-w-0 flex-1 rounded-lg bg-bg px-2.5 text-sm shadow-seg tnum"
                    inputMode="decimal"
                    placeholder={s.tare_g == null ? "Küchenwaage: erst Leer (g)" : "Küchenwaage: Gewicht in g"}
                    disabled={s.tare_g == null}
                    value={gross}
                    onChange={(e) => setGross(e.target.value)}
                  />
                  <Button type="button" disabled={!num(gross)} onClick={() => act.mutate(() => api.bookUsage(s.id, { gross_g: num(gross)! }).then(() => setGross("")))}>
                    <Scale size={15} /> Gewogen
                  </Button>
                </div>
              </div>
              {!s.rfid && (
                <select
                  className="h-9 w-full rounded-lg bg-bg px-2 text-sm font-semibold shadow-seg"
                  value={s.printer_id != null && s.tray != null ? `${s.printer_id}:${s.tray}` : ""}
                  onChange={(e) => {
                    const [p, t] = e.target.value.split(":").map(Number);
                    act.mutate(() => api.setSlot(s.id, e.target.value ? { printer_id: p!, tray: t! } : null));
                  }}
                  aria-label="AMS-Fach"
                >
                  <option value="">Nicht im Drucker</option>
                  {trays.map(({ printer, t }) => (
                    <option key={`${printer}:${t.id}`} value={`${printer}:${t.id}`}>
                      Fach {t.label} {t.type ? `(${t.name || t.type})` : t.loaded ? "(belegt)" : "(leer)"}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" kind="ghost" onClick={() => onCopy({ ...input(), net_g: s.net_g })}>
                  <Copy size={15} /> Nachkaufen
                </Button>
                <Button type="button" kind="ghost" onClick={() => act.mutate(() => api.updateSpool(s.id, { archived: !s.archived }).then(onClose))}>
                  {s.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />} {s.archived ? "Zurück ins Regal" : "Leer, archivieren"}
                </Button>
                <Button
                  type="button"
                  kind="ghost"
                  className="text-bad"
                  onClick={() => confirm(`„${spoolTitle(s)}“ endgültig löschen? Der Verbrauchsverlauf geht mit.`) && act.mutate(() => api.deleteSpool(s.id).then(onClose))}
                >
                  <Trash2 size={15} /> Löschen
                </Button>
              </div>
            </div>
          )}

          {s && !!usage.data?.length && (
            <div>
              <Label>Verbrauch</Label>
              <div className="mt-1.5 max-h-56 divide-y divide-sep overflow-y-auto rounded-xl bg-card shadow-card">
                {usage.data.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">
                        {u.print_name ?? (u.source === "waage" ? "Gewogen" : u.source === "rfid" ? "Abgleich mit dem AMS" : u.note || "Von Hand")}
                      </div>
                      <div className="text-xs text-ink3 tnum">
                        {fmtDate(u.created_at)}
                        {u.print_name && u.note ? ` · ${u.note}` : u.source === "waage" || u.source === "rfid" ? ` · ${u.note}` : ""}
                      </div>
                    </div>
                    <div className={`shrink-0 font-bold tnum ${u.grams < 0 ? "text-good" : ""}`}>
                      {u.grams > 0 ? "−" : "+"}
                      {Math.abs(u.grams).toLocaleString("de-DE", { maximumFractionDigits: 1 })} g
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" onClick={onClose}>
              Abbrechen
            </Button>
            <Button kind="primary" busy={save.isPending} disabled={!valid}>
              {s ? "Sichern" : "Ins Regal"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

