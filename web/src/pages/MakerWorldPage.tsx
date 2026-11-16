// MakerWorld durchsuchen: Suche und Modellseiten über die öffentliche API, Druckprofile mit Zeit, Gramm und Filamenten.
// Dateien (3MF je Profil) lädt der Server mit dem Bambu-Konto (Einstellungen → MakerWorld); ohne Konto nur Angaben und Bilder.
// „Drucken“ übernimmt das Profil ins Modell und slict es im Server, danach folgt der Druckdialog.
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Clock, Download, ExternalLink, Heart, Layers, Library as LibraryIcon, Loader2, LogIn, Printer, Scale, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PRINTER_MODELS, type ModelFile } from "../../../shared/types.ts";
import { api, type MakerWorldModel, type MakerWorldProfile } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { go, href } from "../lib/router.ts";
import { useBambuAccount } from "../ui/BambuAccount.tsx";
import { Button, Dialog, LoadError, useToast } from "../ui/controls.tsx";
import { PrintDialog } from "../ui/PrintDialog.tsx";
import { SliceAndPrint, useSlicer } from "../ui/SliceDialog.tsx";
import { Card, Grid, LibraryTabs, load, num, save } from "./PrintablesPage.tsx";

const ORDERS = [
  ["hotScore", "Beliebt"],
  ["downloadCount", "Meiste Downloads"],
  ["likeCount", "Meiste Likes"],
  ["", "Passendste"],
] as const;
type Order = (typeof ORDERS)[number][0];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const duration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min` : `${min} min`);

export function MakerWorldPage({ id }: { id?: string }) {
  const [input, setInput] = useState(() => load("makerworld.q", ""));
  const [q, setQ] = useState(input);
  const [order, setOrder] = useState<Order>(() => load("makerworld.order", "hotScore"));
  const acc = useBambuAccount();
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 450);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => save("makerworld.q", q), [q]);

  const res = useInfiniteQuery({
    queryKey: ["makerworld", q, order],
    queryFn: ({ pageParam }) => api.makerworldSearch(q, order, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const n = all.reduce((s, p) => s + p.items.length, 0);
      return last.items.length && n < last.total ? n : undefined;
    },
    staleTime: 5 * 60_000,
  });
  const items = res.data?.pages.flatMap((p) => p.items) ?? [];
  const total = res.data?.pages[0]?.total ?? 0;

  return (
    <>
      <LibraryTabs active="makerworld" />
      <PageHeader title="MakerWorld" sub="Modelle mit fertigen Druckprofilen suchen, direkt drucken oder in die Bibliothek übernehmen." />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 2xl:max-w-[88rem]">
        {acc.data && !acc.data.logged_in && (
          <a
            href={href({ page: "settings", view: "makerworld" })}
            className="mb-4 flex items-center gap-3 rounded-xl bg-accent-soft px-4 py-3 text-sm text-ink2 hover:brightness-[0.98]"
          >
            <LogIn size={18} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <b className="text-ink">{acc.data.expired ? "Bambu-Anmeldung abgelaufen." : "Für Dateien bei Bambu anmelden."}</b> Suchen und Ansehen geht ohne, die 3MF
              der Druckprofile gibt MakerWorld nur mit Konto heraus.
            </span>
            <span className="shrink-0 font-semibold text-accent">{acc.data.expired ? "Neu anmelden" : "Anmelden"}</span>
          </a>
        )}
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(input.trim());
          }}
        >
          <label className="flex h-10 flex-1 items-center gap-2 rounded-xl bg-card px-3 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
            <Search size={16} className="text-ink3" />
            <input className="field text-[15px]" placeholder="Auf MakerWorld suchen, z. B. Kabelhalter" value={input} onChange={(e) => setInput(e.target.value)} enterKeyHint="search" />
            {input && (
              <button type="button" onClick={() => (setInput(""), setQ(""))} className="text-ink3 hover:text-ink" aria-label="Suche leeren">
                <X size={16} />
              </button>
            )}
          </label>
          <select
            className="h-10 rounded-xl bg-card px-3 text-sm font-semibold shadow-seg"
            value={order}
            onChange={(e) => (setOrder(e.target.value as Order), save("makerworld.order", e.target.value))}
            aria-label="Sortierung"
          >
            {ORDERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </form>

        <div className="mt-2.5 h-5 text-xs text-ink3">
          {res.isSuccess && (total ? `${total >= 10_000 ? "über 10.000" : total.toLocaleString("de-DE")} Modelle` : "Nichts gefunden.")}
        </div>

        <div className="mt-2">
          {res.isError ? (
            <LoadError error={res.error} retry={() => res.refetch()} />
          ) : res.isPending ? (
            <Grid>
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="skeleton aspect-[4/5] rounded-2xl" />
              ))}
            </Grid>
          ) : (
            <Grid>
              {items.map((m) => (
                <Card key={m.id} m={m} to={href({ page: "makerworld", id: m.id })} />
              ))}
            </Grid>
          )}
          {res.hasNextPage && (
            <div className="mt-5 flex justify-center">
              <Button busy={res.isFetchingNextPage} onClick={() => res.fetchNextPage()}>
                Mehr laden
              </Button>
            </div>
          )}
        </div>
      </div>
      {id && <Detail key={id} id={id} onClose={() => go({ page: "makerworld" })} />}
    </>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const d = useQuery({ queryKey: ["makerworld-model", id], queryFn: () => api.makerworld(id), staleTime: 5 * 60_000 });
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const acc = useBambuAccount();
  const canSlice = useSlicer();
  const [img, setImg] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [slice, setSlice] = useState<ModelFile | null>(null);
  const [slicePlate, setSlicePlate] = useState<number | null>(null);
  const [print, setPrint] = useState<ModelFile | null>(null);
  const [all, setAll] = useState(false);
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const m = d.data;
  const loggedIn = !!acc.data?.logged_in;

  // Eigene Drucker: Profile dafür zuerst und markiert
  const mine = new Set((printers.data ?? []).map((p) => norm(PRINTER_MODELS.find((x) => x.id === p.model)?.label ?? p.model)));
  const fits = (p: MakerWorldProfile) => mine.has(norm(p.printer));
  const profiles = [...(m?.profiles ?? [])].sort((a, b) => +fits(b) - +fits(a) || +b.default - +a.default || b.prints - a.prints);

  const refresh = () => Promise.all(["models", "tags", "makerworld", "makerworld-model", "bambu-account"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

  /** Modell übernehmen, mit Profil samt 3MF; `then` bekommt Modell und Datei */
  const run = async (key: string, profile: string | null, then: (modelId: number, fileId: number | null) => Promise<void> | void) => {
    setBusy(key);
    setStatus("Verbinde …");
    ac.current = new AbortController();
    try {
      const r = await api.makerworldImport(id, profile, setStatus, ac.current.signal);
      await refresh();
      if (r.note) toast(r.note, "fehler");
      await then(r.id, r.file_id);
    } catch (e) {
      if (!ac.current?.signal.aborted) toast((e as Error).message, "fehler");
      void qc.invalidateQueries({ queryKey: ["bambu-account"] });
    } finally {
      setBusy(null);
      setStatus("");
    }
  };

  const take = (p: MakerWorldProfile | null) =>
    run(p ? `take:${p.id}` : "import", p?.id ?? null, (modelId, fileId) => {
      toast(fileId ? "Druckprofil in der Bibliothek" : "Modell übernommen");
      go({ page: "model", id: modelId });
    });

  /** `plate` = nur diese Platte des Profils slicen und drucken */
  const printIt = (p: MakerWorldProfile, plate: number | null = null) =>
    run(plate ? `print:${p.id}:${plate}` : `print:${p.id}`, p.id, async (modelId, fileId) => {
      if (!fileId) {
        go({ page: "model", id: modelId });
        return;
      }
      setStatus("Suche die Datei …");
      const f = (await api.model(modelId)).files.find((x) => x.id === fileId);
      if (f?.kind === "gcode3mf") setPrint(f);
      else if (f && canSlice) (setSlicePlate(plate), setSlice(f));
      else go({ page: "model", id: modelId });
    });

  if (slice) return <SliceAndPrint file={slice} plate={slicePlate} onClose={() => setSlice(null)} />;
  if (print) return <PrintDialog file={print} onClose={() => setPrint(null)} />;

  return (
    <Dialog title={m?.name ?? "MakerWorld"} onClose={onClose} wide="xl">
      {d.isError ? (
        <LoadError error={d.error} retry={() => d.refetch()} />
      ) : !m ? (
        <div className="space-y-3">
          <div className="skeleton aspect-[4/3] rounded-xl" />
          <div className="skeleton h-5 w-1/2 rounded" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Oben Bilder und daneben Angaben mit Beschreibung, darunter die Druckprofile über die volle Breite */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Gallery m={m} img={img} setImg={setImg} />
          <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink2 tnum">
            {m.creator && <span className="font-semibold text-ink">{m.creator}</span>}
            <span className="flex items-center gap-1">
              <Heart size={13} /> {num(m.likes)}
            </span>
            <span className="flex items-center gap-1">
              <Download size={13} /> {num(m.downloads)}
            </span>
            <span className="flex items-center gap-1">
              <Printer size={13} /> {num(m.makes)} Drucke
            </span>
            {m.license && <span>{m.license}</span>}
            {m.paid && <span className="font-semibold text-bad">Nur gegen Punkte</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            {m.model_id ? (
              <Button kind="primary" onClick={() => go({ page: "model", id: m.model_id! })}>
                <LibraryIcon size={16} /> In der Bibliothek öffnen
              </Button>
            ) : (
              <Button kind="primary" busy={busy === "import"} disabled={!!busy} onClick={() => void take(null)} title={loggedIn ? "Mit Bildern und dem Standardprofil" : "Angaben und Bilder"}>
                <LibraryIcon size={16} /> In Bibliothek
              </Button>
            )}
            <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-ink2 hover:bg-hover">
              <ExternalLink size={15} /> Auf MakerWorld
            </a>
          </div>
          {status && <div className="text-sm text-ink2">{status}</div>}
          {m.description && (
            <section className="flex min-h-0 flex-col lg:flex-1">
              <h3 className="mb-1.5 text-xs font-bold tracking-[0.08em] text-ink3 uppercase">Beschreibung</h3>
              {/* Am Desktop so hoch wie die Bilder, darin scrollen; mobil begrenzt */}
              <div className="relative max-h-48 overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-ink2 [overflow-wrap:anywhere] lg:max-h-none lg:min-h-24 lg:flex-1 lg:basis-0">
                {m.description}
              </div>
            </section>
          )}
          {m.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {m.tags.slice(0, 12).map((t) => (
                <span key={t} className="rounded-full bg-fill px-2.5 py-1 text-xs font-semibold text-ink2">
                  #{t}
                </span>
              ))}
            </div>
          )}
          </div>
          </div>

          <section>
            <h3 className="mb-1.5 text-xs font-bold tracking-[0.08em] text-ink3 uppercase">Druckprofile</h3>
            {!loggedIn && (
              <a href={href({ page: "settings", view: "makerworld" })} className="mb-2 flex items-center gap-2 rounded-lg bg-fill px-3 py-2 text-sm text-ink2 hover:bg-hover">
                <LogIn size={15} className="shrink-0 text-accent" />
                <span>Die 3MF der Profile gibt es nur mit Bambu-Konto: Einstellungen → MakerWorld.</span>
              </a>
            )}
            {profiles.length ? (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(all ? profiles : profiles.slice(0, 8)).map((p) => (
                  <Profile
                    key={p.id}
                    p={p}
                    fits={fits(p)}
                    busy={busy}
                    disabled={!!busy || !loggedIn}
                    canPrint={canSlice}
                    onPrint={(plate) => void printIt(p, plate)}
                    onTake={() => void take(p)}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink3">Keine Druckprofile.</p>
            )}
            {profiles.length > 8 && !all && (
              <button onClick={() => setAll(true)} className="mt-2 text-sm font-semibold text-accent hover:underline">
                Alle {profiles.length} Profile zeigen
              </button>
            )}
            <p className="mt-1.5 text-xs text-ink3">
              {canSlice
                ? "„Drucken“ legt das Profil als 3MF ins Modell, slict es mit den Profilen deines Druckers und startet den Druck. Profile für andere Drucker gehen auch, das Slicen passt sie an. Bei mehreren Platten wählst du eine aus und nur die wird geslict."
                : "„In Bibliothek“ legt die 3MF ins Modell. Drucken: in Bambu Studio oder Orca öffnen und slicen."}
            </p>
          </section>

        </div>
      )}
    </Dialog>
  );
}

function Gallery({ m, img, setImg }: { m: MakerWorldModel; img: number; setImg: (i: number) => void }) {
  if (!m.images.length) return null;
  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-fill sm:aspect-[16/10]">
        <img src={(m.images[img] ?? m.images[0])!.large} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-contain" />
      </div>
      {m.images.length > 1 && (
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {m.images.map((src, i) => (
            <button
              key={src.small + i}
              onClick={() => setImg(i)}
              className={`size-14 shrink-0 overflow-hidden rounded-lg bg-fill ${i === img ? "ring-2 ring-accent" : "opacity-75 hover:opacity-100"}`}
              aria-label={`Bild ${i + 1}`}
            >
              <img src={src.small} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Ein Druckprofil: Bild, Drucker, Zeit, Gramm, Filamentfarben und Knöpfe */
function Profile(props: { p: MakerWorldProfile; fits: boolean; busy: string | null; disabled: boolean; canPrint: boolean; onPrint: (plate: number | null) => void; onTake: () => void }) {
  const { p, fits, busy } = props;
  const [open, setOpen] = useState(false);
  const many = p.plate_list.length > 1;
  return (
    <li className={`rounded-xl bg-card p-2.5 shadow-card ${fits ? "ring-1 ring-accent/60" : ""} ${open ? "col-span-full" : ""}`}>
    <div className="flex gap-3">
      <span className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-fill">
        {p.image ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" /> : <Layers size={22} className="absolute inset-0 m-auto text-ink4" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="line-clamp-2 text-sm leading-snug font-semibold" title={p.title}>
          {p.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink3 tnum">
          {p.printer && (
            <span className={fits ? "font-bold text-accent" : ""} title={p.others.length ? `Auch für ${p.others.join(", ")}` : undefined}>
              {p.printer}
              {p.nozzle ? ` · ${String(p.nozzle).replace(".", ",")} mm` : ""}
            </span>
          )}
          {p.minutes != null && (
            <span className="flex items-center gap-0.5">
              <Clock size={11} /> {duration(p.minutes)}
            </span>
          )}
          {p.grams != null && (
            <span className="flex items-center gap-0.5">
              <Scale size={11} /> {p.grams} g
            </span>
          )}
          {!many && p.plates && p.plates > 1 && <span>{p.plates} Platten</span>}
        </div>
        {p.filaments.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {p.filaments.slice(0, 8).map((f, i) => (
              <span
                key={i}
                className="size-3.5 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                style={{ background: f.color || "#888" }}
                title={`${f.type}${f.grams ? `, ${f.grams} g` : ""}`}
              />
            ))}
            <span className="ml-0.5 text-[11px] text-ink3">{[...new Set(p.filaments.map((f) => f.type))].join(", ")}</span>
          </div>
        )}
        {many && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="mt-1.5 flex h-7 w-fit items-center gap-1 rounded-md bg-fill px-2 text-xs font-semibold text-ink2 hover:bg-hover hover:text-ink"
          >
            <Layers size={12} /> {p.plate_list.length} Platten
            <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
          {props.canPrint && (
            <Button
              kind="primary"
              className="h-8! flex-auto px-2.5!"
              disabled={props.disabled}
              onClick={() => props.onPrint(null)}
              aria-label={`${p.title} drucken`}
              title={many ? "Platte im nächsten Schritt wählen" : undefined}
            >
              {busy === `print:${p.id}` ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Drucken
            </Button>
          )}
          <Button className="h-8! flex-auto px-2.5!" disabled={props.disabled} onClick={props.onTake} title="3MF dieses Profils ins Modell legen" aria-label={`${p.title} in die Bibliothek`}>
            {busy === `take:${p.id}` ? <Loader2 size={14} className="animate-spin" /> : <LibraryIcon size={14} />} Bibliothek
          </Button>
        </div>
      </div>
    </div>
      {open && many && (
        <ul className="anim-fade mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 border-t border-sep pt-2.5">
          {p.plate_list.map((pl) => (
            <li key={pl.index} className="flex flex-col overflow-hidden rounded-lg bg-fill">
              <span className="relative block aspect-square bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
                {pl.image ? (
                  <img src={pl.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain" />
                ) : (
                  <Layers size={20} className="absolute inset-0 m-auto text-ink4" />
                )}
                <span className="absolute top-1.5 left-1.5 grid h-5 min-w-5 place-items-center rounded-md bg-bg/85 px-1 text-[11px] font-bold tnum">{pl.index}</span>
              </span>
              <div className="flex flex-1 flex-col p-2">
                <div className="line-clamp-2 text-xs leading-snug font-semibold" title={pl.name || `Platte ${pl.index}`}>
                  {pl.name || `Platte ${pl.index}`}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink3 tnum">
                  {pl.minutes != null && (
                    <span className="flex items-center gap-0.5">
                      <Clock size={10} /> {duration(pl.minutes)}
                    </span>
                  )}
                  {pl.grams != null && (
                    <span className="flex items-center gap-0.5">
                      <Scale size={10} /> {pl.grams} g
                    </span>
                  )}
                </div>
                {pl.filaments.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {pl.filaments.slice(0, 8).map((f, i) => (
                      <span
                        key={i}
                        className="size-2.5 rounded-full ring-1 ring-black/15 dark:ring-white/20"
                        style={{ background: f.color || "#888" }}
                        title={`${f.type}${f.grams ? `, ${f.grams} g` : ""}`}
                      />
                    ))}
                  </div>
                )}
                {props.canPrint && (
                  <div className="mt-auto pt-2">
                  <Button
                    kind="primary"
                    className="h-7! w-full px-2! text-xs!"
                    disabled={props.disabled}
                    onClick={() => props.onPrint(pl.index)}
                    aria-label={`Platte ${pl.index} drucken`}
                    title="Nur diese Platte slicen und drucken"
                  >
                    {busy === `print:${p.id}:${pl.index}` ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />} Drucken
                  </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
