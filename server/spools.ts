// Filament-Bibliothek: Spulen, Zuordnung zu AMS-Fächern und Verbrauch.
// Verbrauch je Druck = used_g aus slice_info.config der Platte × Fortschritt (fertig = 100 %), gebucht auf die Spule,
// die beim Start im gemappten Fach lag. Ohne slice_info: Rückgang des RFID-Restwerts der Bambu-Spulen.
// Füllstand: Bambu-Spulen folgen dem RFID-Restwert (track 'rfid'), bis eine volle Spule (100 %) im Fach liegt
// oder der Nutzer wiegt bzw. korrigiert; ab dann zählt die App selbst (track 'eigen') und der Restwert des Druckers zählt nicht mehr.
import type { Spool, SpoolInput, SpoolUsage } from "../shared/types.ts";
import { autoColorName } from "../shared/colors.ts";
import { db, nowIso } from "./db.ts";
import { setting } from "./settings.ts";

type Row = Record<string, unknown>;

/** Fach-Nummer wie in ams_mapping: AMS-Index × 4 + Fach, 254 = externe Spule, AMS HT ab Index 128 */
export const trayLabel = (tray: number) => {
  if (tray === 254 || tray === 255) return "Extern";
  const a = tray >> 2;
  return a >= 128 ? `HT${a - 127}` : `${"ABCDEFGH"[a] ?? a + 1}${(tray & 3) + 1}`;
};

const SELECT = `SELECT s.*, pr.name AS printer_name FROM spools s LEFT JOIN printers pr ON pr.id = s.printer_id`;

const toSpool = (r: Row): Spool => {
  const net = r.net_g as number;
  const used = r.used_g as number;
  const tray = (r.tray as number | null) ?? null;
  return {
    id: r.id as number,
    brand: r.brand as string,
    material: r.material as string,
    name: r.name as string,
    color: r.color as string,
    color_name: r.color_name as string,
    net_g: net,
    used_g: Math.round(used * 10) / 10,
    remaining_g: Math.max(0, Math.round((net - used) * 10) / 10),
    tare_g: (r.tare_g as number | null) ?? null,
    price: (r.price as number | null) ?? null,
    price_sale: (r.price_sale as number | null) ?? null,
    profile_id: (r.profile_id as string | null) || null,
    nozzle_min: (r.nozzle_min as number | null) ?? null,
    nozzle_max: (r.nozzle_max as number | null) ?? null,
    bed_temp: (r.bed_temp as number | null) ?? null,
    dry_temp: (r.dry_temp as number | null) ?? null,
    dry_hours: (r.dry_hours as number | null) ?? null,
    url: (r.url as string) ?? "",
    location: r.location as string,
    rfid: !!r.rfid,
    track: r.track === "rfid" ? "rfid" : "eigen",
    rfid_full: !!r.rfid_full,
    printer_id: (r.printer_id as number | null) ?? null,
    tray,
    slot: r.printer_id != null && tray != null ? `${r.printer_name as string} · ${trayLabel(tray)}` : null,
    note: r.note as string,
    archived: !!r.archived,
    created_at: r.created_at as string,
    last_used_at: (r.last_used_at as string | null) ?? null,
  };
};

export const listSpools = () => (db.prepare(`${SELECT} ORDER BY s.archived, s.material, s.brand, s.id`).all() as Row[]).map(toSpool);
export const getSpool = (id: number) => {
  const r = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as Row | undefined;
  return r ? toSpool(r) : null;
};

const COLS = [
  "brand", "material", "name", "color", "color_name", "net_g", "used_g", "tare_g", "price", "price_sale", "profile_id", "nozzle_min", "nozzle_max",
  "bed_temp", "dry_temp", "dry_hours", "url", "location", "note",
] as const;

export function createSpool(b: SpoolInput & { rfid?: string | null }): number {
  // Ohne Farbname: offizieller Bambu-Name bzw. nächste Grundfarbe
  if (!b.color_name?.trim()) b = { ...b, color_name: autoColorName(b) };
  const vals = COLS.map((k) => (k === "used_g" ? (b.used_g ?? 0) : k === "url" ? (b.url ?? "") : ((b[k] as string | number | null | undefined) ?? null)));
  const r = db
    .prepare(`INSERT INTO spools (${COLS.join(", ")}, rfid, track) VALUES (${COLS.map(() => "?").join(", ")}, ?, ?)`)
    .run(...vals, b.rfid ?? null, b.rfid ? (b.track ?? "rfid") : "eigen");
  return Number(r.lastInsertRowid);
}

export function updateSpool(id: number, b: Partial<SpoolInput>) {
  const cols = [...COLS, "archived"] as const;
  const set: string[] = cols.filter((k) => b[k] !== undefined);
  const vals = cols.filter((k) => b[k] !== undefined).map((k) => (k === "archived" ? (b.archived ? 1 : 0) : (b[k] as string | number | null)));
  // Verbrauch von Hand gesetzt: ab jetzt zählt die App, nicht mehr der RFID-Restwert
  if (b.color_name !== undefined && !b.color_name.trim()) {
    const cur = getSpool(id);
    if (cur) b = { ...b, color_name: autoColorName({ color: b.color ?? cur.color, brand: b.brand ?? cur.brand, name: b.name ?? cur.name, profile_id: b.profile_id ?? cur.profile_id }) };
  }
  const track = b.used_g !== undefined ? "eigen" : b.track;
  if (track === "eigen" || track === "rfid") (set.push("track", "rfid_full"), vals.push(track, 0));
  if (!set.length) return;
  db.prepare(`UPDATE spools SET ${set.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, nowIso(), id);
  // Archivierte Spulen liegen in keinem Fach mehr
  if (b.archived) db.prepare("UPDATE spools SET printer_id = NULL, tray = NULL WHERE id = ?").run(id);
}

export const deleteSpool = (id: number) => db.prepare("DELETE FROM spools WHERE id = ?").run(id).changes > 0;

export function addUsage(spoolId: number, grams: number, source: SpoolUsage["source"], printId: number | null = null, note = "") {
  if (!grams) return;
  db.prepare("INSERT INTO spool_usage (spool_id, print_id, grams, source, note) VALUES (?, ?, ?, ?, ?)").run(spoolId, printId, grams, source, note);
  // Abgleich mit dem Restwert ist kein Gebrauch; gewogen oder von Hand eingetragen heißt: ab jetzt selbst zählen
  const touch = grams > 0 && source !== "rfid";
  const own = source === "manuell" || source === "waage";
  db.prepare(`UPDATE spools SET used_g = MAX(0, used_g + ?), updated_at = ?${touch ? ", last_used_at = ?" : ""}${own ? ", track = 'eigen', rfid_full = 0" : ""} WHERE id = ?`).run(
    ...(touch ? [grams, nowIso(), nowIso(), spoolId] : [grams, nowIso(), spoolId]),
  );
}

/**
 * Bambu-Spulen im RFID-Modus auf den Restwert des Druckers ziehen. Meldet eine Spule 100 %, zählt ab hier die App selbst
 * (`rfid_full`), denn 100 % meldet das AMS auch, wenn es den Rest nicht kennt. Meldet es später weniger (Chip neu eingelesen),
 * folgt die Spule wieder dem AMS, aber nicht mitten im Druck.
 */
export function syncRfidRemain(trays: TrayInfo[], onlyNew = false) {
  for (const t of trays) {
    if (!t.uuid || t.remain == null) continue;
    const s = db.prepare("SELECT id, net_g, used_g, track, rfid_full FROM spools WHERE rfid = ?").get(t.uuid) as
      | { id: number; net_g: number; used_g: number; track: string; rfid_full: number }
      | undefined;
    if (!s) continue;
    if (s.track === "eigen" && s.rfid_full && t.remain < 100 && !onlyNew) {
      db.prepare("UPDATE spools SET track = 'rfid', rfid_full = 0, updated_at = ? WHERE id = ?").run(nowIso(), s.id);
      console.log(`Spule #${s.id}: AMS meldet ${t.remain} %, folgt wieder dem AMS`);
      s.track = "rfid";
    }
    if (s.track !== "rfid") continue;
    // Während eines Drucks nur Spulen übernehmen, die noch nie abgeglichen wurden (der Rest folgt nach der Druckbuchung)
    if (onlyNew && db.prepare("SELECT 1 FROM spool_usage WHERE spool_id = ?").get(s.id)) continue;
    const target = t.remain >= 100 ? 0 : Math.round(s.net_g * (1 - t.remain / 100) * 10) / 10;
    const diff = Math.round((target - s.used_g) * 10) / 10;
    if (Math.abs(diff) >= 1) addUsage(s.id, diff, "rfid", null, `Drucker meldet ${t.remain} %`);
    if (t.remain >= 100) {
      db.prepare("UPDATE spools SET track = 'eigen', rfid_full = 1, updated_at = ? WHERE id = ?").run(nowIso(), s.id);
      console.log(`Spule #${s.id} ist voll (100 %): ab jetzt eigene Zählung`);
    }
  }
}

export const usageOf = (spoolId: number): SpoolUsage[] =>
  (
    db
      .prepare(
        `SELECT u.*, COALESCE(m.name, p.name) AS print_name FROM spool_usage u
         LEFT JOIN prints p ON p.id = u.print_id LEFT JOIN models m ON m.id = p.model_id
         WHERE u.spool_id = ? ORDER BY u.created_at DESC, u.id DESC LIMIT 200`,
      )
      .all(spoolId) as Row[]
  ).map((r) => ({
    id: r.id as number,
    grams: r.grams as number,
    source: r.source as SpoolUsage["source"],
    print_id: (r.print_id as number | null) ?? null,
    print_name: (r.print_name as string | null) ?? null,
    note: r.note as string,
    created_at: r.created_at as string,
  }));

/** Spule in ein Fach legen (das Fach wird vorher frei gemacht) oder herausnehmen */
export function setSlot(spoolId: number, printerId: number | null, tray: number | null) {
  if (printerId != null && tray != null) db.prepare("UPDATE spools SET printer_id = NULL, tray = NULL WHERE printer_id = ? AND tray = ? AND id != ?").run(printerId, tray, spoolId);
  db.prepare("UPDATE spools SET printer_id = ?, tray = ?, updated_at = ? WHERE id = ?").run(printerId, tray, nowIso(), spoolId);
}

export const spoolAt = (printerId: number, tray: number) =>
  (db.prepare("SELECT id FROM spools WHERE printer_id = ? AND tray = ? AND archived = 0").get(printerId, tray) as { id: number } | undefined)?.id ?? null;

export const slotMap = (printerId: number) =>
  new Map((db.prepare("SELECT id, tray FROM spools WHERE printer_id = ? AND archived = 0 AND tray IS NOT NULL").all(printerId) as { id: number; tray: number }[]).map((r) => [r.tray, r.id]));

/** Rohdaten eines Fachs aus dem Druckerbericht */
export type TrayInfo = {
  id: number;
  uuid: string;
  type: string;
  name: string;
  color: string;
  weight: number | null;
  remain: number | null;
  loaded: boolean; // Spule steckt (tray_exist_bits), auch ohne Material/RFID
  reading: boolean; // RFID wird gelesen
  profile: string; // tray_info_idx (Profil-ID des Fachs)
  code: string; // Farbcode vom Chip (tray_id_name „A01-K1“ → „K1“), "" ohne Chip
};

const sameMaterial = (a: string, b: string) => {
  const x = a.toUpperCase().split(/[\s-]/)[0]!;
  const y = b.toUpperCase().split(/[\s-]/)[0]!;
  return !x || !y || x === y;
};

/**
 * Neuer Chip: vorab ins Regal gestellte Bambu-Spule (ohne Chip, unbenutzt, in keinem Fach) mit gleichem Profil bzw. Material
 * und gleicher Farbe übernimmt ihn, älteste zuerst. So gibt es bestellte Spulen nach dem ersten Einlegen nicht doppelt.
 */
function claimPrepared(t: TrayInfo): { id: number; printer_id: number | null; tray: number | null; archived: number } | undefined {
  if (!/^#[0-9a-f]{6}/i.test(t.color)) return;
  const rows = db
    .prepare(
      `SELECT id, material, name, color, profile_id FROM spools WHERE rfid IS NULL AND archived = 0 AND printer_id IS NULL AND used_g = 0
       AND brand LIKE '%bambu%' ORDER BY created_at, id`,
    )
    .all() as { id: number; material: string; name: string; color: string; profile_id: string | null }[];
  const fit = rows
    .filter((r) => (r.profile_id && t.profile ? r.profile_id === t.profile : sameMaterial(r.material, t.type) && norm(r.name) === norm(t.name)))
    .map((r) => ({ r, d: /^#[0-9a-f]{6}$/i.test(r.color) ? colorDist(r.color, t.color.slice(0, 7)) : Infinity }))
    .filter((x) => x.d <= setting<number>("filament", "claim_distance"))
    .sort((a, b) => a.d - b.d)[0]?.r;
  if (!fit) return;
  const net = t.weight && t.weight > 0 ? t.weight : null;
  db.prepare(
    `UPDATE spools SET rfid = ?, track = 'rfid', rfid_full = 0, color = ?, net_g = COALESCE(?, net_g), profile_id = COALESCE(profile_id, ?),
     name = CASE WHEN ? <> '' THEN ? ELSE name END, updated_at = ? WHERE id = ?`,
  ).run(t.uuid, t.color.slice(0, 7).toUpperCase(), net, t.profile || null, t.name, t.name, nowIso(), fit.id);
  console.log(`Bambu-Spule ${t.name || t.type} im Fach ${trayLabel(t.id)}: Chip mit vorbereiteter Spule #${fit.id} verknüpft`);
  return { id: fit.id, printer_id: null, tray: null, archived: 0 };
}

const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Fächer mit der Bibliothek abgleichen: Bambu-Spulen (RFID) werden beim ersten Einlegen angelegt und ihrem Fach zugeordnet,
 * Spulen ohne Chip fliegen aus dem Fach, wenn es leer ist oder dort ein anderes Material liegt.
 */
export function syncTrays(printerId: number, trays: TrayInfo[]) {
  for (const t of trays) {
    const occupant = db.prepare("SELECT id, rfid, material FROM spools WHERE printer_id = ? AND tray = ?").get(printerId, t.id) as
      | { id: number; rfid: string | null; material: string }
      | undefined;
    if (t.uuid) {
      let s = db.prepare("SELECT id, printer_id, tray, archived FROM spools WHERE rfid = ?").get(t.uuid) as
        | { id: number; printer_id: number | null; tray: number | null; archived: number }
        | undefined;
      if (!s) s = claimPrepared(t);
      if (!s) {
        // Füllstand setzt syncRfidRemain: aus dem Restwert oder, bei voller Spule, eigene Zählung ab 0
        const net = t.weight && t.weight > 0 ? t.weight : setting<number>("filament", "net_g");
        const id = createSpool({
          brand: "Bambu Lab", material: t.type || "PLA", name: t.name, color: t.color || "#888888",
          color_name: autoColorName({ color: t.color, brand: "Bambu Lab", profile_id: t.profile, code: t.code }), net_g: net,
          used_g: 0, tare_g: null, price: null, location: "", note: "", rfid: t.uuid, track: "rfid", profile_id: t.profile || null,
        });
        console.log(`Bambu-Spule ${t.name || t.type} im Fach ${trayLabel(t.id)} erkannt und angelegt (#${id})`);
        s = { id, printer_id: null, tray: null, archived: 0 };
      }
      if (s.archived) db.prepare("UPDATE spools SET archived = 0 WHERE id = ?").run(s.id);
      // Profil der Bambu-Spule kommt vom Chip
      if (t.profile) db.prepare("UPDATE spools SET profile_id = ? WHERE id = ? AND profile_id IS NULL").run(t.profile, s.id);
      if (t.color) {
        const name = autoColorName({ color: t.color, brand: "Bambu Lab", profile_id: t.profile, code: t.code });
        db.prepare("UPDATE spools SET color_name = ? WHERE id = ? AND color_name = ''").run(name, s.id);
      }
      if (s.printer_id !== printerId || s.tray !== t.id) setSlot(s.id, printerId, t.id);
    } else if (occupant && (occupant.rfid || !t.loaded || (t.type && !sameMaterial(occupant.material, t.type)))) {
      // Steckt eine Spule ohne Material am Drucker, bleibt die von Hand zugeordnete Spule im Fach
      setSlot(occupant.id, null, null);
    }
  }
}

/** Plan-Eintrag je Filament eines Drucks */
export type PlanItem = { tray: number | null; spool_id: number | null; type: string; color: string; grams: number };
export type TrayStart = Record<string, { uuid: string; remain: number; weight: number }>;

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
const colorDist = (a: string, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
};

/**
 * Verbrauch eines beendeten Drucks buchen. Fächer ohne Mapping (Druck kam aus Bambu Studio) werden über die
 * während des Drucks aktiven Fächer und Material/Farbe zugeordnet.
 */
export function bookPrint(
  printId: number,
  printerId: number,
  done: boolean,
  progress: number,
  endTrays: TrayInfo[],
) {
  if (db.prepare("SELECT 1 FROM spool_usage WHERE print_id = ? AND source = 'druck'").get(printId)) return;
  const row = db.prepare("SELECT plan, tray_start, trays_seen, name FROM prints WHERE id = ?").get(printId) as
    | { plan: string; tray_start: string; trays_seen: string; name: string }
    | undefined;
  if (!row) return;
  const plan = JSON.parse(row.plan) as PlanItem[];
  const seen = JSON.parse(row.trays_seen) as number[];
  const factor = done ? 1 : Math.min(1, Math.max(0, progress / 100));
  let booked = 0;

  if (plan.some((p) => p.grams > 0)) {
    const candidates = endTrays.filter((t) => seen.includes(t.id));
    const pool = candidates.length ? candidates : endTrays.filter((t) => t.type);
    const used = new Set<number>();
    for (const p of plan) {
      const g = Math.round(p.grams * factor * 10) / 10;
      if (g <= 0) continue;
      let tray = p.tray;
      if (tray == null) {
        const fit = pool
          .filter((t) => !used.has(t.id))
          .sort((a, b) => Number(!sameMaterial(a.type, p.type)) - Number(!sameMaterial(b.type, p.type)) || colorDist(a.color, p.color) - colorDist(b.color, p.color))[0];
        tray = fit?.id ?? (plan.length === 1 && seen.length ? seen[0]! : null);
        if (tray != null && plan.length > 1) used.add(tray);
      }
      const spool = p.spool_id ?? (tray != null ? spoolAt(printerId, tray) : null);
      if (spool && db.prepare("SELECT 1 FROM spools WHERE id = ?").get(spool)) {
        addUsage(spool, g, "druck", printId);
        booked += g;
      }
    }
  } else {
    // Ohne slice_info: Rückgang der RFID-Restwerte (Bambu-Spulen melden Prozent und Nennegewicht)
    const start = JSON.parse(row.tray_start) as TrayStart;
    for (const t of endTrays) {
      const s = start[t.id];
      if (!s || !t.uuid || s.uuid !== t.uuid || t.remain == null || t.remain >= s.remain) continue;
      const g = Math.round(((s.remain - t.remain) / 100) * s.weight * 10) / 10;
      const spool = db.prepare("SELECT id FROM spools WHERE rfid = ?").get(t.uuid) as { id: number } | undefined;
      if (spool && g > 0) {
        addUsage(spool.id, g, "druck", printId, "aus RFID-Restwert");
        booked += g;
      }
    }
  }
  if (booked) console.log(`Druck ${printId} (${row.name}): ${booked.toFixed(1)} g Filament gebucht`);
}

/** Spulen ohne Farbname bekommen einen (beim Start, für vorhandene Daten); eigene Namen bleiben */
export function fillColorNames() {
  const rows = db.prepare("SELECT id, color, brand, name, profile_id FROM spools WHERE color_name = ''").all() as {
    id: number;
    color: string;
    brand: string;
    name: string;
    profile_id: string | null;
  }[];
  for (const r of rows) {
    const name = autoColorName(r);
    if (name) db.prepare("UPDATE spools SET color_name = ? WHERE id = ?").run(name, r.id);
  }
}
