// Speicher des Druckers (SD-Karte, bei P2S/H2 USB-Stick) per FTPS: Dateien listen, in die Bibliothek holen (dann wie jede
// Datei drucken) und löschen. Gelesen werden nur die Wurzel und /cache (dort legt Bambu Studio Druckaufträge ab), Pfade
// mit .. oder anderen Ordnern lehnt der Server ab. Ohne Speicher (Bericht `sdcard: false`) gibt es nichts zu listen.
import { rm } from "node:fs/promises";
import path from "node:path";
import type { StorageFile } from "../shared/types.ts";
import { printerFtp, PrinterError } from "./bambu.ts";
import { DATA_DIR, db } from "./db.ts";
import { baseName, cleanName, importLocal, kindOf } from "./files.ts";
import { createModel, printerRow } from "./store.ts";

const DIRS = ["/", "/cache"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** LIST-Datum („Nov 13 23:54“ = dieses Jahr, „Nov 13 2025“); Uhrzeit des Druckers, als UTC gelesen */
function listDate(raw: string): string | null {
  const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(?:(\d{1,2}):(\d{2})|(\d{4}))$/);
  const mon = m ? MONTHS.indexOf(m[1]!.toLowerCase()) : -1;
  if (!m || mon < 0) return null;
  const now = new Date();
  let year = m[5] ? Number(m[5]) : now.getUTCFullYear();
  let d = Date.UTC(year, mon, Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0));
  // ohne Jahr und in der Zukunft: letztes Jahr
  if (!m[5] && d > now.getTime() + 86_400_000) d = Date.UTC(--year, mon, Number(m[2]), Number(m[3]), Number(m[4]));
  return new Date(d).toISOString();
}

/** Nur Dateien direkt in / oder /cache, ohne Pfadtricks */
function checkPath(p: string): string {
  const dir = path.posix.dirname(p);
  const name = path.posix.basename(p);
  if (!DIRS.includes(dir) || !name || name.startsWith(".") || p.includes("..") || /[\\\0]/.test(p)) throw new PrinterError("Ungültiger Pfad");
  return p;
}

export async function listStorage(printerId: number): Promise<StorageFile[]> {
  const ftp = await printerFtp(printerId);
  try {
    const out: StorageFile[] = [];
    for (const dir of DIRS) {
      const list = await ftp.list(dir).catch(() => []);
      for (const f of list) {
        if (!f.isFile || f.name.startsWith(".")) continue;
        const p = dir === "/" ? `/${f.name}` : `${dir}/${f.name}`;
        const known = db.prepare("SELECT id, model_id FROM files WHERE lower(name) = lower(?) ORDER BY id DESC LIMIT 1").get(f.name) as
          | { id: number; model_id: number }
          | undefined;
        out.push({
          path: p,
          name: f.name,
          size: f.size,
          modified: f.modifiedAt?.toISOString() ?? listDate(f.rawModifiedAt ?? ""),
          printable: /\.gcode\.3mf$/i.test(f.name),
          importable: !!kindOf(f.name),
          file_id: known?.id ?? null,
          model_id: known?.model_id ?? null,
        });
      }
    }
    return out.sort((a, b) => String(b.modified ?? "").localeCompare(String(a.modified ?? "")) || a.name.localeCompare(b.name));
  } finally {
    ftp.close();
  }
}

export async function deleteStorage(printerId: number, p: string) {
  const ftp = await printerFtp(printerId);
  try {
    await ftp.remove(checkPath(p));
  } finally {
    ftp.close();
  }
}

/** Datei in die Bibliothek holen (gleicher Inhalt per sha256 nur einmal); neues Modell mit Tag „Drucker“ */
export async function importStorage(printerId: number, p: string): Promise<{ id: number; model_id: number; existed: boolean }> {
  const name = path.posix.basename(checkPath(p));
  if (!kindOf(name)) throw new PrinterError("Dateityp nicht unterstützt");
  const ftp = await printerFtp(printerId, 120_000);
  const tmp = path.join(DATA_DIR, `storage-${Date.now()}-${cleanName(name)}`);
  try {
    const size = await ftp.size(p).catch(() => 0);
    if (size > 500 * 1024 ** 2) throw new PrinterError("Datei zu groß (über 500 MB)");
    await ftp.downloadTo(tmp, p);
    ftp.close();
    const printer = printerRow(printerId)?.name ?? "Drucker";
    return await importLocal(() => createModel({ name: baseName(name) || name, description: `Vom Speicher von ${printer} geholt.`, tags: ["Drucker"] }), name, tmp);
  } finally {
    ftp.close();
    await rm(tmp, { force: true });
  }
}
