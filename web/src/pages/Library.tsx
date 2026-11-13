import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Heart, Plus, Printer, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ModelListItem } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { go, href } from "../lib/router.ts";
import { ACCEPT, importFiles } from "../lib/upload.ts";
import { Button, LoadError } from "../ui/controls.tsx";
import { DropZone } from "../ui/Uploads.tsx";

type Sort = "neu" | "name" | "gedruckt";
const load = <T,>(k: string, d: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? "null") as T) ?? d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export function Library() {
  const qc = useQueryClient();
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(() => load("stl.tag", null));
  const [only, setOnly] = useState<"" | "fav" | "druckbar">(() => load("stl.only", ""));
  const [sort, setSort] = useState<Sort>(() => load("stl.sort", "neu"));
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const out = (models.data ?? []).filter(
      (m) =>
        (!tag || m.tags.includes(tag)) &&
        (only !== "fav" || m.favorite) &&
        (only !== "druckbar" || m.printable) &&
        words.every((w) => m.name.toLowerCase().includes(w) || m.tags.some((t) => t.toLowerCase().includes(w))),
    );
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name, "de"));
    if (sort === "gedruckt") out.sort((a, b) => (b.last_print ?? "").localeCompare(a.last_print ?? "") || b.print_count - a.print_count);
    return out;
  }, [models.data, q, tag, only, sort]);

  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    void importFiles(qc, [...files]).then((ids) => ids.length === 1 && go({ page: "model", id: ids[0]! }));
  };

  const chip = (active: boolean) =>
    `h-8 shrink-0 rounded-full px-3 text-[13px] font-semibold whitespace-nowrap ${active ? "bg-ink text-bg" : "bg-card text-ink2 shadow-seg hover:text-ink"}`;

  return (
    <DropZone label="Als neues Modell ablegen" onDone={(ids) => ids.length === 1 && go({ page: "model", id: ids[0]! })}>
      <PageHeader title="Bibliothek">
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
        <Button kind="primary" onClick={() => input.current?.click()}>
          <Plus size={16} strokeWidth={2.6} /> Modell hinzufügen
        </Button>
      </PageHeader>

      <div className="mx-auto max-w-6xl 2xl:max-w-[88rem] px-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex h-10 flex-1 items-center gap-2 rounded-xl bg-card px-3 shadow-seg focus-within:shadow-[0_0_0_2px_var(--c-accent)]">
            <Search size={16} className="text-ink3" />
            <input className="field text-[15px]" placeholder="Name oder Tag suchen" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button onClick={() => setQ("")} className="text-ink3 hover:text-ink" aria-label="Suche leeren">
                <X size={16} />
              </button>
            )}
          </label>
          <select
            className="h-10 rounded-xl bg-card px-3 text-sm font-semibold shadow-seg"
            value={sort}
            onChange={(e) => (setSort(e.target.value as Sort), save("stl.sort", e.target.value))}
            aria-label="Sortierung"
          >
            <option value="neu">Zuletzt geändert</option>
            <option value="name">Name</option>
            <option value="gedruckt">Zuletzt gedruckt</option>
          </select>
        </div>

        <div className="no-scrollbar -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 pt-0.5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <button className={chip(!tag && !only)} onClick={() => (setTag(null), setOnly(""), save("stl.tag", null), save("stl.only", ""))}>
            Alle {models.data ? <span className="ml-1 opacity-60">{models.data.length}</span> : null}
          </button>
          <button className={chip(only === "fav")} onClick={() => (setOnly(only === "fav" ? "" : "fav"), save("stl.only", only === "fav" ? "" : "fav"))}>
            <Heart size={13} className="mr-1 -mt-0.5 inline" /> Favoriten
          </button>
          <button className={chip(only === "druckbar")} onClick={() => (setOnly(only === "druckbar" ? "" : "druckbar"), save("stl.only", only === "druckbar" ? "" : "druckbar"))}>
            <Printer size={13} className="mr-1 -mt-0.5 inline" /> Druckbereit
          </button>
          {tags.data?.map((t) => (
            <button key={t.tag} className={chip(tag === t.tag)} onClick={() => (setTag(tag === t.tag ? null : t.tag), save("stl.tag", tag === t.tag ? null : t.tag))}>
              #{t.tag} <span className="ml-1 opacity-60">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="mt-5">
          {models.isError ? (
            <LoadError error={models.error} retry={() => models.refetch()} />
          ) : models.isPending ? (
            <Grid>
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="skeleton aspect-[4/5] rounded-2xl" />
              ))}
            </Grid>
          ) : !models.data.length ? (
            <Empty onAdd={() => input.current?.click()} />
          ) : !list.length ? (
            <div className="py-16 text-center text-ink3">Nichts gefunden.</div>
          ) : (
            <Grid>
              {list.map((m) => (
                <ModelCard key={m.id} m={m} />
              ))}
            </Grid>
          )}
        </div>
      </div>
    </DropZone>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">{children}</div>
);

function ModelCard({ m }: { m: ModelListItem }) {
  return (
    <a href={href({ page: "model", id: m.id })} className="group overflow-hidden rounded-2xl bg-card shadow-card transition-shadow hover:shadow-pop">
      <div className="relative aspect-square bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
        {m.cover ? (
          <img src={m.cover} alt="" loading="lazy" className="absolute inset-0 size-full object-contain p-3 transition-transform group-hover:scale-[1.03]" />
        ) : (
          <Box className="absolute inset-0 m-auto text-ink4" size={42} strokeWidth={1.4} />
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          {m.favorite && (
            <span className="grid size-7 place-items-center rounded-full bg-card/90 text-accent shadow-card">
              <Heart size={14} fill="currentColor" />
            </span>
          )}
          {m.printable && (
            <span className="grid size-7 place-items-center rounded-full bg-card/90 text-ink2 shadow-card" title="Geslict, druckbereit">
              <Printer size={14} />
            </span>
          )}
        </div>
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <div className="line-clamp-2 text-sm leading-snug font-bold">{m.name}</div>
        <div className="mt-1 truncate text-xs text-ink3">
          {m.file_count} {m.file_count === 1 ? "Datei" : "Dateien"}
          {m.print_count ? ` · ${m.print_count}× gedruckt` : ""}
        </div>
      </div>
    </a>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-3xl border-2 border-dashed border-line px-6 py-16 text-center">
      <Box size={40} strokeWidth={1.5} className="mx-auto text-ink3" />
      <div className="mt-3 text-lg font-bold">Noch keine Modelle</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink2">
        Dateien hierher ziehen oder auswählen: STL, 3MF, OBJ, STEP, Bilder oder ein ZIP von Printables, Thingiverse oder MakerWorld.
      </p>
      <Button kind="primary" className="mt-5" onClick={onAdd}>
        <Plus size={16} strokeWidth={2.6} /> Modell hinzufügen
      </Button>
    </div>
  );
}
