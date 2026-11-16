// Objekte überspringen: Bambu Studio liest aus der .gcode.3mf des laufenden Drucks die Objekte der Platte
// (slice_info.config bzw. model_settings.config: identify_id + Name) und das Auswahlbild Metadata/pick_N.png. Jedes Objekt
// ist dort in einer eigenen Farbe gemalt: ID = R + G·256 + B·65536. Der Befehl ist `skip_objects` mit `obj_list` = IDs,
// der Bericht meldet übersprungene IDs in `s_obj`. Hier: beides je Druck einmal auslesen und in DATA_DIR/parts ablegen.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import type { PrintParts } from "../shared/types.ts";
import { DATA_DIR, db } from "./db.ts";
import { absPath, fileRow } from "./files.ts";

const PARTS_DIR = path.join(DATA_DIR, "parts");
const jsonPath = (printId: number) => path.join(PARTS_DIR, `${printId}.json`);
export const pickPath = (printId: number) => path.join(PARTS_DIR, `${printId}.png`);

const attr = (s: string, k: string) => s.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1] ?? "";
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Objekte einer Platte aus slice_info.config oder model_settings.config */
function plateObjects(xml: string, plate: number): { objects: { id: number; name: string }[]; labeled: boolean } | null {
  for (const block of xml.match(/<plate>[\s\S]*?<\/plate>/g) ?? []) {
    const index = Number(block.match(/<metadata\s+key="(?:index|plater_id)"\s+value="(\d+)"/)?.[1]);
    if (index !== plate) continue;
    const objects = [...block.matchAll(/<object\b[^>]*>/g)]
      .filter(([tag]) => attr(tag, "skipped") !== "true" && attr(tag, "identify_id"))
      .map(([tag]) => ({ id: Number(attr(tag, "identify_id")), name: unescape(attr(tag, "name")) || `Objekt ${attr(tag, "identify_id")}` }));
    // Ohne Objekt-Beschriftung im G-Code kann der Drucker nichts überspringen (Bambu Studio: „Objekte beschriften“)
    const labeled = block.match(/<metadata\s+key="label_object_enabled"\s+value="([^"]*)"/)?.[1] !== "false";
    return { objects, labeled };
  }
  return null;
}

/** Objekte und Auswahlbild aus einer .gcode.3mf ablegen; ohne Objekt-IDs nichts */
export async function saveParts(printId: number, zip: Uint8Array, plate: number) {
  const want = new Set([`Metadata/pick_${plate}.png`, "Metadata/slice_info.config", "Metadata/model_settings.config"]);
  const out = unzipSync(zip, { filter: (e) => want.has(e.name) });
  const text = (n: string) => (out[n] ? new TextDecoder().decode(out[n]) : "");
  const found = plateObjects(text("Metadata/slice_info.config"), plate) ?? plateObjects(text("Metadata/model_settings.config"), plate);
  if (!found?.objects.length) return;
  const pick = out[`Metadata/pick_${plate}.png`];
  await mkdir(PARTS_DIR, { recursive: true });
  if (pick) await writeFile(pickPath(printId), pick);
  const parts: Omit<PrintParts, "skipped"> = { print_id: printId, plate, objects: found.objects, labeled: found.labeled, pick: !!pick };
  await writeFile(jsonPath(printId), JSON.stringify(parts));
}

/** Objekte des Drucks; beim ersten Mal aus der Datei in der Bibliothek (Druck aus Druckwerk oder erkannt) */
export async function partsOf(printId: number): Promise<Omit<PrintParts, "skipped"> | null> {
  if (existsSync(jsonPath(printId))) return JSON.parse(await readFile(jsonPath(printId), "utf8"));
  const p = db.prepare("SELECT file_id, plate FROM prints WHERE id = ?").get(printId) as { file_id: number | null; plate: number | null } | undefined;
  const file = p?.file_id ? fileRow(p.file_id) : null;
  if (!file || file.kind !== "gcode3mf" || !existsSync(absPath(file))) return null;
  await saveParts(printId, await readFile(absPath(file)), p!.plate ?? 1).catch((e) => console.warn(`Objekte von Druck ${printId}:`, (e as Error).message));
  return existsSync(jsonPath(printId)) ? JSON.parse(await readFile(jsonPath(printId), "utf8")) : null;
}
