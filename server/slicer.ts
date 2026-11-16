// Slicen im Server mit der Kommandozeile von Bambu Studio (auf ARM OrcaSlicer, gleiche Schnittstelle): STL, OBJ, STEP und 3MF werden mit den offiziellen Profilen
// des Druckers (Maschine, Prozess, Filament je Fach) zu einer druckbaren .gcode.3mf. Die Profile liegen der Installation bei
// (profiles/BBL) und erben voneinander („inherits“); die CLI löst das nicht vollständig auf, daher werden sie hier zu
// vollständigen JSON-Dateien zusammengeführt. Im Container: Build-Argument SLICER=1, sonst Pfad über SLICER_BIN.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzip, zip, zipSync } from "fflate";
import { baseMaterial, PRINTER_MODELS, type FileMeta, type Plate, type Tray } from "../shared/types.ts";
import { profileById } from "../shared/profiles.ts";
import { db, FILE_DIR } from "./db.ts";
import { absPath, baseName, fileRow, importLocal, parseSliceInfo, plateBoxes, thumbPath } from "./files.ts";
import { stepToStl } from "./step.ts";

export class SliceError extends Error {
  constructor(
    msg: string,
    public status = 400,
  ) {
    super(msg);
  }
}

// Bambu Studio zuerst: Referenz für Bambu-Drucker, bringt mit jedem Release die aktuellen Profile mit. Orca nur, wo es Bambu Studio nicht gibt (Linux ARM)
const CANDIDATES = [
  "/opt/bambu-studio/AppRun",
  "/opt/bambu-studio/bin/bambu-studio",
  "/Applications/BambuStudio.app/Contents/MacOS/BambuStudio",
  "/opt/orca/AppRun",
  "/opt/orca/bin/orca-slicer",
  "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
];

/** Programm und Profilordner; null = kein Slicer installiert. Orca 2.5 bringt nur den Profil-Cache (.opc) mit, die JSON-Profile
 *  liegen im Image daneben (Dockerfile), auf dem Mac per SLICER_PROFILES */
function locate(): { bin: string; profiles: string } | null {
  const bin = process.env.SLICER_BIN || CANDIDATES.find((p) => existsSync(p));
  if (!bin || !existsSync(bin)) return null;
  const dir = path.dirname(bin);
  const profiles =
    process.env.SLICER_PROFILES ||
    [path.join(dir, "../Resources/profiles"), path.join(dir, "resources/profiles"), path.join(dir, "../resources/profiles")].find((p) => existsSync(path.join(p, "BBL/machine")));
  return profiles ? { bin, profiles: path.join(profiles, "BBL") } : null;
}
let where: ReturnType<typeof locate> | undefined;
const slicer = () => (where === undefined ? (where = locate()) : where);
export const slicerAvailable = () => !!slicer();
/** Name und Version für die Oberfläche („Bambu Studio 02.09.01.70“); Version aus der Profilsammlung BBL.json */
export function slicerName(): string | null {
  const s = slicer();
  if (!s) return null;
  const name = /orca/i.test(s.bin) ? "OrcaSlicer" : "Bambu Studio";
  try {
    const v = (JSON.parse(readFileSync(path.join(s.profiles, "../BBL.json"), "utf8")) as { version?: string }).version;
    return v ? `${name} (Profile ${v})` : name;
  } catch {
    return name;
  }
}

// ---------- Profile ----------

type Preset = Record<string, unknown> & { name: string; type?: string; inherits?: string; instantiation?: string };
type Kind = "machine" | "process" | "filament";
let index: (Record<Kind, Map<string, Preset>> & { models: Map<string, Preset> }) | null = null;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".json") ? [path.join(dir, e.name)] : []));
}

function presets() {
  if (index) return index;
  const s = slicer();
  if (!s) throw new SliceError("Kein Slicer installiert.", 503);
  index = { machine: new Map(), process: new Map(), filament: new Map(), models: new Map() };
  for (const kind of ["machine", "process", "filament"] as const) {
    for (const f of walk(path.join(s.profiles, kind))) {
      try {
        const p = JSON.parse(readFileSync(f, "utf8")) as Preset;
        if (p.name) (p.type === "machine_model" ? index.models : index[kind]).set(p.name, p);
      } catch {
        /* kaputte Datei überspringen */
      }
    }
  }
  return index;
}

const flatCache = new Map<string, Preset>();
/** Profil mit allen geerbten Werten (Eltern zuerst, dann `include`-Vorlagen, Kind überschreibt). Neuere Bambu-Profile (P2S, H2)
 *  lagern Start-, End- und Wechselcode in Vorlagen aus; ohne sie bliebe der generische Startcode aus fdm_machine_common stehen */
function flat(kind: Kind, name: string): Preset {
  const key = `${kind}:${name}`;
  const hit = flatCache.get(key);
  if (hit) return hit;
  const p = presets()[kind].get(name);
  if (!p) throw new SliceError(`Profil fehlt: ${name}`, 500);
  const parent = p.inherits ? flat(kind, p.inherits) : {};
  const included = list(p.include).map((n) => {
    const { name: _n, instantiation: _i, ...rest } = flat(kind, n);
    return rest;
  });
  const out = { ...parent, ...Object.assign({}, ...included), ...p, inherits: "" } as Preset;
  delete out.include;
  flatCache.set(key, out);
  return out;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
const machineModel = (model: string) => `Bambu Lab ${PRINTER_MODELS.find((m) => m.id === model)?.label ?? model}`;

/** Maschinenprofil für Druckermodell und Düse, z. B. „Bambu Lab P2S 0.4 nozzle“ */
function machineFor(model: string, nozzle: string): Preset {
  const want = machineModel(model);
  const all = [...presets().machine.values()].filter((p) => p.instantiation === "true" && p.printer_model === want);
  const m = all.find((p) => p.printer_variant === nozzle) ?? all.find((p) => p.printer_variant === "0.4") ?? all[0];
  if (!m) throw new SliceError(`Für ${want} gibt es in diesem Slicer keine Profile.`, 422);
  return flat("machine", m.name);
}

const compatible = (p: Preset, machine: string) => list(p.compatible_printers).includes(machine);

/** Druckplatten laut Slicer; die Werte sind die Namen, die Bambu Studio in curr_bed_type erwartet */
const BEDS: [string, string][] = [
  ["Textured PEI Plate", "Strukturierte PEI-Platte"],
  ["High Temp Plate", "Glatte PEI-Platte"],
  ["Supertack Plate", "Cool Plate SuperTack"],
  ["Cool Plate", "Cool Plate"],
  ["Engineering Plate", "Engineering Plate"],
];
const modelInfo = (model: string) => presets().models.get(machineModel(model));
function bedsOf(model: string) {
  const info = modelInfo(model);
  const no = new Set(String(info?.not_support_bed_type ?? "").split(";"));
  const beds = BEDS.filter(([v]) => !no.has(v)).map(([value, label]) => ({ value, label }));
  const def = String(info?.default_bed_type ?? "");
  return { beds, bed: beds.some((b) => b.value === def) ? def : (beds[0]?.value ?? "Textured PEI Plate") };
}

/** Druckprofile (Schichthöhe/Qualität), Düsen und Platten für einen Drucker */
export function processes(model: string, nozzle = "0.4") {
  const m = machineFor(model, nozzle);
  const out = [...presets().process.values()]
    .filter((p) => p.instantiation === "true" && compatible(p, m.name))
    .map((p) => {
      const f = flat("process", p.name);
      return {
        name: p.name,
        layer: Number(f.layer_height) || null,
        infill: parseFloat(String(f.sparse_infill_density ?? "")) || null,
        pattern: String(f.sparse_infill_pattern ?? ""),
        walls: Number(f.wall_loops) || null,
      };
    })
    .sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || a.name.localeCompare(b.name));
  return {
    machine: m.name,
    nozzles: nozzlesOf(model),
    processes: out,
    default: String(m.default_print_profile ?? out[0]?.name ?? ""),
    ...bedsOf(model),
    bed_size: bedSize(m.printable_area), // [Breite, Tiefe] in mm für die Plattenzeichnung im Viewer
    bed_exclude: list(m.bed_exclude_area), // Sperrbereich (Schneide vorn links) als Punkte „XxY“
  };
}

function nozzlesOf(model: string) {
  const want = machineModel(model);
  return [...new Set([...presets().machine.values()].filter((p) => p.instantiation === "true" && p.printer_model === want).map((p) => String(p.printer_variant)))].sort();
}

/** Filamentprofil für ein Fach: erst die Profil-ID des Fachs (tray_info_idx), dann Generic nach Material, sonst Standard der Maschine.
 *  OrcaSlicer vergibt eigene IDs („OF…“), dort zählt der Name aus der Bambu-Tabelle („Bambu PLA Matte @BBL P2S“). */
function filamentFor(machine: Preset, tray: { profile: string; type: string } | null): Preset {
  const all = [...presets().filament.values()].filter((p) => p.instantiation === "true" && compatible(p, machine.name));
  const pname = profileById(tray?.profile)?.name;
  const byId = tray?.profile
    ? (all.find((p) => flat("filament", p.name).filament_id === tray.profile) ?? (pname ? all.find((p) => p.name.startsWith(`${pname} @`)) : undefined))
    : undefined;
  if (byId) return flat("filament", byId.name);
  const type = tray?.type ? baseMaterial(tray.type).toUpperCase() : "";
  const generic = type
    ? (all.find((p) => p.name.startsWith(`Generic ${type} @`)) ?? all.find((p) => p.name.startsWith("Generic ") && list(flat("filament", p.name).filament_type)[0]?.toUpperCase() === type))
    : undefined;
  if (generic) return flat("filament", generic.name);
  const def = list(machine.default_filament_profile)[0];
  if (def && presets().filament.has(def)) return flat("filament", def);
  if (all[0]) return flat("filament", all[0].name);
  throw new SliceError("Kein passendes Filamentprofil gefunden.", 422);
}

// ---------- Datei auslesen ----------

const unzipAsync = (buf: Uint8Array, want: (n: string) => boolean) =>
  new Promise<Record<string, Uint8Array>>((res, rej) => unzip(buf, { filter: (f) => want(f.name) }, (e, out) => (e ? rej(e) : res(out))));

/** Projekteinstellungen einer 3MF (Metadata/project_settings.config), sonst null */
async function projectSettings(row: { kind: string } & Parameters<typeof absPath>[0]): Promise<Record<string, unknown> | null> {
  if (row.kind !== "3mf") return null;
  try {
    const raw = (await unzipAsync(await readFile(absPath(row)), (n) => n === "Metadata/project_settings.config"))["Metadata/project_settings.config"];
    return raw ? (JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Filamente einer 3MF (Farbe, Material) aus den Projekteinstellungen; STL & Co. haben eins */
export async function sourceSlots(fileId: number): Promise<{ color: string; type: string }[]> {
  const row = fileRow(fileId);
  if (!row) throw new SliceError("Datei nicht gefunden.", 404);
  const cfg = await projectSettings(row);
  const colors = list(cfg?.filament_colour);
  const types = list(cfg?.filament_type);
  return colors.length ? colors.slice(0, 16).map((c, i) => ({ color: c.slice(0, 7), type: types[i] ?? "" })) : [{ color: "", type: "" }];
}

/**
 * Weg zu mehreren Exemplaren (Bambu Studio CLI): STL/OBJ/STEP per `--clone-objects`; eine 3MF aus Bambu Studio per `--repetitions`
 * (nur mit `--slice N`, die CLI legt Instanzen an und ordnet sie an); andere 3MF (Fusion, Printables) lehnt sie für beides ab, dort
 * hängen wir jedes Bauteil im `<build>` n-mal an, `--arrange 1` verteilt sie dann
 */
async function copyMode(kind: string, buf: Uint8Array, copies: number): Promise<{ args: string[]; buf?: Uint8Array }> {
  const n = String(copies);
  if (kind !== "3mf") return { args: ["--clone-objects", n] };
  const files = await unzipAsync(buf, () => true);
  const model = files["3D/3dmodel.model"];
  const text = model ? new TextDecoder().decode(model) : "";
  if (/<metadata name="Application">\s*BambuStudio/i.test(text.slice(0, 64 * 1024))) return { args: ["--repetitions", n] };
  const dup = text.replace(/(<build\b[^>]*>)([\s\S]*?)(<\/build>)/, (_, a: string, items: string, b: string) => {
    const one = items.match(/<item\b[^>]*\/>/g) ?? [];
    const more = one.map((i) => i.replace(/\s+p:UUID="[^"]*"/, ""));
    return a + items + Array.from({ length: Number(n) - 1 }, () => more.join("\n")).join("\n") + "\n" + b;
  });
  files["3D/3dmodel.model"] = new TextEncoder().encode(dup);
  return { args: [], buf: await new Promise<Uint8Array>((res, rej) => zip(files, { level: 0 }, (e, z) => (e ? rej(e) : res(z)))) };
}

/** Bettgröße (Breite, Tiefe) aus printable_area („0x0“, „256x0“, …) */
function bedSize(area: unknown): [number, number] | null {
  const pts = list(area).map((p) => p.split("x").map(Number));
  const w = Math.max(...pts.map((p) => p[0] ?? 0)), h = Math.max(...pts.map((p) => p[1] ?? 0));
  return w > 0 && h > 0 ? [w, h] : null;
}

/**
 * Projekt für ein anderes Bett (H2S 340×320, X1 256×256 …) auf den Zieldrucker umziehen. Bambu Studio legt Platten im Raster
 * ab (Spalten = ⌈√Platten⌉, Abstand Bett × 1,2, Zeilen nach −Y) und speichert die Teile mit diesem Versatz. Die CLI rechnet mit
 * dem Raster des Zieldruckers, Teile ab Platte 2 lägen dann neben dem Bett. Deshalb jede Platte mittig aufs Zielbett schieben
 * (Anordnung auf der Platte bleibt) und den Wischturm mitnehmen; passt er dann nicht, an den Rand klemmen.
 */
async function refitProject(
  buf: Uint8Array,
  cfg: Record<string, unknown> | null,
  machine: Preset,
): Promise<{ buf: Uint8Array | null; tower: { wipe_tower_x: string[]; wipe_tower_y: string[] } | null }> {
  const from = bedSize(cfg?.printable_area), to = bedSize(machine.printable_area);
  if (!from || !to) return { buf: null, tower: null };
  const [dx, dy] = [(to[0] - from[0]) / 2, (to[1] - from[1]) / 2];
  if (!dx && !dy) return { buf: null, tower: null }; // gleiches Bett: alles bleibt, wie der Autor es angelegt hat
  const num = (v: number) => String(Math.round(v * 1000) / 1000);

  let out: Uint8Array | null = null;
  {
    const files = await unzipAsync(buf, () => true);
    const td = new TextDecoder();
    const ms = files["Metadata/model_settings.config"] ? td.decode(files["Metadata/model_settings.config"]) : "";
    const plateOf = new Map<string, number>();
    let plates = 0;
    for (const m of ms.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
      const n = Number(/plater_id" value="(\d+)"/.exec(m[1]!)?.[1] ?? 0);
      plates = Math.max(plates, n);
      for (const o of m[1]!.matchAll(/object_id" value="(\d+)"/g)) plateOf.set(o[1]!, n);
    }
    const model = files["3D/3dmodel.model"];
    if (model && plates) {
      const cols = Math.ceil(Math.sqrt(plates));
      const origin = (bed: [number, number], n: number) => [((n - 1) % cols) * bed[0] * 1.2, -Math.floor((n - 1) / cols) * bed[1] * 1.2];
      const text = td.decode(model).replace(/<item\b[^>]*>/g, (item) => {
        const n = plateOf.get(/objectid="(\d+)"/.exec(item)?.[1] ?? "");
        const t = /transform="([^"]+)"/.exec(item);
        if (!n || !t) return item;
        const v = t[1]!.trim().split(/\s+/).map(Number);
        if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return item;
        const [ox, oy] = origin(from, n), [nx, ny] = origin(to, n);
        v[9] = v[9]! - ox! + nx! + dx;
        v[10] = v[10]! - oy! + ny! + dy;
        return item.replace(t[0], `transform="${v.map((x, i) => (i >= 9 ? num(x) : String(x))).join(" ")}"`);
      });
      files["3D/3dmodel.model"] = new TextEncoder().encode(text);
      out = await new Promise<Uint8Array>((res, rej) => zip(files, { level: 0 }, (e, z) => (e ? rej(e) : res(z))));
    }
  }

  // Wischturm: Ecke links vorn je Platte, Tiefe kennt erst der Slicer (daher großzügiger Rand oben)
  const xs = list(cfg?.wipe_tower_x), ys = list(cfg?.wipe_tower_y);
  if (!xs.length) return { buf: out, tower: null };
  const width = Number(list(cfg?.prime_tower_width)[0] ?? 35) || 35;
  const lo = 30; // Sperrbereich vorn links (Schneide, Ausstoß)
  const fit = (v: number, max: number) => num(Math.min(Math.max(Number.isFinite(v) ? v : lo, lo), Math.max(lo, max)));
  return {
    buf: out,
    tower: {
      wipe_tower_x: xs.map((x) => fit(Number(x) + dx, to[0] - width - 10)),
      wipe_tower_y: xs.map((_, i) => fit(Number(ys[i]) + dy, to[1] - Math.max(width, 60) - 10)),
    },
  };
}

// ---------- Slicen ----------

/** Füllmuster, die der Dialog anbietet (Werte wie in Bambu Studio) */
export const INFILL_PATTERNS = ["grid", "gyroid", "honeycomb", "cubic", "triangles", "lightning", "zig-zag"];

export const MAX_COPIES = 50;

export type SliceRequest = {
  file_id: number;
  model: string; // Druckermodell (PRINTER_MODELS.id)
  nozzle: string; // "0.4"
  process: string; // Name des Druckprofils
  /** je Filament der Datei das Fach (oder null = Standardfilament), bestimmt Profil und Farbe */
  trays: (Pick<Tray, "id" | "profile" | "type" | "color"> | null)[];
  support: "aus" | "normal" | "baum";
  brim: boolean;
  infill: number | null; // Prozent, null = wie im Profil
  pattern?: string | null; // sparse_infill_pattern (INFILL_PATTERNS), leer = wie im Profil
  walls?: number | null; // wall_loops, null = wie im Profil
  orient: boolean;
  bed: string; // curr_bed_type, z. B. „Textured PEI Plate“
  /** nur diese Platte einer Projekt-3MF slicen (1-basiert), fehlt = alle */
  plate?: number | null;
  /** Spülmenge beim Farbwechsel relativ zu Bambus Empfehlung (flush_multiplier), fehlt = 1 */
  flush?: number | null;
  /** Anzahl Exemplare (`--repetitions`, die CLI ordnet sie aufs Bett), nur ohne Platten-Layout; fehlt = 1 */
  copies?: number | null;
};

let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;

/** Slict eine Datei und legt die .gcode.3mf im selben Modell ab; einer nach dem anderen */
export async function slice(req: SliceRequest, status: (text: string) => void, signal?: AbortSignal): Promise<{ id: number; model_id: number }> {
  const same = inflight.get(previewKey(req));
  if (same) {
    status("Slicen …");
    await same.catch(() => {});
  } else if (inflight.size) previewAc?.abort(); // andere Vorschau ist überholt
  if (waiting) status("Wartet auf einen anderen Slice-Vorgang …");
  return slice0(() => doSlice(req, status, signal));
}

/** Ein Slicer-Lauf nach dem anderen (Speicher, CPU) */
function slice0<T>(fn: () => Promise<T>): Promise<T> {
  waiting++;
  const run = chain.then(() => {
    waiting--;
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

const layoutOf = (row: { meta: string }) => {
  try {
    return (JSON.parse(row.meta) as FileMeta).layout ?? [];
  } catch {
    return [];
  }
};

/** Alle Platten zusammen: Zeit und Gramm addiert, Filamente je ID zusammengefasst (Vorschau „Alle Platten“) */
function sumPlates(plates: Plate[]): Plate {
  const fil = new Map<number, Plate["filaments"][number]>();
  for (const f of plates.flatMap((p) => p.filaments)) {
    const o = fil.get(f.id);
    fil.set(f.id, o ? { ...o, used_g: (o.used_g ?? 0) + (f.used_g ?? 0), used_m: (o.used_m ?? 0) + (f.used_m ?? 0) } : { ...f });
  }
  const add = (k: "prediction_s" | "weight_g") => (plates.some((p) => p[k] != null) ? plates.reduce((s, p) => s + (p[k] ?? 0), 0) : null);
  return { ...plates[0]!, prediction_s: add("prediction_s"), weight_g: add("weight_g"), filaments: [...fil.values()].sort((a, b) => a.id - b.id), objects: plates.reduce((s, p) => s + (p.objects ?? 0), 0) };
}

/** Slict in einen eigenen Arbeitsordner; der Aufrufer räumt `dir` weg */
async function runSlice(req: SliceRequest, status: (text: string) => void, signal?: AbortSignal): Promise<{ dir: string; out: string; row: NonNullable<ReturnType<typeof fileRow>> }> {
  const s = slicer();
  if (!s) throw new SliceError("Kein Slicer installiert.", 503);
  const row = fileRow(req.file_id);
  if (!row) throw new SliceError("Datei nicht gefunden.", 404);
  if (!["stl", "3mf", "obj", "step"].includes(row.kind)) throw new SliceError("Diese Datei lässt sich nicht slicen.");
  signal?.throwIfAborted();

  const copies = layoutOf(row).length ? 1 : Math.min(MAX_COPIES, Math.max(1, Math.round(req.copies ?? 1)));
  status("Bereite Profile vor …");
  const machine = machineFor(req.model, req.nozzle);
  if (!presets().process.has(req.process) || !compatible(presets().process.get(req.process)!, machine.name))
    throw new SliceError("Das Druckprofil passt nicht zu diesem Drucker.");
  const proc: Preset = { ...flat("process", req.process) };
  if (req.support !== "aus") {
    proc.enable_support = "1";
    proc.support_type = req.support === "baum" ? "tree(auto)" : "normal(auto)";
  } else proc.enable_support = "0";
  proc.brim_type = req.brim ? "auto_brim" : "no_brim";
  if (req.infill != null) proc.sparse_infill_density = `${Math.round(req.infill)}%`;
  if (req.pattern && INFILL_PATTERNS.includes(req.pattern)) proc.sparse_infill_pattern = req.pattern;
  if (req.walls != null) proc.wall_loops = String(Math.round(req.walls));
  // Spülmenge beim Farbwechsel: Bambu Studio rechnet mit 1, die Orca-CLI ohne Angabe mit 0,3 (spült dann deutlich zu wenig)
  proc.flush_multiplier = String(Math.min(1.5, Math.max(0.3, req.flush ?? 1)));
  // Ohne Angabe nimmt die CLI „Cool Plate“, die der P2S gar nicht hat (falsche Betttemperatur)
  const { beds, bed } = bedsOf(req.model);
  proc.curr_bed_type = beds.some((b) => b.value === req.bed) ? req.bed : bed;

  const dir = path.join(FILE_DIR, `.slice-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(dir, { recursive: true });
  try {
    const files: string[] = [];
    const put = async (name: string, data: Preset) => {
      const p = path.join(dir, name);
      await writeFile(p, JSON.stringify(data, null, 1));
      files.push(p);
      return p;
    };
    const mPath = await put("machine.json", machine);
    const pPath = await put("process.json", proc);
    const fPaths: string[] = [];
    const source = await sourceSlots(req.file_id);
    const slots = req.trays.length ? req.trays : source.map(() => null);
    for (const [i, t] of slots.entries()) {
      // Ohne Fach: Material und Farbe aus der Datei (3MF), sonst Standard der Maschine
      const want = t ?? (source[i]?.type ? { profile: "", type: source[i]!.type, color: source[i]!.color } : null);
      const f = { ...filamentFor(machine, want) };
      const color = t?.color || source[i]?.color;
      if (color) f.filament_colour = [color.slice(0, 7).toUpperCase()];
      fPaths.push(await put(`filament-${i + 1}.json`, f));
    }
    // STEP kann die Orca-CLI nicht lesen: vorher in Dreiecke zerlegen (Zwischenspeicher je Datei)
    if (row.kind === "step") status("STEP umwandeln …");
    const input = row.kind === "step" ? await stepToStl(row.id, absPath(row)) : absPath(row);
    const src = path.join(dir, `modell.${row.kind === "step" ? "stl" : row.kind}`);
    const raw = new Uint8Array(await readFile(input));
    const fit = row.kind === "3mf" ? await refitProject(raw, await projectSettings(row), machine) : null;
    if (fit?.tower) {
      Object.assign(proc, fit.tower);
      await writeFile(pPath, JSON.stringify(proc, null, 1));
    }
    // Mehrere Exemplare: die CLI kann das je nach Datei nur auf einem Weg (siehe copyMode)
    const mode = copies > 1 ? await copyMode(row.kind, fit?.buf ?? raw, copies) : null;
    await writeFile(src, mode?.buf ?? fit?.buf ?? raw);
    const out = path.join(dir, "ergebnis.gcode.3mf");

    status(copies > 1 ? `Ordne ${copies} Exemplare an und slice …` : "Slicen …");
    const args = [
      "--debug", "1",
      // Projekt mit Platten (Bambu Studio, MakerWorld): Anordnung des Autors behalten, sonst schiebt die CLI alle Teile aller
      // Platten auf eine. Einzelne Dateien (STL & Co.) verteilt sie aufs Bett
      // --repetitions verlangt eine bestimmte Platte (Datei ohne Platten = Platte 1)
      "--slice", String(req.plate || (mode?.args[0] === "--repetitions" ? 1 : 0)),
      "--arrange", layoutOf(row).length ? "0" : "1",
      ...(mode?.args ?? []),
      "--orient", req.orient ? "1" : "0",
      "--load-settings", `${mPath};${pPath}`,
      "--load-filaments", fPaths.join(";"),
      "--export-3mf", out,
      src,
    ];
    const log = await run(s.bin, args, dir, signal);
    const result = await readFile(path.join(dir, "result.json"), "utf8").then((t) => JSON.parse(t) as { return_code?: number; error_string?: string }).catch(() => null);
    if (!existsSync(out)) {
      // Grund steht oft nur im Protokoll der CLI („Invalid params: …“), fürs Server-Log mitnehmen
      const lines = log.split("\n").filter((l) => /error|invalid/i.test(l)).slice(-4);
      if (lines.length) console.warn(`Slicer-Protokoll:\n  ${lines.join("\n  ").slice(0, 1200)}`);
      const why = result?.error_string || log.split("\n").filter((l) => /error/i.test(l)).slice(-2).join(" ").slice(0, 300) || "unbekannter Fehler";
      throw new SliceError(`Slicen fehlgeschlagen: ${why}`, 422);
    }
    await stampModelId(out, String(modelInfo(req.model)?.model_id ?? ""));
    return { dir, out, row };
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
}

async function doSlice(req: SliceRequest, status: (text: string) => void, signal?: AbortSignal) {
  const key = previewKey(req);
  // Gleiche Einstellungen wie die letzte Vorschau: deren Ergebnis übernehmen statt neu zu slicen
  const cached = previews.get(key);
  let src: string;
  let dir: string | null = null;
  let row = fileRow(req.file_id);
  if (cached && existsSync(cached.file) && row) {
    status("Übernehme Vorschau …");
    src = cached.file;
  } else {
    const r = await runSlice(req, status, signal);
    ({ dir, out: src, row } = r);
  }
  try {
    status("Speichere …");
    const proc2 = req.process.replace(/ @BBL.*$/, "");
    const name = `${baseName(row!.name)} (${proc2}${req.plate ? `, Platte ${req.plate}` : ""}${(req.copies ?? 1) > 1 && !layoutOf(row!).length ? `, ${req.copies}×` : ""}).gcode.3mf`;
    const tmp = path.join(FILE_DIR, `.import-${Date.now()}.gcode.3mf`);
    await copyFile(src, tmp);
    try {
      const r = await importLocal(row!.model_id, name, tmp);
      // Die CLI rendert kein Plattenbild: Vorschaubild der Quelldatei übernehmen, damit Druckdialog und Warteschlange ein Bild zeigen
      const has = db.prepare("SELECT has_thumb FROM files WHERE id = ?").get(r.id) as { has_thumb: number } | undefined;
      if (has && !has.has_thumb && row!.has_thumb && existsSync(thumbPath(row!.id))) {
        await copyFile(thumbPath(row!.id), thumbPath(r.id));
        db.prepare("UPDATE files SET has_thumb = 1 WHERE id = ?").run(r.id);
      }
      return { id: r.id, model_id: r.model_id };
    } finally {
      await rm(tmp, { force: true });
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

// ---------- Vorschau (Live-Werte im Dialog) ----------
// Jede Änderung im Dialog slict im Hintergrund mit denselben Profilen; Ergebnis (Gramm je Filament, Zeit) aus slice_info.
// Die Datei bleibt eine Weile liegen, damit „Slicen“ sie ohne zweiten Durchlauf übernimmt. Neue Vorschau bricht die alte ab,
// außer dem Vergleich mit dem Standard (einmal je Datei und Fachwahl, danach aus dem Zwischenspeicher).

const PREVIEW_DIR = path.join(FILE_DIR, ".previews");
const PREVIEW_KEEP = 8;
const previews = new Map<string, { file: string; plate: Plate; at: number }>();
const inflight = new Map<string, Promise<Plate>>();
let previewAc: AbortController | null = null;

const previewKey = (req: SliceRequest) =>
  createHash("sha1")
    .update(JSON.stringify({ ...req, trays: req.trays.map((t) => t && { id: t.id, profile: t.profile, type: t.type, color: t.color }) }))
    .digest("hex")
    .slice(0, 20);

/** `compare` = Vergleichswert (Standard des Profils): bricht die laufende Vorschau nicht ab und wird von neuen nicht abgebrochen */
export function preview(req: SliceRequest, status: (text: string) => void, signal?: AbortSignal, compare = false): Promise<Plate> {
  const key = previewKey(req);
  const hit = previews.get(key);
  if (hit && existsSync(hit.file)) return Promise.resolve(hit.plate);
  const running = inflight.get(key);
  if (running) return running;
  const ac = new AbortController();
  if (!compare) {
    previewAc?.abort();
    previewAc = ac;
  }
  signal?.addEventListener("abort", () => ac.abort(), { once: true });
  const job = slice0(async () => {
    ac.signal.throwIfAborted();
    const { dir, out } = await runSlice(req, status, ac.signal);
    try {
      const all = await unzipAsync(new Uint8Array(await readFile(out)), (n) => n === "Metadata/slice_info.config" || /^Metadata\/plate_\d+\.json$/.test(n));
      const xml = all["Metadata/slice_info.config"];
      const all2 = xml ? parseSliceInfo(new TextDecoder().decode(xml)) : [];
      const one = req.plate ? (all2.find((p) => p.index === req.plate) ?? all2[0]) : all2.length > 1 ? null : all2[0];
      const plate = one ? { ...one, boxes: plateBoxes(all[`Metadata/plate_${one.index}.json`]) } : all2.length ? sumPlates(all2) : null;
      if (!plate) throw new SliceError("Slicer lieferte keine Werte.", 422);
      await mkdir(PREVIEW_DIR, { recursive: true });
      const file = path.join(PREVIEW_DIR, `${key}.gcode.3mf`);
      await copyFile(out, file);
      previews.set(key, { file, plate, at: Date.now() });
      for (const [k, v] of [...previews].sort((a, b) => b[1].at - a[1].at).slice(PREVIEW_KEEP)) {
        previews.delete(k);
        await rm(v.file, { force: true });
      }
      return plate;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  inflight.set(key, job);
  void job.finally(() => inflight.delete(key)).catch(() => {});
  return job;
}

/** Alte Vorschauen vom letzten Lauf wegräumen */
void rm(PREVIEW_DIR, { recursive: true, force: true }).catch(() => {});

/** Die CLI lässt printer_model_id in slice_info.config leer; Bambu Studio trägt dort die Modellkennung ein (P2S = N7) */
async function stampModelId(file: string, id: string) {
  if (!id) return;
  const all = await new Promise<Record<string, Uint8Array>>((res, rej) => unzip(new Uint8Array(readFileSync(file)), (e, o) => (e ? rej(e) : res(o))));
  const key = "Metadata/slice_info.config";
  const xml = all[key] && new TextDecoder().decode(all[key]);
  if (!xml || !xml.includes('key="printer_model_id" value=""')) return;
  all[key] = new TextEncoder().encode(xml.replaceAll('key="printer_model_id" value=""', `key="printer_model_id" value="${id}"`));
  await writeFile(file, zipSync(all, { level: 6 }));
}

/** Startet den Slicer, sammelt die Ausgabe (gekürzt), bricht nach 15 min oder bei Abbruch ab */
function run(bin: string, args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { cwd, env: { ...process.env, HOME: cwd, LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    const add = (b: Buffer) => (log = (log + b.toString()).slice(-20_000));
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    const kill = () => p.kill("SIGKILL");
    const t = setTimeout(kill, 15 * 60_000);
    signal?.addEventListener("abort", kill, { once: true });
    p.on("error", (e) => (clearTimeout(t), rej(new SliceError(`Slicer startet nicht: ${e.message}`, 500))));
    p.on("close", () => {
      clearTimeout(t);
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) rej(new SliceError("Abgebrochen.", 499));
      else res(log);
    });
  });
}
