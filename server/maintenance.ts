// Wartung (Tabelle maintenance): Druckstunden je Drucker aus dem Verlauf plus printers.hours_base
import { maintStatus, type MaintPrinter, type MaintTask, type MaintTaskInput } from "../shared/maintenance.ts";
import { db, nowIso } from "./db.ts";

/** Druckstunden des Druckers: alle Drucke im Verlauf (laufende bis jetzt) plus Stunden vor Druckwerk */
export function printerHours(printerId: number): number {
  const r = db
    .prepare(
      `SELECT p.hours_base AS base, COALESCE((SELECT SUM(julianday(COALESCE(ended_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))) - julianday(started_at))
         FROM prints WHERE printer_id = p.id), 0) * 24 AS h FROM printers p WHERE p.id = ?`,
    )
    .get(printerId) as { base: number; h: number } | undefined;
  return r ? r.base + Math.max(0, r.h) : 0;
}

export const getTask = (id: number) => db.prepare("SELECT * FROM maintenance WHERE id = ?").get(id) as MaintTask | undefined;

export function overview(): MaintPrinter[] {
  const printers = db.prepare("SELECT id, name, hours_base FROM printers ORDER BY id").all() as { id: number; name: string; hours_base: number }[];
  return printers.map((p) => {
    const hours = printerHours(p.id);
    const tasks = (db.prepare("SELECT * FROM maintenance WHERE printer_id = ?").all(p.id) as MaintTask[])
      .map((t) => maintStatus(t, hours))
      .sort((a, b) => b.ratio - a.ratio);
    return { printer_id: p.id, name: p.name, hours, hours_base: p.hours_base, tasks };
  });
}

export function addTask(printerId: number, t: MaintTaskInput, doneHoursAgo = 0): number {
  const hours = printerHours(printerId);
  return Number(
    db
      .prepare("INSERT INTO maintenance (printer_id, name, interval_h, interval_d, done_hours, done_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(printerId, t.name, t.interval_h, t.interval_d, Math.max(0, hours - doneHoursAgo), nowIso(), t.note, nowIso()).lastInsertRowid,
  );
}

export function updateTask(id: number, t: Partial<MaintTaskInput>) {
  const keys = (["name", "interval_h", "interval_d", "note"] as const).filter((k) => t[k] !== undefined);
  if (keys.length) db.prepare(`UPDATE maintenance SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => t[k] ?? null), id);
}

/** Erledigt: Zähler auf den aktuellen Stand */
export function doneTask(id: number) {
  const t = getTask(id);
  if (t) db.prepare("UPDATE maintenance SET done_hours = ?, done_at = ? WHERE id = ?").run(printerHours(t.printer_id), nowIso(), id);
}

export const deleteTask = (id: number) => db.prepare("DELETE FROM maintenance WHERE id = ?").run(id).changes > 0;

/** Stunden vor Druckwerk setzen; die Stände der Punkte wandern mit, damit nichts plötzlich fällig wird */
export function setHoursBase(printerId: number, h: number): boolean {
  const old = db.prepare("SELECT hours_base FROM printers WHERE id = ?").get(printerId) as { hours_base: number } | undefined;
  if (!old) return false;
  db.prepare("UPDATE printers SET hours_base = ? WHERE id = ?").run(h, printerId);
  db.prepare("UPDATE maintenance SET done_hours = done_hours + ? WHERE printer_id = ?").run(h - old.hours_base, printerId);
  return true;
}
