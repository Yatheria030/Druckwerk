// Printables durchsuchen: Suche und Sortierung über die öffentliche API, Modell als Dialog mit Bildern und Dateien.
// Dateien gehen direkt in Orca (orcaslicer://open), als Download (für Bambu Studio, das nur MakerWorld-Links annimmt)
// oder mit „In Bibliothek“ samt Bildern ins eigene Modell. „Drucken“ übernimmt das Modell und slict die Datei im Server
// (Bambu Studio), danach folgt der Druckdialog wie in Bambu Handy.
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkCheck, Box, Download, ExternalLink, Heart, Layers, Library as LibraryIcon, Loader2, Printer, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelFile } from "../../../shared/types.ts";
import { api, type PrintablesFile, type PrintablesItem, type PrintablesModel } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { go, href } from "../lib/router.ts";
import { Button, Dialog, LoadError, useToast } from "../ui/controls.tsx";
import { PrintDialog } from "../ui/PrintDialog.tsx";
import { SliceAndPrint, useSlicer } from "../ui/SliceDialog.tsx";

const ORDERS = [
  ["popular", "Beliebt"],
  ["latest", "Neu"],
  ["rating", "Beste Bewertung"],
  ["makes_count", "Meiste Drucke"],
  ["best_match", "Passendste"],
] as const;
type Order = (typeof ORDERS)[number][0];

export const load = <T,>(k: string, d: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? "null") as T) ?? d;
  } catch {
    return d;
  }
};
export const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export const num = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")}k` : String(n));
const size = (b: number | null) => (b == null ? "" : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
/** Orca öffnet Modelldateien, keine G-Codes oder Bilder */
const slicable = (f: PrintablesFile) => f.type !== "gcode" && /\.(stl|3mf|obj|step|stp|amf)$/i.test(f.name);
/** Druckbar über die App: geslicte Bambu-Datei direkt, Modelldateien (ohne AMF) nach dem Slicen im Server */
const sliced = (f: PrintablesFile) => /\.gcode\.3mf$/i.test(f.name);
const toSlice = (f: PrintablesFile) => f.type !== "gcode" && !sliced(f) && /\.(stl|3mf|obj|step|stp)$/i.test(f.name);
/** Beste Datei für „Drucken“: geslict, sonst 3MF (Platten, Farben), sonst die erste STL/OBJ/STEP */
const bestFile = (files: PrintablesFile[], canSlice: boolean) =>
  files.find(sliced) ?? (canSlice ? (files.find((f) => toSlice(f) && /\.3mf$/i.test(f.name)) ?? files.find(toSlice)) : undefined);

/** Unterseiten der Bibliothek auf dem Handy (Desktop: Seitenleiste) */
export function LibraryTabs({ active }: { active: "modelle" | "printables" | "makerworld" }) {
  const tab = (on: boolean) => `flex h-8 flex-1 items-center justify-center rounded-md px-3 text-[13px] font-semibold ${on ? "bg-[var(--c-seg-active)] text-ink shadow-seg" : "text-ink2"}`;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6 md:hidden">
      <nav className="flex rounded-lg bg-fill p-0.5">
        <a href={href({ page: "library" })} className={tab(active === "modelle")}>
          Modelle
        </a>
        <a href={href({ page: "printables" })} className={tab(active === "printables")}>
          Printables
        </a>
        <a href={href({ page: "makerworld" })} className={tab(active === "makerworld")}>
          MakerWorld
        </a>
      </nav>
    </div>
  );
}

export function PrintablesPage({ id }: { id?: string }) {
  const [input, setInput] = useState(() => load("printables.q", ""));
  const [q, setQ] = useState(input);
  const [order, setOrder] = useState<Order>(() => load("printables.order", "popular"));
  // Tippen sucht nach kurzer Pause, Enter sofort
  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 450);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => save("printables.q", q), [q]);

  const res = useInfiniteQuery({
    queryKey: ["printables", q, order],
    queryFn: ({ pageParam }) => api.printablesSearch(q, order, pageParam),
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
      <LibraryTabs active="printables" />
      <PageHeader title="Printables" sub="Modelle suchen und direkt drucken, in Orca öffnen oder mit Bildern in die Bibliothek übernehmen." />
      <div className="mx-auto max-w-6xl px-4 sm:px-6 2xl:max-w-[88rem]">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(input.trim());
          }}
        >
          <label className="flex h-10 flex-1 items-center gap-2 rounded-xl bg-card px-3 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
            <Search size={16} className="text-ink3" />
            <input className="field text-[15px]" placeholder="Auf Printables suchen, z. B. Kabelhalter" value={input} onChange={(e) => setInput(e.target.value)} enterKeyHint="search" />
            {input && (
              <button type="button" onClick={() => (setInput(""), setQ(""))} className="text-ink3 hover:text-ink" aria-label="Suche leeren">
                <X size={16} />
              </button>
            )}
          </label>
          <select
            className="h-10 rounded-xl bg-card px-3 text-sm font-semibold shadow-seg"
            value={order}
            onChange={(e) => (setOrder(e.target.value as Order), save("printables.order", e.target.value))}
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
                <Card key={m.id} m={m} to={href({ page: "printables", id: m.id })} />
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
      {id && <Detail key={id} id={id} onClose={() => go({ page: "printables" })} />}
    </>
  );
}

export const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">{children}</div>
);

export function Card({ m, to }: { m: PrintablesItem; to: string }) {
  return (
    <a href={to} className="group overflow-hidden rounded-2xl bg-card shadow-card transition-shadow hover:shadow-pop">
      <div className="relative aspect-square overflow-hidden bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
        {m.image ? (
          <img src={m.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-cover transition-transform group-hover:scale-[1.03]" />
        ) : (
          <Box className="absolute inset-0 m-auto text-ink4" size={42} strokeWidth={1.4} />
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          {m.model_id && (
            <span className="grid size-7 place-items-center rounded-full bg-card/90 text-accent shadow-card" title="Schon in der Bibliothek">
              <BookmarkCheck size={14} />
            </span>
          )}
          {m.paid && <span className="rounded-full bg-card/90 px-2 py-1 text-[11px] font-bold shadow-card">Kostenpflichtig</span>}
        </div>
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <div className="line-clamp-2 text-sm leading-snug font-bold">{m.name}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-ink3 tnum">
          <span className="min-w-0 truncate">{m.creator}</span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <Heart size={11} /> {num(m.likes)}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            <Download size={11} /> {num(m.downloads)}
          </span>
        </div>
      </div>
    </a>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const d = useQuery({ queryKey: ["printables-model", id], queryFn: () => api.printables(id), staleTime: 5 * 60_000 });
  const [img, setImg] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [slice, setSlice] = useState<ModelFile | null>(null);
  const [print, setPrint] = useState<ModelFile | null>(null);
  const canSlice = useSlicer();
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const m = d.data;
  const best = m && !m.paid ? bestFile(m.files, canSlice) : undefined;

  // Link ist nur kurz gültig: erst beim Klick holen
  const fileAction = async (f: PrintablesFile, how: "orca" | "laden") => {
    setBusy(`${how}:${f.id}`);
    try {
      const { link } = await api.printablesLink(id, f);
      location.href = how === "orca" ? `orcaslicer://open?file=${encodeURIComponent(link)}` : link;
      if (how === "orca") toast("An Orca übergeben");
    } catch (e) {
      toast((e as Error).message, "fehler");
    } finally {
      setBusy(null);
    }
  };

  const take = async (p: PrintablesModel) => {
    setBusy("import");
    setStatus("Verbinde …");
    ac.current = new AbortController();
    try {
      const r = await api.importModel(p.url, setStatus, ac.current.signal);
      await Promise.all(["models", "tags", "printables", "printables-model"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(r.existed ? "Schon in der Bibliothek" : `Modell mit ${r.files === 1 ? "1 Datei" : `${r.files} Dateien`} übernommen`);
      if (r.note && !r.existed) toast(r.note, "fehler");
      go({ page: "model", id: r.id });
    } catch (e) {
      if (!ac.current?.signal.aborted) toast((e as Error).message, "fehler");
    } finally {
      setBusy(null);
      setStatus("");
    }
  };

  // Drucken: Modell (falls nötig) übernehmen, Datei in der Bibliothek suchen, dann slicen bzw. direkt drucken
  const printIt = async (p: PrintablesModel, f: PrintablesFile) => {
    setBusy(`print:${f.id}`);
    setStatus("Verbinde …");
    ac.current = new AbortController();
    try {
      let modelId = p.model_id;
      if (!modelId) {
        const r = await api.importModel(p.url, setStatus, ac.current.signal);
        modelId = r.id;
        await Promise.all(["models", "tags", "printables", "printables-model"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      }
      setStatus("Suche die Datei …");
      const { files } = await api.model(modelId);
      const stem = f.name.replace(/\.(zip|gcode\.3mf|3mf|stl|obj|step|stp)$/i, "").toLowerCase();
      const ok = (x: ModelFile) => x.kind === "gcode3mf" || (canSlice && ["3mf", "stl", "obj", "step"].includes(x.kind));
      const hit = files.find((x) => x.name === f.name && ok(x)) ?? files.find((x) => x.name.toLowerCase().startsWith(stem) && ok(x)) ?? files.find(ok);
      if (!hit) {
        toast("Die Datei ist nicht in der Bibliothek angekommen.", "fehler");
        go({ page: "model", id: modelId });
      } else if (hit.kind === "gcode3mf") setPrint(hit);
      else setSlice(hit);
    } catch (e) {
      if (!ac.current?.signal.aborted) toast((e as Error).message, "fehler");
    } finally {
      setBusy(null);
      setStatus("");
    }
  };

  if (slice) return <SliceAndPrint file={slice} onClose={() => setSlice(null)} />;
  if (print) return <PrintDialog file={print} onClose={() => setPrint(null)} />;

  return (
    <Dialog title={m?.name ?? "Printables"} onClose={onClose} wide>
      {d.isError ? (
        <LoadError error={d.error} retry={() => d.refetch()} />
      ) : !m ? (
        <div className="space-y-3">
          <div className="skeleton aspect-[4/3] rounded-xl" />
          <div className="skeleton h-5 w-1/2 rounded" />
        </div>
      ) : (
        <div className="space-y-4">
          {m.images.length > 0 && (
            <div>
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-fill sm:aspect-[16/10]">
                <img src={(m.images[img] ?? m.images[0])!.large} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full object-contain" />
              </div>
              {m.images.length > 1 && (
                <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                  {m.images.map((src, i) => (
                    <button
                      key={src.small}
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
          )}

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
            {m.paid && <span className="font-semibold text-bad">Kostenpflichtig</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            {best && (
              <Button kind="primary" busy={busy === `print:${best.id}`} disabled={!!busy} onClick={() => void printIt(m, best)} title={`${best.name} ${sliced(best) ? "drucken" : "slicen und drucken"}`}>
                <Printer size={16} /> Drucken
              </Button>
            )}
            {m.model_id ? (
              <Button kind={best ? "secondary" : "primary"} onClick={() => go({ page: "model", id: m.model_id! })}>
                <LibraryIcon size={16} /> In der Bibliothek öffnen
              </Button>
            ) : (
              <Button kind={best ? "secondary" : "primary"} busy={busy === "import"} disabled={!!busy || m.paid} onClick={() => void take(m)}>
                <LibraryIcon size={16} /> In Bibliothek
              </Button>
            )}
            <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-ink2 hover:bg-hover">
              <ExternalLink size={15} /> Auf Printables
            </a>
          </div>
          {status && <div className="text-sm text-ink2">{status}</div>}

          <section>
            <h3 className="mb-1.5 text-xs font-bold tracking-[0.08em] text-ink3 uppercase">Dateien</h3>
            {m.files.length ? (
              <ul className="divide-y divide-sep overflow-hidden rounded-xl bg-card shadow-card">
                {m.files.map((f) => (
                  <li key={`${f.type}:${f.id}`} className="flex items-center gap-2 px-3 py-2">
                    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-fill">
                      {f.preview ? (
                        <img src={f.preview} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain" />
                      ) : (
                        <Box size={18} strokeWidth={1.6} className="text-ink3" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{f.name}</div>
                      <div className="text-xs text-ink3">{[f.type === "gcode" ? "G-Code" : f.name.split(".").pop()?.toUpperCase(), size(f.size)].filter(Boolean).join(" · ")}</div>
                    </div>
                    {(sliced(f) || (canSlice && toSlice(f))) && (
                      <Button
                        kind="primary"
                        className="h-8 px-2.5"
                        disabled={!!busy || m.paid}
                        onClick={() => void printIt(m, f)}
                        title={sliced(f) ? "Drucken" : "Slicen und drucken"}
                        aria-label={`${f.name} drucken`}
                      >
                        {busy === `print:${f.id}` ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                        <span className="hidden sm:inline">Drucken</span>
                      </Button>
                    )}
                    {slicable(f) && (
                      <Button
                        className="h-8 px-2.5 max-sm:hidden"
                        disabled={!!busy || m.paid}
                        onClick={() => void fileAction(f, "orca")}
                        title="Datei direkt in OrcaSlicer öffnen"
                      >
                        {busy === `orca:${f.id}` ? <Loader2 size={14} className="animate-spin" /> : <Layers size={14} />} Orca
                      </Button>
                    )}
                    <Button
                      className="h-8 px-2.5"
                      disabled={!!busy || m.paid}
                      onClick={() => void fileAction(f, "laden")}
                      title="Herunterladen, z. B. für Bambu Studio"
                      aria-label={`${f.name} herunterladen`}
                    >
                      {busy === `laden:${f.id}` ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      <span className="hidden sm:inline">Laden</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink3">Keine Dateien.</p>
            )}
            <p className="mt-1.5 text-xs text-ink3">
              {canSlice
                ? "„Drucken“ übernimmt das Modell in die Bibliothek, slict die Datei mit den Bambu-Profilen deines Druckers und startet den Druck. Für Feinarbeit: in Orca öffnen oder laden."
                : "Bambu Studio nimmt Links nur von MakerWorld an: Datei laden und im Finder doppelklicken. Farben und AMS wählst du wie gewohnt im Slicer."}
            </p>
          </section>

          {(m.summary || m.description) && (
            <section>
              <h3 className="mb-1.5 text-xs font-bold tracking-[0.08em] text-ink3 uppercase">Beschreibung</h3>
              <div className="max-h-72 overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-ink2">{[m.summary, m.description].filter(Boolean).join("\n\n")}</div>
            </section>
          )}
          {m.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {m.tags.slice(0, 16).map((t) => (
                <span key={t} className="rounded-full bg-fill px-2.5 py-1 text-xs font-semibold text-ink2">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
