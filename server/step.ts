// STEP → STL für den Slicer: Die Kommandozeilen von Bambu Studio und OrcaSlicer lesen STEP nicht zuverlässig. OpenCascade als WebAssembly
// (occt-import-js) zerlegt die Flächen in Dreiecke, das Ergebnis liegt je Datei im Zwischenspeicher und wird nur einmal gerechnet.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { FILE_DIR } from "./db.ts";

type Mesh = { attributes: { position: { array: number[] } }; index: { array: number[] } };
type Occt = { ReadStepFile: (data: Uint8Array, params: object | null) => { success: boolean; meshes: Mesh[] } };

const CACHE = path.join(FILE_DIR, ".step");
let occt: Promise<Occt> | null = null;
const load = () => (occt ??= (createRequire(import.meta.url)("occt-import-js") as () => Promise<Occt>)());

/** Binäre STL aus allen Teilen der STEP-Datei (Millimeter, feine Auflösung relativ zur Größe) */
async function convert(src: string): Promise<Buffer> {
  const res = (await load()).ReadStepFile(new Uint8Array(await readFile(src)), {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.0005,
    angularDeflection: 0.3,
  });
  const tris = res.success ? res.meshes.reduce((n, m) => n + m.index.array.length / 3, 0) : 0;
  if (!tris) throw new Error("STEP-Datei enthält keine lesbaren Körper");
  const buf = Buffer.alloc(84 + tris * 50);
  buf.write("Druckwerk STEP", 0);
  buf.writeUInt32LE(tris, 80);
  let o = 84;
  for (const m of res.meshes) {
    const p = m.attributes.position.array;
    const ix = m.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      o += 12; // Normale 0: der Slicer rechnet sie aus der Reihenfolge der Ecken
      for (const v of [ix[i], ix[i + 1], ix[i + 2]]) {
        buf.writeFloatLE(p[v * 3], o);
        buf.writeFloatLE(p[v * 3 + 1], o + 4);
        buf.writeFloatLE(p[v * 3 + 2], o + 8);
        o += 12;
      }
      o += 2;
    }
  }
  return buf;
}

/** Pfad der STL zur STEP-Datei mit dieser ID; rechnet beim ersten Mal */
export async function stepToStl(fileId: number, src: string): Promise<string> {
  const out = path.join(CACHE, `${fileId}.stl`);
  if (existsSync(out)) return out;
  await mkdir(CACHE, { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  await writeFile(tmp, await convert(src));
  await rename(tmp, out);
  return out;
}
