import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "data");
export const FILE_DIR = path.join(DATA_DIR, "files");
export const THUMB_DIR = path.join(DATA_DIR, "thumbs");
export const PHOTO_DIR = path.join(DATA_DIR, "photos");
for (const d of [FILE_DIR, THUMB_DIR, PHOTO_DIR]) mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "stl.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const now = `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Migrationen in Reihenfolge, Stand in user_version */
const migrations: string[] = [
  `
  CREATE TABLE models (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    source_url TEXT NOT NULL DEFAULT '',
    creator TEXT NOT NULL DEFAULT '',
    license TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0,
    cover_file_id INTEGER,
    created_at TEXT NOT NULL DEFAULT ${now},
    updated_at TEXT NOT NULL DEFAULT ${now}
  );

  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    has_thumb INTEGER NOT NULL DEFAULT 0,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT ${now}
  );
  CREATE INDEX files_model ON files(model_id);

  CREATE TABLE printers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    serial TEXT NOT NULL,
    access_code TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT 'P1S',
    created_at TEXT NOT NULL DEFAULT ${now}
  );

  CREATE TABLE prints (
    id INTEGER PRIMARY KEY,
    printer_id INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
    model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
    file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    plate INTEGER,
    status TEXT NOT NULL DEFAULT 'laeuft' CHECK (status IN ('laeuft', 'fertig', 'fehler', 'abgebrochen')),
    progress INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT ${now},
    ended_at TEXT,
    filaments TEXT NOT NULL DEFAULT '[]',
    error_code INTEGER,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    note TEXT NOT NULL DEFAULT '',
    has_photo INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX prints_model ON prints(model_id);
  CREATE INDEX prints_printer ON prints(printer_id, status);
  `,
  `
  CREATE TABLE spools (
    id INTEGER PRIMARY KEY,
    brand TEXT NOT NULL DEFAULT '',
    material TEXT NOT NULL DEFAULT 'PLA',
    name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#888888',
    color_name TEXT NOT NULL DEFAULT '',
    net_g REAL NOT NULL DEFAULT 1000,
    used_g REAL NOT NULL DEFAULT 0,
    tare_g REAL,
    price REAL,
    location TEXT NOT NULL DEFAULT '',
    rfid TEXT,
    printer_id INTEGER REFERENCES printers(id) ON DELETE SET NULL,
    tray INTEGER,
    note TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ${now},
    updated_at TEXT NOT NULL DEFAULT ${now},
    last_used_at TEXT
  );
  CREATE UNIQUE INDEX spools_rfid ON spools(rfid) WHERE rfid IS NOT NULL;
  CREATE INDEX spools_slot ON spools(printer_id, tray);

  CREATE TABLE spool_usage (
    id INTEGER PRIMARY KEY,
    spool_id INTEGER NOT NULL REFERENCES spools(id) ON DELETE CASCADE,
    print_id INTEGER REFERENCES prints(id) ON DELETE SET NULL,
    grams REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manuell' CHECK (source IN ('druck', 'manuell', 'waage')),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ${now}
  );
  CREATE INDEX spool_usage_spool ON spool_usage(spool_id);
  CREATE INDEX spool_usage_print ON spool_usage(print_id);

  -- Verbrauchsplan je Druck: [{tray, spool_id, type, color, grams}] aus slice_info, plus Restwerte der RFID-Fächer beim Start
  ALTER TABLE prints ADD COLUMN plan TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE prints ADD COLUMN tray_start TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE prints ADD COLUMN trays_seen TEXT NOT NULL DEFAULT '[]';
  `,
  `
  -- Füllstand: 'rfid' folgt dem Restwert des Druckers, 'eigen' zählt die App (ab voller Spule, Waage oder Handeintrag)
  ALTER TABLE spools ADD COLUMN track TEXT NOT NULL DEFAULT 'eigen' CHECK (track IN ('eigen', 'rfid'));
  UPDATE spools SET track = 'rfid' WHERE rfid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM spool_usage u WHERE u.spool_id = spools.id);

  -- Quelle 'rfid' für Abgleiche mit dem Restwert des Druckers
  CREATE TABLE spool_usage_new (
    id INTEGER PRIMARY KEY,
    spool_id INTEGER NOT NULL REFERENCES spools(id) ON DELETE CASCADE,
    print_id INTEGER REFERENCES prints(id) ON DELETE SET NULL,
    grams REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'manuell' CHECK (source IN ('druck', 'manuell', 'waage', 'rfid')),
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ${now}
  );
  INSERT INTO spool_usage_new SELECT id, spool_id, print_id, grams, source, note, created_at FROM spool_usage;
  DROP TABLE spool_usage;
  ALTER TABLE spool_usage_new RENAME TO spool_usage;
  CREATE INDEX spool_usage_spool ON spool_usage(spool_id);
  CREATE INDEX spool_usage_print ON spool_usage(print_id);
  `,
  `
  -- Reduzierter Preis (Angebot), zählt für den Wert statt des Normalpreises
  ALTER TABLE spools ADD COLUMN price_sale REAL;
  `,
  `
  -- Druckprofil (Bambu-Studio-ID wie GFA01, geht als tray_info_idx ans AMS) und Werte vom Hersteller
  ALTER TABLE spools ADD COLUMN profile_id TEXT;
  ALTER TABLE spools ADD COLUMN nozzle_min INTEGER;
  ALTER TABLE spools ADD COLUMN nozzle_max INTEGER;
  ALTER TABLE spools ADD COLUMN bed_temp INTEGER;
  ALTER TABLE spools ADD COLUMN dry_temp INTEGER;
  ALTER TABLE spools ADD COLUMN dry_hours REAL;
  ALTER TABLE spools ADD COLUMN url TEXT NOT NULL DEFAULT '';

  -- Einstellungen (API-Key)
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  `
  -- RFID-Spule wegen 100 % auf eigener Zählung: folgt wieder dem AMS, sobald es weniger meldet (z. B. Chip neu eingelesen).
  -- Gewogen oder von Hand korrigiert setzt das zurück, dann bleibt es bei der eigenen Zählung.
  ALTER TABLE spools ADD COLUMN rfid_full INTEGER NOT NULL DEFAULT 0;
  UPDATE spools SET rfid_full = 1 WHERE rfid IS NOT NULL AND track = 'eigen'
    AND NOT EXISTS (SELECT 1 FROM spool_usage u WHERE u.spool_id = spools.id AND u.source IN ('manuell', 'waage'));
  `,
  `
  -- Farbkatalog je Hersteller (Sorten mit Farben), Seed aus server/seed/*.json, danach in der App gepflegt.
  -- match = Stichwort im Markennamen der Spule, code = Farbcode des Herstellers (Bambu: aus tray_id_name)
  CREATE TABLE catalog_brands (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, match TEXT NOT NULL, url TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
  );
  CREATE TABLE catalog_lines (
    id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES catalog_brands(id) ON DELETE CASCADE,
    material TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, profile_id TEXT, sort INTEGER NOT NULL DEFAULT 0,
    UNIQUE (brand_id, name)
  );
  CREATE TABLE catalog_colors (
    id INTEGER PRIMARY KEY, line_id INTEGER NOT NULL REFERENCES catalog_lines(id) ON DELETE CASCADE,
    name TEXT NOT NULL, hex TEXT, code TEXT, sort INTEGER NOT NULL DEFAULT 0, UNIQUE (line_id, name)
  );
  CREATE INDEX catalog_lines_brand ON catalog_lines (brand_id);
  CREATE INDEX catalog_colors_line ON catalog_colors (line_id);
  -- Seed-Marken, die schon einmal übernommen wurden (von Hand gelöschte kommen nicht wieder)
  CREATE TABLE catalog_seeded (name TEXT PRIMARY KEY, at TEXT NOT NULL);
  `,
  `
  -- Einstellungen je Bereich als JSON (server/settings.ts); alte Einzelschlüssel übernehmen
  INSERT INTO settings (key, value) SELECT 'import', json_object('api_key', value) FROM settings WHERE key = 'anthropic_api_key';
  INSERT INTO settings (key, value) SELECT 'filament', json_object('show_external', json('true')) FROM settings WHERE key = 'show_external' AND value = '1';
  DELETE FROM settings WHERE key IN ('anthropic_api_key', 'show_external');
  -- Bestehende Installationen mit Daten brauchen den Assistenten nicht
  INSERT INTO settings (key, value) SELECT 'setup', '{"done":true}'
    WHERE EXISTS (SELECT 1 FROM printers) OR EXISTS (SELECT 1 FROM models) OR EXISTS (SELECT 1 FROM spools);
  `,
];

const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
for (let v = version; v < migrations.length; v++) {
  db.exec("BEGIN");
  try {
    db.exec(migrations[v]!);
    db.exec(`PRAGMA user_version = ${v + 1}`);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();
