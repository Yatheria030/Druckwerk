import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Box, Download, ExternalLink, FileBox, Heart, Image as ImageIcon, Pencil, Plus, Printer, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtDuration, fmtSize, type FileKind, type Model, type ModelFile } from "../../../shared/types.ts";
import { api, fileUrl } from "../api.ts";
import { PageHeader } from "../App.tsx";
import { go } from "../lib/router.ts";
import { VIEWABLE } from "../lib/three.ts";
import { ACCEPT, ensureThumbs, importFiles } from "../lib/upload.ts";
import { Button, Card, Dialog, Field, Label, LoadError, Swatch, useToast } from "../ui/controls.tsx";
import { PrintDialog } from "../ui/PrintDialog.tsx";
import { PrintRow } from "../ui/PrintRow.tsx";
import { DropZone } from "../ui/Uploads.tsx";
import { Viewer } from "../ui/Viewer.tsx";

const KIND_LABEL: Record<FileKind, string> = { stl: "STL", "3mf": "3MF", gcode3mf: "Geslict", obj: "OBJ", step: "STEP", image: "Bild", other: "Datei" };
const STUDIO: FileKind[] = ["stl", "3mf", "obj", "step"];

export function ModelPage({ id }: { id: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["model", id], queryFn: () => api.model(id) });
  const [sel, setSel] = useState<number | null>(null);
  const [plate, setPlate] = useState(1);
  const [edit, setEdit] = useState(false);
  const [printFile, setPrintFile] = useState<ModelFile | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["model", id] });
    void qc.invalidateQueries({ queryKey: ["models"] });
    void qc.invalidateQueries({ queryKey: ["tags"] });
  };
  const patch = useMutation({
    mutationFn: (b: Partial<Model>) => api.updateModel(id, b),
    onSuccess: refresh,
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const delFile = useMutation({
    mutationFn: (fid: number) => api.deleteFile(fid),
    onSuccess: refresh,
    onError: (e) => toast((e as Error).message, "fehler"),
  });

  // Fehlende Vorschaubilder nachholen
  useEffect(() => {
    if (q.data) void ensureThumbs(q.data.files).then((made) => made && refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data?.files.map((f) => `${f.id}${f.has_thumb}`).join()]);

  if (q.isError) return <div className="mx-auto max-w-6xl 2xl:max-w-[88rem] p-6"><LoadError error={q.error} retry={() => q.refetch()} /></div>;
  if (q.isPending) return <div className="mx-auto max-w-6xl 2xl:max-w-[88rem] p-6"><div className="skeleton h-96 rounded-2xl" /></div>;
  const { model: m, files, prints } = q.data;

  const shown = files.find((f) => f.id === sel) ?? files.find((f) => VIEWABLE.includes(f.kind)) ?? files.find((f) => f.kind === "gcode3mf") ?? files[0];
  const printable = files.filter((f) => f.kind === "gcode3mf");
  const lastGood = prints.find((p) => p.status === "fertig");

  const pick = (list: FileList | null) => list?.length && void importFiles(qc, [...list], id);

  return (
    <DropZone label={`Zu „${m.name}“ hinzufügen`} modelId={id}>
      <PageHeader
        title={m.name}
        back={
          <a href="#/bibliothek" className="mb-1 inline-flex items-center gap-1 text-sm font-semibold text-ink3 hover:text-ink">
            <ArrowLeft size={15} /> Bibliothek
          </a>
        }
      >
        <Button kind="ghost" onClick={() => patch.mutate({ favorite: !m.favorite })} aria-label={m.favorite ? "Kein Favorit mehr" : "Als Favorit"}>
          <Heart size={17} className={m.favorite ? "text-accent" : ""} fill={m.favorite ? "currentColor" : "none"} />
        </Button>
        <Button onClick={() => setEdit(true)}>
          <Pencil size={15} /> Bearbeiten
        </Button>
        {printable.length > 0 && (
          <Button kind="primary" onClick={() => setPrintFile(printable[0]!)}>
            <Printer size={16} /> Drucken
          </Button>
        )}
      </PageHeader>

      <div className="mx-auto grid max-w-6xl 2xl:max-w-[88rem] gap-5 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card className="overflow-hidden">
            <div className="relative aspect-[4/3] bg-[linear-gradient(160deg,var(--c-tile-a),var(--c-tile-b))] sm:aspect-[16/10]">
              {!shown ? (
                <Box className="absolute inset-0 m-auto text-ink4" size={56} strokeWidth={1.2} />
              ) : VIEWABLE.includes(shown.kind) ? (
                <Viewer id={shown.id} kind={shown.kind} />
              ) : shown.kind === "image" ? (
                <img src={fileUrl.raw(shown.id)} alt="" className="absolute inset-0 size-full object-contain" />
              ) : shown.kind === "gcode3mf" && shown.meta.images?.length ? (
                <img src={fileUrl.plate(shown.id, shown.meta.images.includes(plate) ? plate : shown.meta.images[0]!)} alt="" className="absolute inset-0 size-full object-contain p-4" />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-center text-sm text-ink3">
                  <div>
                    <FileBox size={44} strokeWidth={1.3} className="mx-auto mb-2 text-ink4" />
                    Keine Vorschau für {KIND_LABEL[shown.kind]}-Dateien
                  </div>
                </div>
              )}
            </div>
            {shown?.kind === "gcode3mf" && (shown.meta.plates?.length ?? 0) > 1 && (
              <div className="flex gap-1.5 overflow-x-auto border-t border-sep p-2">
                {shown.meta.plates!.map((p) => (
                  <button key={p.index} onClick={() => setPlate(p.index)} className={`h-8 shrink-0 rounded-lg px-3 text-sm font-semibold ${plate === p.index ? "bg-ink text-bg" : "hover:bg-hover"}`}>
                    Platte {p.index}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between px-4 pt-4 pb-1">
              <Label>Dateien</Label>
              <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
              <Button kind="ghost" className="-mr-2 h-8" onClick={() => input.current?.click()}>
                <Plus size={15} /> Hinzufügen
              </Button>
            </div>
            {!files.length && <div className="px-4 pb-5 text-sm text-ink3">Noch keine Dateien. Hierher ziehen oder hinzufügen.</div>}
            <div className="divide-y divide-sep">
              {files.map((f) => (
                <FileRow
                  key={f.id}
                  f={f}
                  active={f.id === shown?.id}
                  cover={m.cover_file_id === f.id}
                  onSelect={() => setSel(f.id)}
                  onPrint={() => setPrintFile(f)}
                  onCover={() => patch.mutate({ cover_file_id: f.id })}
                  onDelete={() => confirm(`„${f.name}“ löschen?`) && delFile.mutate(f.id)}
                />
              ))}
            </div>
            {files.some((f) => STUDIO.includes(f.kind)) && !printable.length && (
              <div className="m-3 rounded-xl bg-fill p-3 text-xs leading-relaxed text-ink2">
                Zum Drucken die Datei in Bambu Studio öffnen, slicen und über <b>Datei → Exportieren → Platte geslict exportieren</b> als
                <b> .gcode.3mf</b> speichern. Die Datei dann hier hinzufügen.
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="p-4">
            {m.description ? <p className="text-sm leading-relaxed whitespace-pre-line text-ink2">{m.description}</p> : <p className="text-sm text-ink3">Keine Beschreibung.</p>}
            {m.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {m.tags.map((t) => (
                  <span key={t} className="rounded-full bg-fill px-2.5 py-1 text-xs font-semibold text-ink2">
                    #{t}
                  </span>
                ))}
              </div>
            )}
            <dl className="mt-4 space-y-2 text-sm">
              {m.creator && <Row k="Von">{m.creator}</Row>}
              {m.license && <Row k="Lizenz">{m.license}</Row>}
              {m.source_url && (
                <Row k="Quelle">
                  <a href={m.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 font-semibold text-accent hover:underline">
                    <span className="truncate">{hostOf(m.source_url)}</span> <ExternalLink size={12} className="shrink-0" />
                  </a>
                </Row>
              )}
              <Row k="Gedruckt">{prints.length ? `${prints.length}×` : "noch nie"}</Row>
              {lastGood && <Row k="Zuletzt gut">{new Date(lastGood.started_at).toLocaleDateString("de-DE")}</Row>}
            </dl>
          </Card>

          <Card className="px-4 pt-4">
            <Label>Druckverlauf</Label>
            {!prints.length ? (
              <div className="py-4 text-sm text-ink3">Noch nicht gedruckt.</div>
            ) : (
              <div className="divide-y divide-sep">
                {prints.map((p) => (
                  <PrintRow key={p.id} p={p} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {edit && <EditDialog m={m} onClose={() => setEdit(false)} onSaved={refresh} />}
      {printFile && <PrintDialog file={printFile} onClose={() => setPrintFile(null)} />}
    </DropZone>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex gap-3">
    <dt className="w-24 shrink-0 text-ink3">{k}</dt>
    <dd className="min-w-0 flex-1 font-medium">{children}</dd>
  </div>
);

function FileRow(p: { f: ModelFile; active: boolean; cover: boolean; onSelect: () => void; onPrint: () => void; onCover: () => void; onDelete: () => void }) {
  const { f } = p;
  const icon = "grid size-8 place-items-center rounded-lg text-ink3 hover:bg-hover hover:text-ink";
  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${p.active ? "bg-selected" : ""}`}>
      <button onClick={p.onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-fill">
          {f.has_thumb ? <img src={fileUrl.thumb(f.id, f.created_at)} alt="" loading="lazy" className="size-full object-contain" /> : f.kind === "image" ? <ImageIcon size={18} className="text-ink4" /> : <FileBox size={18} className="text-ink4" />}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{f.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink3">
            <span className={`rounded px-1 font-bold ${f.kind === "gcode3mf" ? "bg-accent-soft text-accent" : "bg-fill text-ink2"}`}>{KIND_LABEL[f.kind]}</span>
            <span className="tnum">{fmtSize(f.size)}</span>
            {f.meta.plates?.map((pl) => (
              <span key={pl.index} className="inline-flex items-center gap-1 tnum">
                {f.meta.plates!.length > 1 ? `P${pl.index}: ` : ""}
                {fmtDuration(pl.prediction_s)}
                {pl.weight_g != null ? ` · ${pl.weight_g.toFixed(0)} g` : ""}
                {pl.filaments.map((x) => (
                  <Swatch key={x.id} color={x.color} size={9} />
                ))}
              </span>
            ))}
            {p.cover && <span className="inline-flex items-center gap-0.5 text-star"><Star size={10} fill="currentColor" /> Titelbild</span>}
          </div>
        </div>
      </button>
      <div className="flex shrink-0 items-center">
        {f.kind === "gcode3mf" && (
          <button className={`${icon} text-accent`} onClick={p.onPrint} title="Drucken" aria-label="Drucken">
            <Printer size={16} />
          </button>
        )}
        {STUDIO.includes(f.kind) && (
          <a className={`${icon} hidden sm:grid`} href={fileUrl.studio(f.id, f.name)} title="In Bambu Studio öffnen" aria-label="In Bambu Studio öffnen">
            <ExternalLink size={16} />
          </a>
        )}
        <a className={icon} href={fileUrl.download(f.id, f.name)} title="Herunterladen" aria-label="Herunterladen">
          <Download size={16} />
        </a>
        {f.has_thumb && !p.cover && (
          <button className={`${icon} hidden sm:grid`} onClick={p.onCover} title="Als Titelbild" aria-label="Als Titelbild">
            <Star size={16} />
          </button>
        )}
        <button className={`${icon} hover:text-bad`} onClick={p.onDelete} title="Löschen" aria-label="Löschen">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function EditDialog({ m, onClose, onSaved }: { m: Model; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: m.name, description: m.description, tags: m.tags.join(", "), source_url: m.source_url, creator: m.creator, license: m.license });
  const tags = useQuery({ queryKey: ["tags"], queryFn: api.tags });
  const save = useMutation({
    mutationFn: () =>
      api.updateModel(m.id, {
        ...v,
        tags: [...new Set(v.tags.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean))],
      }),
    onSuccess: () => (onSaved(), onClose()),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const del = useMutation({
    mutationFn: () => api.deleteModel(m.id),
    onSuccess: () => (onSaved(), go({ page: "library" })),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog title="Modell bearbeiten" onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
          <input className="field" value={v.name} onChange={set("name")} required />
        </Field>
        <Field label="Beschreibung">
          <textarea className="field min-h-24 resize-y" value={v.description} onChange={set("description")} placeholder="Wofür, Druckhinweise, Material …" />
        </Field>
        <Field label="Tags" hint={tags.data?.length ? `Vorhanden: ${tags.data.slice(0, 12).map((t) => t.tag).join(", ")}` : "Mit Komma trennen"}>
          <input className="field" value={v.tags} onChange={set("tags")} placeholder="küche, halter, ersatzteil" />
        </Field>
        <Field label="Quelle (Link)">
          <input className="field" type="url" value={v.source_url} onChange={set("source_url")} placeholder="https://www.printables.com/model/…" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ersteller">
            <input className="field" value={v.creator} onChange={set("creator")} />
          </Field>
          <Field label="Lizenz">
            <input className="field" value={v.license} onChange={set("license")} placeholder="CC BY-NC-SA 4.0" />
          </Field>
        </div>
        <div className="flex justify-between gap-2 pt-2">
          <Button type="button" kind="danger" busy={del.isPending} onClick={() => confirm(`„${m.name}“ mit allen Dateien löschen? Der Druckverlauf bleibt.`) && del.mutate()}>
            <Trash2 size={15} /> Löschen
          </Button>
          <Button kind="primary" busy={save.isPending}>
            Sichern
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
