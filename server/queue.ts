// Druckwarteschlange: Einträge mit Datei und Platte. Gestartet wird über den normalen Druckdialog (frische AMS-Zuordnung),
// der Druck nimmt seinen Eintrag mit (queue_id). Nach Druckende meldet notifyQueue den nächsten Eintrag.
import type { QueueEntry } from "../shared/types.ts";
import { db } from "./db.ts";
import { toFile } from "./store.ts";

type Row = Record<string, unknown>;

export function listQueue(): QueueEntry[] {
  const rows = db
    .prepare(
      `SELECT q.id AS q_id, q.plate AS q_plate, q.printer_id AS q_printer, q.note AS q_note, q.created_at AS q_created,
         m.name AS model_name, f.* FROM print_queue q JOIN files f ON f.id = q.file_id JOIN models m ON m.id = f.model_id
       ORDER BY q.position, q.id`,
    )
    .all() as Row[];
  return rows.map((r) => ({
    id: r.q_id as number,
    plate: r.q_plate as number,
    printer_id: (r.q_printer as number | null) ?? null,
    note: r.q_note as string,
    created_at: r.q_created as string,
    model_name: r.model_name as string,
    file: toFile(r),
  }));
}

export function addQueue(fileId: number, plate: number, printerId: number | null, note = ""): number {
  const pos = (db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM print_queue").get() as { p: number }).p;
  const r = db
    .prepare("INSERT INTO print_queue (file_id, plate, printer_id, position, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(fileId, plate, printerId, pos, note, new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export const removeQueue = (id: number) => db.prepare("DELETE FROM print_queue WHERE id = ?").run(id).changes > 0;

/** Reihenfolge neu setzen (alle IDs in der gewünschten Folge) */
export function orderQueue(ids: number[]) {
  const set = db.prepare("UPDATE print_queue SET position = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    ids.forEach((id, i) => set.run(i + 1, id));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Nächster Eintrag für einen Drucker (eigene oder ohne festen Drucker) */
export const nextFor = (printerId: number) => listQueue().find((q) => q.printer_id == null || q.printer_id === printerId) ?? null;
