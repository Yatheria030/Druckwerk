// Sammlungen (Projekte): Kacheln für die Bibliothek, Anlegen/Ändern, Modelle auswählen, Zuordnung auf der Modellseite
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Check, FolderOpen, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { Collection } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { go, href } from "../lib/router.ts";
import { Button, Dialog, Field, useToast } from "./controls.tsx";

export const useCollections = () => useQuery({ queryKey: ["collections"], queryFn: api.collections, staleTime: 30_000 });

const refresh = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all([qc.invalidateQueries({ queryKey: ["collections"] }), qc.invalidateQueries({ queryKey: ["models"] }), qc.invalidateQueries({ queryKey: ["model"] })]);

/** Kachel mit bis zu vier Vorschaubildern */
export function CollectionTile({ c }: { c: Collection }) {
  return (
    <a href={href({ page: "library", collection: c.id })} className="group w-40 shrink-0 overflow-hidden rounded-2xl bg-card shadow-card transition-shadow hover:shadow-pop sm:w-44">
      <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-px bg-sep">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="relative bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
            {c.covers[i] ? (
              <img src={c.covers[i]} alt="" loading="lazy" className="absolute inset-0 size-full object-contain p-1.5" />
            ) : i === 0 && !c.covers.length ? (
              <FolderOpen className="absolute inset-0 m-auto text-ink4" size={22} strokeWidth={1.6} />
            ) : null}
          </div>
        ))}
      </div>
      <div className="px-3 pt-2 pb-2.5">
        <div className="truncate text-sm font-bold">{c.name}</div>
        <div className="text-xs text-ink3">{c.count === 1 ? "1 Modell" : `${c.count} Modelle`}</div>
      </div>
    </a>
  );
}

/** Sammlung anlegen (optional gleich mit Modellen) oder ändern/löschen */
export function CollectionDialog({ c, models, onClose, onCreated }: { c?: Collection; models?: number[]; onClose: () => void; onCreated?: (id: number) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ name: c?.name ?? "", description: c?.description ?? "" });
  const save = useMutation({
    mutationFn: async () => (c ? (await api.updateCollection(c.id, v), c.id) : (await api.addCollection({ ...v, models })).id),
    onSuccess: async (id) => {
      await refresh(qc);
      toast(c ? "Sammlung gesichert" : "Sammlung angelegt");
      onClose();
      if (!c) onCreated?.(id);
    },
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const del = useMutation({
    mutationFn: () => api.deleteCollection(c!.id),
    onSuccess: async () => (await refresh(qc), onClose(), go({ page: "library" })),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  return (
    <Dialog title={c ? "Sammlung ändern" : "Neue Sammlung"} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
          <input className="field" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required autoFocus placeholder="Werkstatt-Halterungen" />
        </Field>
        <Field label="Beschreibung">
          <textarea className="field min-h-20 resize-y" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Wofür, welches Filament, offene Teile …" />
        </Field>
        <div className="flex items-center justify-between gap-2">
          {c ? (
            <Button type="button" kind="danger" busy={del.isPending} onClick={() => confirm(`Sammlung „${c.name}“ löschen? Die Modelle bleiben in der Bibliothek.`) && del.mutate()}>
              Löschen
            </Button>
          ) : (
            <span />
          )}
          <Button kind="primary" busy={save.isPending} disabled={!v.name.trim()}>
            {c ? "Sichern" : "Anlegen"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Modelle für eine Sammlung an- und abwählen */
export function ModelPicker({ c, onClose }: { c: Collection; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [sel, setSel] = useState<Set<number> | null>(null);
  const [q, setQ] = useState("");
  const start = useMemo(() => new Set((models.data ?? []).filter((m) => m.collections.includes(c.id)).map((m) => m.id)), [models.data, c.id]);
  const cur = sel ?? start;
  const shown = (models.data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()) || m.tags.some((t) => t.toLowerCase().includes(q.toLowerCase())));
  const save = useMutation({
    mutationFn: async () => {
      for (const m of models.data ?? []) {
        const want = cur.has(m.id);
        if (want === start.has(m.id)) continue;
        await api.setModelCollections(m.id, want ? [...m.collections, c.id] : m.collections.filter((x) => x !== c.id));
      }
    },
    onSuccess: async () => (await refresh(qc), onClose()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const toggle = (id: number) => setSel(new Set(cur.has(id) ? [...cur].filter((x) => x !== id) : [...cur, id]));
  return (
    <Dialog title={`Modelle in „${c.name}“`} onClose={onClose}>
      <label className="flex h-9 items-center gap-2 rounded-lg bg-fill px-2.5">
        <Search size={15} className="shrink-0 text-ink3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Modell suchen …" className="field text-sm" />
      </label>
      <div className="mt-2 max-h-[50dvh] divide-y divide-sep overflow-y-auto">
        {shown.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-3 py-2">
            <input type="checkbox" checked={cur.has(m.id)} onChange={() => toggle(m.id)} className="size-4 shrink-0 accent-[var(--c-accent)]" />
            <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))]">
              {m.cover ? <img src={m.cover} alt="" loading="lazy" className="absolute inset-0 size-full object-contain p-0.5" /> : <Box className="absolute inset-0 m-auto text-ink4" size={18} />}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.name}</span>
          </label>
        ))}
        {!shown.length && <div className="py-6 text-center text-sm text-ink3">Kein Modell gefunden.</div>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-[13px] text-ink3 tnum">{cur.size} ausgewählt</span>
        <Button kind="primary" busy={save.isPending} onClick={() => save.mutate()}>
          Sichern
        </Button>
      </div>
    </Dialog>
  );
}

/** Modellseite: Sammlungen des Modells als Chips, Plus öffnet die Auswahl */
export function ModelCollections({ modelId, ids }: { modelId: number; ids: number[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const all = useCollections();
  const [open, setOpen] = useState(false);
  const [create, setCreate] = useState(false);
  const set = useMutation({
    mutationFn: (next: number[]) => api.setModelCollections(modelId, next),
    onSuccess: () => refresh(qc),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const mine = (all.data ?? []).filter((c) => ids.includes(c.id));
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {mine.map((c) => (
          <a key={c.id} href={href({ page: "library", collection: c.id })} className="flex h-7 items-center gap-1 rounded-full bg-fill px-2.5 text-xs font-semibold text-ink2 hover:text-ink">
            <FolderOpen size={13} /> {c.name}
          </a>
        ))}
        <button onClick={() => setOpen(true)} className="flex h-7 items-center gap-1 rounded-full px-2 text-xs font-semibold text-accent hover:bg-hover">
          <Plus size={13} /> {mine.length ? "Ändern" : "Zu Sammlung"}
        </button>
      </div>
      {open && (
        <Dialog title="Sammlungen" onClose={() => setOpen(false)}>
          <div className="divide-y divide-sep">
            {(all.data ?? []).map((c) => {
              const on = ids.includes(c.id);
              return (
                <button
                  key={c.id}
                  disabled={set.isPending}
                  onClick={() => set.mutate(on ? ids.filter((x) => x !== c.id) : [...ids, c.id])}
                  className="flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <span className={`grid size-5 shrink-0 place-items-center rounded-md ${on ? "bg-accent text-on-accent" : "shadow-[inset_0_0_0_1.5px_var(--c-line)]"}`}>
                    {on && <Check size={13} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                  <span className="text-xs text-ink3 tnum">{c.count}</span>
                </button>
              );
            })}
            {!all.data?.length && <div className="py-4 text-sm text-ink3">Noch keine Sammlung.</div>}
          </div>
          <div className="mt-4 flex justify-between gap-2">
            <Button onClick={() => (setOpen(false), setCreate(true))}>
              <Plus size={15} /> Neue Sammlung
            </Button>
            <Button kind="primary" onClick={() => setOpen(false)}>
              Fertig
            </Button>
          </div>
        </Dialog>
      )}
      {create && <CollectionDialog models={[modelId]} onClose={() => setCreate(false)} />}
    </>
  );
}
