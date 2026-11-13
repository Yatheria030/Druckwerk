import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import type { ModelFile } from "../../../shared/types.ts";
import { api, uploadFile } from "../api.ts";
import { requestThumb, VIEWABLE } from "./three.ts";

export type UploadItem = { key: string; name: string; progress: number; state: "laeuft" | "fertig" | "fehler"; error?: string };

let items: UploadItem[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (key: string, patch: Partial<UploadItem>) => {
  items = items.map((i) => (i.key === key ? { ...i, ...patch } : i));
  emit();
};

export const useUploads = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => items,
  );
export const clearUploads = () => {
  items = items.filter((i) => i.state === "laeuft");
  emit();
};

export const ACCEPT = ".stl,.3mf,.obj,.step,.stp,.zip,.png,.jpg,.jpeg,.webp,.scad,.f3d,.pdf";

const base = (n: string) => n.replace(/\.gcode\.3mf$/i, "").replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();

/** Fehlende Vorschaubilder im Browser rendern */
export async function ensureThumbs(files: ModelFile[]) {
  let made = false;
  for (const f of files) if (!f.has_thumb && VIEWABLE.includes(f.kind)) made = (await requestThumb(f.id, f.kind)) || made;
  return made;
}

/**
 * Dateien hochladen. Ohne Modell: jedes ZIP wird ein eigenes Modell, alle übrigen Dateien zusammen eins
 * (Name aus der ersten 3D-Datei). Rückgabe: IDs der Modelle.
 */
export async function importFiles(qc: QueryClient, files: File[], modelId?: number): Promise<number[]> {
  const groups: { name: string; files: File[]; model?: number }[] = [];
  if (modelId) groups.push({ name: "", files, model: modelId });
  else {
    const zips = files.filter((f) => /\.zip$/i.test(f.name));
    const rest = files.filter((f) => !/\.zip$/i.test(f.name));
    for (const z of zips) groups.push({ name: base(z.name), files: [z] });
    if (rest.length) groups.push({ name: base((rest.find((f) => !/\.(png|jpe?g|webp)$/i.test(f.name)) ?? rest[0]!).name), files: rest });
  }
  const ids: number[] = [];
  for (const g of groups) {
    const keys = g.files.map((f) => {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      items = [...items, { key, name: f.name, progress: 0, state: "laeuft" }];
      return key;
    });
    emit();
    let id = g.model;
    try {
      id ??= (await api.createModel({ name: g.name || "Neues Modell" })).id;
    } catch (e) {
      keys.forEach((k) => set(k, { state: "fehler", error: (e as Error).message }));
      continue;
    }
    ids.push(id);
    let ok = 0;
    for (const [i, f] of g.files.entries()) {
      try {
        await uploadFile(id, f, (p) => set(keys[i]!, { progress: p }));
        set(keys[i]!, { progress: 1, state: "fertig" });
        ok++;
      } catch (e) {
        set(keys[i]!, { state: "fehler", error: (e as Error).message });
      }
    }
    // Neues Modell ohne eine einzige Datei wieder entfernen
    if (!ok && !g.model) {
      await api.deleteModel(id).catch(() => {});
      ids.pop();
      continue;
    }
    void qc.invalidateQueries({ queryKey: ["models"] });
    void qc.invalidateQueries({ queryKey: ["model", id] });
    const d = await api.model(id).catch(() => null);
    if (d && (await ensureThumbs(d.files))) {
      void qc.invalidateQueries({ queryKey: ["models"] });
      void qc.invalidateQueries({ queryKey: ["model", id] });
    }
  }
  setTimeout(() => {
    if (items.every((i) => i.state === "fertig")) clearUploads();
  }, 4000);
  return ids;
}
