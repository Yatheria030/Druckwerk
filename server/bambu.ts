// Lokale Anbindung von Bambu-Lab-Druckern im LAN-Modus:
// MQTT über TLS (8883, Nutzer bblp, Passwort = Zugangscode) für Status und Befehle, FTPS (implizit, 990) für den Upload.
// Seit der Firmware mit „Authorization Control“ (2025) nimmt der Drucker Befehle von Fremdsoftware nur im
// LAN-Modus mit eingeschaltetem Entwicklermodus an. Status lesen geht auch ohne.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { Client as FtpClient } from "basic-ftp";
import { unzipSync } from "fflate";
import mqtt, { type MqttClient } from "mqtt";
import { autoProfile, profileById } from "../shared/profiles.ts";
import { amsBusy, DRY_BLOCK, FAN_LABEL, type AmsUnit, type ControlAction, type DeviceInfo, type PrinterLive, type PrintRequest, type Spool, type Tray } from "../shared/types.ts";
import { grabFrame } from "./camera.ts";
import { DATA_DIR, db, nowIso, PHOTO_DIR, TIMELAPSE_DIR } from "./db.ts";
import { absPath, baseName, fileRow, importLocal, parseSliceInfo } from "./files.ts";
import { optionCommand, readOptions, type Hold, type OptionInput } from "./options.ts";
import { saveParts } from "./parts.ts";
import { readPlug, type PlugReading } from "./plug.ts";
import { setting } from "./settings.ts";
import { checkHumidity, checkMaintenance, errorText, notifyDrying, notifyHms, notifyPrint, notifyQueue } from "./notify.ts";
import { bookPrint, leavingDue, slotMap, spoolAt, syncRfidRemain, syncTrays, trayLabel, type PlanItem, type TrayInfo, type TrayStart } from "./spools.ts";
import { createModel, printerRow, printerRows, type PrinterRow } from "./store.ts";

export class PrinterError extends Error {}

type Raw = Record<string, any>;
type Pending = { name: string; fileId: number; modelId: number; plate: number; filaments: { type: string; color: string }[]; plan: PlanItem[]; at: number };

const RUNNING = new Set(["PREPARE", "RUNNING", "PAUSE", "SLICING"]);
const CANCELED = 50348044; // print_error, wenn am Drucker oder per Befehl abgebrochen

const STAGES: Record<number, string> = {
  1: "Bett nivellieren", 2: "Heizbett vorheizen", 3: "Vibrationskompensation", 4: "Filament wechseln", 5: "M400-Pause",
  6: "Pause: Filament leer", 7: "Düse heizen", 8: "Extrusion kalibrieren", 9: "Bett scannen", 10: "Erste Schicht prüfen",
  11: "Druckplatte erkennen", 12: "Mikrolidar kalibrieren", 13: "Achsen referenzieren", 14: "Düse reinigen",
  15: "Extrusion prüfen", 16: "Pause durch Nutzer", 17: "Pause: Frontklappe", 18: "Mikrolidar kalibrieren",
  19: "Extrusionsfluss kalibrieren", 20: "Pause: Düsentemperatur", 21: "Pause: Betttemperatur",
};

const merge = (a: Raw, b: Raw): Raw => {
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) merge(a[k], v);
    else a[k] = v;
  }
  return a;
};

const hex = (c: unknown) => (typeof c === "string" && /^[0-9a-f]{6}/i.test(c) ? `#${c.slice(0, 6).toUpperCase()}` : "");
/** Temperaturen unter device.*: H2 packt das Ziel in die oberen 16 Bit */
const temp = (v: unknown) => {
  const x = n(v);
  return x == null ? null : x > 0xffff ? x & 0xffff : x;
};
/** Wanduhrzeit des Druckers ohne Zone (20261116025900, video_2026-11-16_06-21-22) als ms, als wäre sie UTC */
const wallClock = (s: string) => {
  const m = s.match(/(\d{4})-?(\d\d)-?(\d\d)[_ T-]?(\d\d)[-:]?(\d\d)[-:]?(\d\d)/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
};
const n = (v: unknown) => (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

class Connection {
  client: MqttClient | null = null;
  raw: Raw = {};
  connected = false;
  error: string | null = null;
  lastSeen: string | null = null;
  seq = 1;
  pending: Pending | null = null;
  waiters = new Map<string, (r: Raw) => void>();
  lastProgress = -1;
  holds = new Map<string, Hold>();
  /** Gesendeter Trocknungsbefehl je AMS, bis der Bericht ihn zeigt (der Drucker braucht 5–10 s), höchstens 60 s */
  dryPending = new Map<number, { stop: boolean; until: number }>();

  constructor(public row: PrinterRow) {}

  get reportTopic() {
    return `device/${this.row.serial}/report`;
  }

  plug: PlugReading | null = null;
  plugError: string | null = null;
  plugTimer: NodeJS.Timeout | null = null;

  /** Steckdose lesen (alle 30 s und zu Beginn und Ende eines Drucks); null, wenn keine eingetragen oder nicht erreichbar */
  async readPlug(): Promise<PlugReading | null> {
    if (!this.row.plug) {
      this.plug = null;
      this.plugError = null;
      return null;
    }
    try {
      this.plug = await readPlug(this.row.plug);
      this.plugError = null;
      return this.plug;
    } catch (e) {
      this.plugError = (e as Error).message;
      return null;
    }
  }

  /** Zählerstand am Druckstart merken bzw. am Ende den Verbrauch eintragen */
  async energy(printId: number, phase: "start" | "end") {
    if (!this.row.plug) return;
    const r = (await this.readPlug()) ?? (this.plug && Date.now() - this.plug.at < 120_000 ? this.plug : null);
    if (!r) return;
    if (phase === "start") db.prepare("UPDATE prints SET energy_start = ? WHERE id = ?").run(r.wh, printId);
    else db.prepare("UPDATE prints SET energy_wh = MAX(0, ? - energy_start) WHERE id = ? AND energy_start IS NOT NULL").run(r.wh, printId);
  }

  start() {
    this.plugTimer = setInterval(() => void this.readPlug(), 30_000);
    void this.readPlug();
    if (!this.row.access_code || !this.row.host || !this.row.serial) {
      this.error = "Zugangsdaten unvollständig";
      return;
    }
    this.client = mqtt.connect(`mqtts://${this.row.host}:8883`, {
      username: "bblp",
      password: this.row.access_code,
      rejectUnauthorized: false, // selbstsigniertes Zertifikat des Druckers
      reconnectPeriod: 15_000,
      connectTimeout: 10_000,
      clientId: `druckwerk-${this.row.id}-${Math.random().toString(16).slice(2, 8)}`,
    });
    this.client.on("connect", () => {
      this.connected = true;
      this.error = null;
      this.client!.subscribe(this.reportTopic);
      this.publish({ pushing: { command: "pushall", version: 1, push_target: 1 } });
      this.publish({ info: { command: "get_version" } });
    });
    this.client.on("message", (_t, payload) => {
      try {
        this.onReport(JSON.parse(payload.toString()) as Raw);
      } catch (e) {
        console.warn("Drucker-Nachricht unlesbar:", e);
      }
    });
    this.client.on("error", (e) => {
      const msg = String((e as Error).message ?? e);
      this.error = /not authorized|bad user|5$/i.test(msg) ? "Zugangscode falsch" : msg;
    });
    this.client.on("close", () => (this.connected = false));
    this.client.on("offline", () => {
      this.connected = false;
      this.error ??= "Drucker nicht erreichbar";
    });
  }

  stop() {
    if (this.plugTimer) clearInterval(this.plugTimer);
    this.plugTimer = null;
    this.client?.end(true);
    this.client = null;
    this.connected = false;
  }

  publish(msg: Raw): string {
    if (!this.client?.connected) throw new PrinterError("Drucker nicht verbunden");
    const seq = String(this.seq++);
    const key = Object.keys(msg)[0]!;
    this.client.publish(`device/${this.row.serial}/request`, JSON.stringify({ [key]: { sequence_id: seq, ...msg[key] } }));
    return seq;
  }

  /** Module mit Firmware-Version aus info.get_version (Hauptplatine, AMS, Werkzeugkopf …) */
  modules: Raw[] = [];
  versionAt = 0;
  versionWaiters: (() => void)[] = [];

  /** Befehl senden und auf die Antwort mit gleicher sequence_id warten (P1/A1 antworten mit result) */
  async command(msg: Raw, timeoutMs = 8000): Promise<void> {
    const seq = this.publish(msg);
    const reply = await new Promise<Raw | null>((res) => {
      const t = setTimeout(() => (this.waiters.delete(seq), res(null)), timeoutMs);
      this.waiters.set(seq, (r) => (clearTimeout(t), this.waiters.delete(seq), res(r)));
    });
    // „fail“ (ältere Firmware) oder „failed“ (P2S); „mqtt message verify failed“ = Authorization Control, Entwicklermodus aus
    if (reply && /^fail/i.test(String(reply.result ?? ""))) {
      const reason = String(reply.reason ?? reply.err_code ?? "");
      if (/verify/i.test(reason) || Number(reply.err_code) === 84033543)
        throw new PrinterError("Der Drucker nimmt diesen Befehl nur im Entwicklermodus an (ohne geht nur das Licht). Am Drucker LAN-Modus und Entwicklermodus einschalten.");
      // Sonst ein echter Ablehnungsgrund: Code wie in der Fehlerliste (0502_C010), Text aus hms.json, sofern Bambu ihn kennt
      const code = Number(reply.err_code);
      if (!(code > 0)) throw new PrinterError(`Der Drucker hat den Befehl abgelehnt${reason ? ` (${reason})` : ""}.`);
      const hex = code.toString(16).toUpperCase().padStart(8, "0");
      const text = await errorText(code);
      const drying = msg.print?.command === "ams_change_filament" && this.amsUnits(this.trays()).some((u) => u.drying_min != null);
      throw new PrinterError(
        `Der Drucker hat den Befehl abgelehnt: ${text ?? "Grund von Bambu nicht dokumentiert"} (${hex.slice(0, 4)}_${hex.slice(4)}).` +
          (drying ? " Ein AMS trocknet gerade über den Strom des Druckers, das ist vermutlich der Grund." : ""),
      );
    }
  }

  onReport(msg: Raw) {
    this.lastSeen = nowIso();
    for (const part of Object.values(msg)) {
      if (part && typeof part === "object" && part.sequence_id !== undefined && "result" in part) this.waiters.get(String(part.sequence_id))?.(part);
    }
    if (msg.print) {
      // Nur Statusberichte übernehmen, Antworten auf Befehle (project_file, pause …) tragen deren Parameter
      const { command, sequence_id: _s, msg: _m, ...rest } = msg.print as Raw;
      if (!command || command === "push_status") merge(this.raw, rest);
    }
    if (msg.info?.command === "get_version" && Array.isArray(msg.info.module)) {
      this.modules = msg.info.module as Raw[];
      this.versionAt = Date.now();
      for (const w of this.versionWaiters.splice(0)) w();
    }
    if (msg.system?.command === "ledctrl" && msg.system.led_node === "chamber_light") {
      this.raw.lights_report = [{ node: "chamber_light", mode: msg.system.led_mode }];
    }
    this.syncLibrary();
    this.track();
    if (msg.print && (!msg.print.command || msg.print.command === "push_status")) this.watch(msg.print as Raw);
  }

  /** Alle HMS-Meldungen des Berichts (auch ausgeblendete) */
  hmsAll() {
    return ((this.raw.hms ?? []) as Raw[]).map((h) => {
      const attr = Number(h.attr) >>> 0;
      const code = Number(h.code) >>> 0;
      const p = (x: number) => x.toString(16).toUpperCase().padStart(4, "0");
      return {
        code: `${p(attr >>> 16)}_${p(attr & 0xffff)}_${p(code >>> 16)}_${p(code & 0xffff)}`,
        severity: code >>> 16,
        at: this.realTime(String(h.ts_unix ?? "")),
      };
    });
  }
  /** Ausgeblendete HMS-Codes; der Drucker löscht HMS nur selbst, also bis die Meldung aus dem Bericht verschwindet (wie „Ignorieren“ in Bambu Studio) */
  hmsHidden = new Set<string>();

  /** Wanduhrzeit des Druckers → echte Zeit (ISO). Ohne gelernten Abstand wie bisher als Ortszeit des Servers gelesen */
  realTime(s: string): string | null {
    const w = wallClock(s);
    if (w == null) return null;
    const off = this.row.clock_offset;
    if (off != null) return new Date(w - off * 60_000).toISOString();
    const d = new Date(w);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).toISOString();
  }

  /**
   * Uhr des Druckers lernen: Seine Zeit stimmt (NTP), oft aber nicht die Zone (P2S ohne Handy-Kopplung: UTC+8). Ein Zeitstempel, der gerade
   * entstanden ist, gegen die echte Zeit gehalten, ergibt den Abstand in Viertelstunden. Jeder neue Beleg zählt, so folgt Druckwerk
   * auch einer später umgestellten Zone. `slack` = wie weit der Stempel vor bzw. nach `real` liegen darf (Minuten)
   */
  learnClock(stamp: string, real: number, slack: [number, number], why: string) {
    const w = wallClock(stamp);
    if (w == null) return;
    const off = Math.round((w - real) / 900_000) * 15;
    const rest = (w - real) / 60_000 - off;
    if (rest < slack[0] || rest > slack[1] || Math.abs(off) > 14 * 60) return;
    if (off === this.row.clock_offset) return;
    const zone = (m: number | null) => (m == null ? "unbekannt" : `UTC${m < 0 ? "−" : "+"}${Math.floor(Math.abs(m) / 60)}${m % 60 ? `:${String(Math.abs(m) % 60).padStart(2, "0")}` : ""}`);
    console.log(`Druckeruhr ${this.row.name}: ${zone(this.row.clock_offset)} → ${zone(off)} (${why})`);
    db.prepare("UPDATE printers SET clock_offset = ? WHERE id = ?").run(off, this.row.id);
    this.row.clock_offset = off;
  }

  /** Zeitraffer-Pfad der Kamera: entsteht beim Druckstart mit der Ortszeit des Druckers im Namen */
  clockFromTimelapse(part: Raw) {
    const p = part.device?.cam?.timelapse_path;
    if (typeof p !== "string" || !p || p === this.lastTimelapse) return;
    const first = this.lastTimelapse === null;
    this.lastTimelapse = p;
    if (!first) return this.learnClock(p, Date.now(), [-2, 3], "Zeitraffer beim Druckstart");
    // Beim Verbinden: gehört der Pfad zum letzten Druck, liegt er kurz nach dessen Start
    const last = db.prepare("SELECT started_at FROM prints WHERE printer_id = ? ORDER BY id DESC LIMIT 1").get(this.row.id) as { started_at: string } | undefined;
    if (last) this.learnClock(p, Date.parse(last.started_at), [-1, 8], "Zeitraffer des letzten Drucks");
  }
  lastTimelapse: string | null = null;

  hmsSeen: Set<string> | null = null;
  /** Meldeanlässe aus dem Bericht: neue HMS-Fehler, AMS-Feuchte */
  watch(part: Raw) {
    this.clockFromTimelapse(part);
    if (Array.isArray(part.hms)) {
      // Neue Meldung: ihr Stempel ist gerade entstanden
      if (this.hmsSeen)
        for (const h of part.hms as Raw[]) {
          const code = Number(h.code) >>> 0, attr = Number(h.attr) >>> 0;
          const p = (x: number) => x.toString(16).toUpperCase().padStart(4, "0");
          const key = `${p(attr >>> 16)}_${p(attr & 0xffff)}_${p(code >>> 16)}_${p(code & 0xffff)}`;
          if (!this.hmsSeen.has(key)) this.learnClock(String(h.ts_unix ?? ""), Date.now(), [-2, 1], `neue Meldung ${key}`);
        }
      const now = this.hmsAll();
      const codes = new Set(now.map((h) => h.code));
      for (const k of this.hmsHidden) if (!codes.has(k)) this.hmsHidden.delete(k);
      // Beim ersten Bericht nach dem Verbinden (pushall) nur merken, was schon ansteht
      if (this.hmsSeen) for (const h of now) if (!this.hmsSeen.has(h.code)) void notifyHms(this.row.name, h.code, h.severity);
      this.hmsSeen = codes;
    }
    if (part.ams?.ams) checkHumidity(this.row.id, this.row.name, this.amsUnits(this.trays()));
    this.autoDry();
  }

  /** Offene Trocknungs-Anlässe je AMS (Grund), Feuchte-Zustand je AMS */
  dryWant = new Map<number, string>();
  dryHumid = new Map<number, boolean>();

  /**
   * Automatische Trocknung (Einstellungen filament.auto_dry*): Anlass ist die Feuchte über der Schwelle. Gesendet wird je Anlass
   * einmal, nie während eines Drucks (ein trocknendes AMS 2 Pro liefert kein Filament, die P2S druckt dann ins Leere) und erst,
   * wenn das AMS frei ist; läuft schon eine Trocknung, entfällt der Anlass.
   */
  autoDry() {
    if (!setting<boolean>("filament", "auto_dry")) {
      this.dryWant.clear();
      return;
    }
    const state = String(this.raw.gcode_state ?? "");
    const printing = state === "PREPARE" || state === "RUNNING" || state === "PAUSE" || state === "SLICING";
    const units = this.amsUnits(this.trays()).filter((u) => u.can_dry);

    const limit = setting<number | null>("filament", "auto_dry_humidity");
    for (const u of units) {
      if (u.humidity == null) continue;
      const high = limit != null && u.humidity > limit;
      if (high && !this.dryHumid.get(u.id)) {
        this.dryHumid.set(u.id, true);
        this.dryWant.set(u.id, `Feuchte ${u.humidity} % (über ${limit} %)`);
      } else if (!high && (limit == null || u.humidity < limit - 5)) this.dryHumid.set(u.id, false);
    }

    // Anlässe bleiben stehen, bis der Druck vorbei ist
    if (!this.dryWant.size || printing || !state || amsBusy(this.raw.ams_status)) return;
    for (const [id, why] of [...this.dryWant]) {
      const u = units.find((x) => x.id === id);
      this.dryWant.delete(id);
      if (!u || u.dry_pending) continue;
      if (u.drying_min != null || (u.dry_status != null && u.dry_status > 0 && u.dry_status < 5)) {
        this.dryTries.delete(id);
        continue;
      }
      const blocked = u.dry_blocked.filter((r) => r !== 6);
      if (blocked.length) {
        notifyDrying(this.row.name, u.label, `${why}, aber ${blocked.map((r) => DRY_BLOCK[r] ?? `Grund ${r}`).join(" ")}`, false);
        continue;
      }
      // Empfindlichstes Filament im AMS bestimmt die Temperatur (Vorschlag vom Chip, sonst PLA 55 °C, Rest 65 °C)
      const temps = u.trays.filter((t) => t.type).map((t) => ({ type: t.type, temp: t.dry_temp ?? (t.type.toUpperCase().startsWith("PLA") ? 55 : 65) }));
      const pick = temps.sort((a, b) => a.temp - b.temp)[0] ?? { type: "PLA", temp: 55 };
      const temp = Math.min(u.dry_max, Math.max(45, pick.temp));
      const hours = setting<number>("filament", "auto_dry_hours") ?? 8;
      const tries = (this.dryTries.get(id) ?? 0) + 1;
      this.dryTries.set(id, tries);
      console.log(`Auto-Trocknen ${this.row.name} ${u.label}: ${why}, ${hours} h bei ${temp} °C (${pick.type}), Versuch ${tries}`);
      dryAms(this.row.id, u.id, { temp, hours, filament: pick.type, rotate: false })
        .then(() => this.dryCheck(id, why, `${why}: trocknet ${hours} h bei ${temp} °C (${pick.type}).`))
        .catch((e) => {
          this.dryTries.delete(id);
          console.log(`Auto-Trocknen ${this.row.name} ${u.label} abgelehnt: ${(e as Error).message}`);
          notifyDrying(this.row.name, u.label, `${why}, aber: ${(e as Error).message}`, false);
        });
    }
  }

  /** Versuche je AMS für den laufenden Anlass */
  dryTries = new Map<number, number>();
  /**
   * Der Drucker bestätigt den Befehl, setzt ihn aber erst nach Sekunden um und verwirft ihn manchmal still (etwa direkt nach dem
   * Verbinden). Deshalb nach 75 s nachsehen: läuft nichts, den Anlass erneut einreihen, nach drei Versuchen melden.
   */
  dryCheck(id: number, why: string, ok: string) {
    setTimeout(() => {
      const u = this.amsUnits(this.trays()).find((x) => x.id === id);
      if (!u) return this.dryTries.delete(id);
      const running = u.drying_min != null || (u.dry_status != null && u.dry_status > 0 && u.dry_status < 5);
      const tries = this.dryTries.get(id) ?? 0;
      if (running) {
        this.dryTries.delete(id);
        console.log(`Auto-Trocknen ${this.row.name} ${u.label}: läuft`);
        return notifyDrying(this.row.name, u.label, ok, true);
      }
      if (tries >= 3) {
        this.dryTries.delete(id);
        console.log(`Auto-Trocknen ${this.row.name} ${u.label}: nach ${tries} Versuchen nicht gestartet`);
        return notifyDrying(this.row.name, u.label, `${why}, aber der Drucker hat die Trocknung nach ${tries} Versuchen nicht gestartet.`, false);
      }
      if (setting<boolean>("filament", "auto_dry")) {
        this.dryWant.set(id, why);
        this.autoDry();
      }
    }, 75_000);
  }

  traySig = "";
  lastActive: number | null = null;
  /** Bibliothek nachziehen, wenn sich in den Fächern etwas geändert hat (Spule eingelegt, getauscht, leer) */
  syncLibrary() {
    if (!this.raw.ams) return;
    const act = this.activeTray();
    if (act !== this.lastActive) {
      // Rohwerte mitschreiben: Welches Feld welches Fach meldet, lässt sich sonst im Nachhinein nicht klären
      const ext = this.raw.device?.extruder as Raw | undefined;
      const snow = ((ext?.info as Raw[] | undefined) ?? []).map((e) => e.snow).join(",");
      if (this.lastActive != null || act !== 255)
        console.log(`${this.row.name}: aktives Fach ${act === 255 ? "keins" : trayLabel(act)} (snow ${snow || "–"}, tray_now ${this.raw.ams.tray_now}, Zustand ${this.raw.gcode_state})`);
      this.lastActive = act;
    }
    const trays = this.rawTrays();
    // Während eines Drucks fällt der Restwert laufend: dann nur neue Spulen übernehmen, der Rest nach der Druckbuchung am Ende
    const printing = RUNNING.has(String(this.raw.gcode_state));
    const sig = trays.map((t) => `${t.id}:${t.uuid}:${t.type}:${+t.loaded}:${printing ? t.remain != null : t.remain}`).join("|") + (printing ? "|druckt" : "");
    if (sig === this.traySig && !leavingDue(this.row.id)) return;
    this.traySig = sig;
    try {
      syncTrays(this.row.id, trays, printing);
      syncRfidRemain(trays, printing);
    } catch (e) {
      console.warn("Spulen-Abgleich fehlgeschlagen:", (e as Error).message);
    }
  }

  /** Fächer mit allen Rohwerten (RFID, Gewicht) für Bibliothek und Verbrauch */
  rawTrays(): TrayInfo[] {
    const out: TrayInfo[] = [];
    // Bit je Fach (AMS × 4 + Fach): steckt eine Spule bzw. wird ihr Chip gerade gelesen. Fehlen die Bits, zählt nur das Material
    const bits = (k: string) => {
      const v = String(this.raw.ams?.[k] ?? "");
      return /^[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : null;
    };
    const exist = bits("tray_exist_bits");
    const reading = bits("tray_reading_bits");
    const bit = (mask: number | null, id: number) => mask != null && id < 31 && ((mask >>> id) & 1) === 1;
    const info = (id: number, t: Raw): TrayInfo => {
      const uuid = String(t.tray_uuid ?? "");
      const remain = n(t.remain);
      const type = String(t.tray_type ?? "");
      // Leeres Fach (z. B. vir_slot des P2S) meldet Farbe 00000000 ohne Material
      const color = type || !/^0*$/.test(String(t.tray_color ?? "")) ? hex(t.tray_color) : "";
      return {
        id,
        uuid: /^0*$/.test(uuid) ? "" : uuid,
        type,
        name: String(t.tray_sub_brands ?? ""),
        color,
        weight: n(t.tray_weight),
        remain: remain != null && remain >= 0 ? remain : null,
        loaded: type !== "" || color !== "" || (id !== 254 && bit(exist, id)),
        reading: id !== 254 && bit(reading, id),
        profile: String(t.tray_info_idx ?? ""),
        code: /^0*$/.test(uuid) ? "" : (String(t.tray_id_name ?? "").split("-")[1] ?? ""),
        dry_temp: Number(t.drying_temp) > 0 ? Number(t.drying_temp) : null,
        dry_hours: Number(t.drying_time) > 0 ? Number(t.drying_time) : null,
      };
    };
    for (const unit of (this.raw.ams?.ams ?? []) as Raw[]) {
      for (const t of (unit.tray ?? []) as Raw[]) out.push(info(Number(unit.id) * 4 + Number(t.id), t));
    }
    const ext = this.external();
    if (ext) out.push(info(254, ext));
    return out;
  }

  /** Externe Spule: vt_tray (P1, X1, A1, P2S) oder vir_slot (H2) */
  external(): Raw | undefined {
    return (this.raw.vt_tray as Raw | undefined) ?? ((this.raw.vir_slot as Raw[] | undefined)?.[0] as Raw | undefined);
  }

  /** Aktives Fach als AMS×4+Fach bzw. 254 extern. P2S/H2 melden in tray_now nur das Fach innerhalb des AMS,
   *  das ganze steht in device.extruder.info[].snow (AMS×256+Fach wie mapping, 0xFE00 extern, 0xFF.. leer) */
  activeTray(): number {
    const ext = (this.raw.device?.extruder?.info as Raw[] | undefined) ?? [];
    const cur = ext.find((e) => Number(e.id) === ((Number(this.raw.device?.extruder?.state ?? 0) >> 4) & 0xf)) ?? ext[0];
    const s = Number(cur?.snow);
    if (Number.isInteger(s) && s >= 0) {
      const ams = s >> 8;
      if (ams === 0xff) return 255;
      if (ams === 0xfe) return 254;
      return ams * 4 + (s & 0xff);
    }
    return Number(this.raw.ams?.tray_now ?? 255);
  }

  trays(): Tray[] {
    const now = this.activeTray();
    const slots = slotMap(this.row.id);
    return this.rawTrays().map((t) => ({
      id: t.id,
      label: trayLabel(t.id),
      type: t.type,
      color: t.color,
      remain: t.remain,
      active: t.id === now && (t.type !== "" || t.color !== ""),
      name: t.name,
      rfid: !!t.uuid,
      spool_id: slots.get(t.id) ?? null,
      loaded: t.loaded,
      reading: t.reading,
      profile: t.profile,
      dry_temp: t.dry_temp,
      dry_hours: t.dry_hours,
    }));
  }

  amsUnits(trays: Tray[]): AmsUnit[] {
    const lite = this.row.model === "A1" || this.row.model === "A1M";
    return ((this.raw.ams?.ams ?? []) as Raw[]).map((u) => {
      const a = Number(u.id);
      const own = trays.filter((t) => t.id >> 2 === a && t.id !== 254);
      const humidity = n(u.humidity_raw);
      const dry = n(u.dry_time);
      const info = String(u.info ?? "");
      const drySt = /^[0-9a-f]+$/i.test(info) ? (parseInt(info, 16) >>> 4) & 0xf : null;
      const running = (dry != null && dry > 0) || (drySt != null && drySt > 0 && drySt < 5);
      const want = this.dryPending.get(a);
      if (want && (want.stop !== running || Date.now() > want.until)) this.dryPending.delete(a);
      const pend = this.dryPending.get(a);
      return {
        id: a,
        label: a >= 128 ? `AMS HT ${a - 127}` : `AMS ${"ABCDEFGH"[a] ?? a + 1}`,
        kind: lite ? "AMS lite" : own.length === 1 ? "AMS HT" : humidity != null ? "AMS 2 Pro" : "AMS",
        humidity,
        humidity_level: n(u.humidity),
        temp: n(u.temp) || null,
        drying_min: dry && dry > 0 ? dry : null,
        trays: own,
        can_dry: !lite && humidity != null && this.fun2(5),
        dry_max: a >= 128 ? 85 : 65,
        dry_status: drySt,
        dry_pending: pend ? (pend.stop ? "stop" : "start") : null,
        dry_blocked: Array.isArray(u.dry_sf_reason) ? (u.dry_sf_reason as unknown[]).map(Number).filter(Number.isInteger) : [],
      };
    });
  }

  live(): PrinterLive {
    const r = this.raw;
    const stage = n(r.stg_cur);
    const light = (r.lights_report as Raw[] | undefined)?.find((l) => l.node === "chamber_light");
    const open = openPrint(this.row.id);
    const trays = this.trays();
    return {
      id: this.row.id,
      connected: this.connected,
      error: this.connected ? null : this.error,
      last_seen: this.lastSeen,
      state: this.connected ? String(r.gcode_state ?? "IDLE") : "OFFLINE",
      stage: stage != null && stage > 0 && stage < 255 ? (STAGES[stage] ?? `Schritt ${stage}`) : null,
      job: r.subtask_name ? String(r.subtask_name) : null,
      percent: n(r.mc_percent),
      remaining_min: n(r.mc_remaining_time),
      layer: n(r.layer_num),
      total_layers: n(r.total_layer_num),
      nozzle: n(r.nozzle_temper) ?? temp(r.device?.extruder?.info?.[0]?.temp),
      nozzle_target: n(r.nozzle_target_temper),
      bed: n(r.bed_temper) ?? temp(r.device?.bed?.info?.temp),
      bed_target: n(r.bed_target_temper),
      // P2S/H2 melden die Kammer nur unter device.ctc
      chamber: n(r.chamber_temper) ?? temp(r.device?.ctc?.info?.temp),
      speed: n(r.spd_lvl),
      light: light ? light.mode === "on" : null,
      wifi: r.wifi_signal ? String(r.wifi_signal) : null,
      // X1/H2/P2: rtsp_url ist "disable", solange LAN-Liveview am Drucker aus ist
      liveview: typeof r.ipcam?.rtsp_url === "string" ? r.ipcam.rtsp_url !== "disable" : null,
      trays,
      ams: this.amsUnits(trays),
      external: trays.find((t) => t.id === 254) ?? null,
      // Der Code bleibt nach einem Abbruch stehen, bis der nächste Druck startet: nur bei echtem Fehlerzustand zeigen
      print_error: r.gcode_state === "FAILED" && n(r.print_error) !== CANCELED ? n(r.print_error) || null : null,
      hms: this.hmsAll().filter((h) => !this.hmsHidden.has(h.code)),
      clock_offset: this.row.clock_offset,
      current_print_id: open?.id ?? null,
      power_w: this.plug && Date.now() - this.plug.at < 90_000 ? this.plug.w : null,
      plug_error: this.row.plug ? this.plugError : null,
      fans: this.fans(),
      airduct: this.airduct(),
      sdcard: typeof r.sdcard === "boolean" ? r.sdcard : null,
      skipped: Array.isArray(r.s_obj) ? (r.s_obj as unknown[]).map(Number).filter(Number.isInteger) : [],
      options: this.connected ? readOptions(r, this.holds) : [],
      ams_busy: amsBusy(r.ams_status),
      loaded_tray: trays.find((t) => t.active)?.id ?? null,
      cali_auto: isModern(this.row.model, this.row.serial),
    };
  }

  /** Neues Lüfter-Protokoll (P2S/H2): device.airduct.parts, ID in Bit 4–11, Drehzahl in % */
  get airductRaw(): Raw | null {
    const a = this.raw.device?.airduct;
    return a && typeof a === "object" ? a : null;
  }

  fans(): PrinterLive["fans"] {
    const a = this.airductRaw;
    if (a && Array.isArray(a.parts))
      return (a.parts as Raw[])
        .filter((p) => (Number(p.id) & 0xf) === 0)
        .map((p) => {
          const id = (Number(p.id) >> 4) & 0xff;
          const speed = Math.min(100, Number(p.state) & 0xff);
          const target = p.tar_state != null ? Math.min(100, Number(p.tar_state) & 0xff) : speed;
          return { id, label: FAN_LABEL[id] ?? `Lüfter ${id}`, speed, target };
        });
    const old: [number, unknown][] = [
      [1, this.raw.cooling_fan_speed],
      [2, this.raw.big_fan1_speed],
      [3, this.raw.big_fan2_speed],
    ];
    return old.filter(([, v]) => n(v) != null).map(([id, v]) => {
      const speed = Math.round(((n(v) ?? 0) / 15) * 100);
      return { id, label: FAN_LABEL[id]!, speed, target: speed };
    });
  }

  airduct(): PrinterLive["airduct"] {
    const a = this.airductRaw;
    if (!a || !Array.isArray(a.modeList)) return null;
    // Abluft (2) blendet Bambu Studio aus
    const modes = (a.modeList as Raw[]).map((m) => Number(m.modeId)).filter((m) => Number.isInteger(m) && m !== 2);
    return modes.length ? { mode: Number(a.modeCur ?? 0), modes } : null;
  }

  /** Funktionsbit aus `fun2` (Hex, beliebig lang) */
  fun2(bit: number): boolean {
    const v = String(this.raw.fun2 ?? "");
    return /^[0-9a-f]+$/i.test(v) && ((BigInt(`0x${v}`) >> BigInt(bit)) & 1n) === 1n;
  }

  /** Rohdaten eines Fachs (AMS × 4 + Fach, 254 extern) */
  trayRaw(id: number): Raw | undefined {
    if (id === 254) return this.external();
    const unit = ((this.raw.ams?.ams ?? []) as Raw[]).find((u) => Number(u.id) === id >> 2);
    return ((unit?.tray ?? []) as Raw[]).find((t) => Number(t.id) === (id & 3));
  }

  /** Funktionsbit aus `fun` (Hex, 64 Bit) */
  fun(bit: number): boolean {
    try {
      return ((BigInt(`0x${String(this.raw.fun ?? "0")}`) >> BigInt(bit)) & 1n) === 1n;
    } catch {
      return false;
    }
  }

  seen: number[] = [];
  seenFor = 0;

  /** Druckhistorie aus den Zustandswechseln */
  track(): void {
    const state = this.raw.gcode_state as string | undefined;
    if (!state) return;
    const name = String(this.raw.subtask_name ?? "");
    const open = openPrint(this.row.id);
    const running = RUNNING.has(state);
    const percent = n(this.raw.mc_percent) ?? 0;

    if (open && running && name && open.name && name !== open.name) {
      this.close(open, "abgebrochen");
      return this.track();
    }
    if (running && !open && name) {
      const p = this.pending && this.pending.name === name.replace(/\.gcode(\.3mf)?$/, "") && Date.now() - this.pending.at < 30 * 60_000 ? this.pending : null;
      const match = p ? null : guessFile(name);
      const trays = this.trays();
      const active = trays.find((t) => t.active);
      // Platte eines fremden Drucks: gcode_file nennt Metadata/plate_N.gcode
      const plateNo = p?.plate ?? (Number(String(this.raw.gcode_file ?? "").match(/plate_(\d+)\.gcode/)?.[1] ?? 0) || null);
      const plan = p?.plan ?? (match ? planFromMeta(match.meta, plateNo ?? 1, this.jobMapping()) : []);
      const start: TrayStart = {};
      for (const t of this.rawTrays()) if (t.uuid && t.remain != null) start[t.id] = { uuid: t.uuid, remain: t.remain, weight: t.weight || setting<number>("filament", "net_g") };
      this.seen = active ? [active.id] : [];
      const r = db
        .prepare("INSERT INTO prints (printer_id, model_id, file_id, name, plate, filaments, progress, plan, tray_start, trays_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          this.row.id,
          p?.modelId ?? match?.model_id ?? null,
          p?.fileId ?? match?.id ?? null,
          name,
          plateNo,
          JSON.stringify(p?.filaments ?? (active ? [{ type: active.type, color: active.color }] : [])),
          percent,
          JSON.stringify(plan),
          JSON.stringify(start),
          JSON.stringify(this.seen),
        );
      this.pending = null;
      this.lastProgress = percent;
      const id = Number(r.lastInsertRowid);
      this.seenFor = id;
      console.log(`Druck ${id} auf ${this.row.name} gestartet: ${name}`);
      void this.energy(id, "start");
      // Fremder Druck (Bambu Studio, Handy): Datei von der SD-Karte für Filamentbedarf und Archiv
      const archive = !p && !match && setting<boolean>("archiv", "auto");
      // ohne Datei in der Bibliothek auch für „Objekte überspringen“
      const fileId = p?.fileId ?? match?.id ?? null;
      if (!plan.length || archive || !fileId) void this.fetchJob(id, name, plateNo, { plan: !plan.length, archive });
      return;
    }
    if (open && running) {
      if (this.seenFor !== open.id) {
        // Nach einem Neustart des Servers: bisher gesehene Fächer aus der Datenbank
        this.seenFor = open.id;
        const r = db.prepare("SELECT trays_seen FROM prints WHERE id = ?").get(open.id) as { trays_seen: string } | undefined;
        this.seen = r ? (JSON.parse(r.trays_seen) as number[]) : [];
      }
      const active = this.trays().find((t) => t.active);
      if (active && !this.seen.includes(active.id)) {
        this.seen.push(active.id);
        db.prepare("UPDATE prints SET trays_seen = ? WHERE id = ?").run(JSON.stringify(this.seen), open.id);
      }
      if (percent !== this.lastProgress) {
        this.lastProgress = percent;
        db.prepare("UPDATE prints SET progress = ? WHERE id = ?").run(percent, open.id);
      }
      return;
    }
    if (open && !running) {
      const err = n(this.raw.print_error);
      const status =
        state === "FINISH" ? "fertig" : state === "FAILED" ? (err === CANCELED ? "abgebrochen" : "fehler") : open.progress >= 100 ? "fertig" : "abgebrochen";
      this.close(open, status, state === "FAILED" && err !== CANCELED ? err : null);
      // Erst Foto, dann Meldung (mit Foto als Anhang)
      void this.photo(open.id).then(() => (notifyPrint(open.id, this.row.name), notifyQueue(this.row.id, this.row.name)));
      this.timelapseLater(open.id);
      checkMaintenance();
    }
  }

  close(open: { id: number; progress: number }, status: string, err: number | null = null) {
    closePrint(open.id, status, err);
    void this.energy(open.id, "end");
    if (status === "fertig") db.prepare("UPDATE prints SET progress = 100 WHERE id = ?").run(open.id);
    const trays = this.rawTrays();
    try {
      bookPrint(open.id, this.row.id, status === "fertig", Math.max(open.progress, this.lastProgress), trays);
      // Spulen im RFID-Modus danach auf den Restwert ziehen (Druckbuchung + Abgleich = Restwert)
      syncRfidRemain(trays);
    } catch (e) {
      console.warn(`Verbrauch für Druck ${open.id} nicht gebucht:`, (e as Error).message);
    }
    this.seen = [];
  }

  /**
   * Fach-Zuordnung des laufenden Drucks aus dem Bericht (`mapping`, auch bei Drucken aus Bambu Studio oder der Cloud):
   * Index = Filament-ID − 1, Wert = Fach (AMS × 4 + Fach, 254 extern). P2S kodiert AMS × 256 + Fach: 0xFE00 extern,
   * 0xFF00/0xFFFF unbenutzt (so bei Kalibrierdrucken)
   */
  jobMapping(): { useAms: boolean; map: number[]; printerId: number } | null {
    const m = this.raw.mapping;
    if (!Array.isArray(m) || !m.length) return null;
    const map = m.map((v) => {
      const x = Number(v);
      if (!Number.isInteger(x) || x < 0 || x === 255) return -1;
      if (x < 255) return x;
      const ams = x >> 8;
      const slot = x & 0xff;
      return ams === 0xff ? -1 : ams === 0xfe ? 254 : slot < 4 ? ams * 4 + slot : -1;
    });
    return map.some((x) => x >= 0) ? { useAms: true, map, printerId: this.row.id } : null;
  }

  /**
   * Druck aus Bambu Studio oder der Cloud: die .gcode.3mf liegt auf der SD-Karte (Wurzel oder /cache). Daraus
   * slice_info.config lesen (Verbrauch je Filament) und die Datei auf Wunsch ins Archiv übernehmen (Modell in der
   * Bibliothek, gleiche Datei per sha256 nur einmal), damit „Nochmal drucken“ geht
   */
  async fetchJob(printId: number, name: string, plate: number | null, want: { plan: boolean; archive: boolean }) {
    const ftp = new FtpClient(30_000);
    const tmp = path.join(DATA_DIR, `plan-${printId}.3mf`);
    try {
      await ftp.access({ host: this.row.host, port: 990, user: "bblp", password: this.row.access_code, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
      const job = name.toLowerCase().replace(/\.gcode\.3mf$|\.3mf$/, "");
      for (const dir of ["/", "/cache"]) {
        const list = await ftp.list(dir).catch(() => []);
        const f = list.find((x) => x.isFile && x.name.toLowerCase().replace(/\.gcode\.3mf$|\.3mf$/, "") === job && /\.3mf$/i.test(x.name));
        if (!f) continue;
        if (f.size > 300 * 1024 ** 2) return;
        await ftp.downloadTo(tmp, `${dir === "/" ? "" : dir}/${f.name}`);
        ftp.close();
        await saveParts(printId, await readFile(tmp), plate ?? 1).catch((e) => console.warn(`Objekte von Druck ${printId}:`, (e as Error).message));
        if (want.plan) {
          const out = unzipSync(await readFile(tmp), { filter: (e) => e.name === "Metadata/slice_info.config" });
          const xml = out["Metadata/slice_info.config"];
          const plates = xml ? parseSliceInfo(new TextDecoder().decode(xml)) : [];
          const plan = planFromMeta({ plates }, plate ?? plates[0]?.index ?? 1, this.jobMapping());
          if (plan.length) {
            db.prepare("UPDATE prints SET plan = ? WHERE id = ? AND plan = '[]'").run(JSON.stringify(plan), printId);
            console.log(`Druck ${printId}: Filamentbedarf aus ${f.name} gelesen`);
            // Kurzer Druck, schon vorbei, bevor die Datei da war: jetzt buchen
            const done = db.prepare("SELECT status, progress FROM prints WHERE id = ?").get(printId) as { status: string; progress: number } | undefined;
            if (done && done.status !== "laeuft") {
              const trays = this.rawTrays();
              bookPrint(printId, this.row.id, done.status === "fertig", done.progress, trays);
              syncRfidRemain(trays);
            }
          }
        }
        if (want.archive) {
          const file = await importLocal(
            () => createModel({ name: baseName(name) || baseName(f.name), description: `Aus einem Druck auf ${this.row.name} archiviert.`, tags: ["Archiv"] }),
            /\.gcode\.3mf$/i.test(f.name) ? f.name : f.name.replace(/\.3mf$/i, ".gcode.3mf"),
            tmp,
          );
          db.prepare("UPDATE prints SET file_id = ?, model_id = ? WHERE id = ? AND file_id IS NULL").run(file.id, file.model_id, printId);
          console.log(`Druck ${printId}: ${f.name} ${file.existed ? `ist schon Datei ${file.id}` : `archiviert als Datei ${file.id} (Modell ${file.model_id})`}`);
        }
        return;
      }
    } catch (e) {
      console.warn(`Datei für Druck ${printId} nicht lesbar:`, (e as Error).message);
    } finally {
      ftp.close();
      await rm(tmp, { force: true });
    }
  }

  /** Zeitraffer nach dem Druck holen: der Drucker schreibt ihn erst nach dem Ende, also mehrmals versuchen */
  timelapseLater(printId: number, attempt = 0) {
    const delays = [60_000, 180_000, 600_000];
    if (attempt >= delays.length || !setting<boolean>("archiv", "timelapse")) return;
    setTimeout(() => {
      this.fetchTimelapse(printId)
        .catch((e) => (console.warn(`Zeitraffer für Druck ${printId}:`, (e as Error).message), false))
        .then((ok) => ok || this.timelapseLater(printId, attempt + 1));
    }, delays[attempt]).unref();
  }

  /** Neuestes noch nicht zugeordnetes Video aus /timelapse, das nach dem Druckstart entstand; AVI wird zu MP4 (wenn ffmpeg da ist) */
  async fetchTimelapse(printId: number): Promise<boolean> {
    const p = db.prepare("SELECT started_at, timelapse FROM prints WHERE id = ?").get(printId) as { started_at: string; timelapse: string | null } | undefined;
    if (!p || p.timelapse) return true;
    const used = new Set(
      (db.prepare("SELECT timelapse_src FROM prints WHERE printer_id = ? AND timelapse_src IS NOT NULL").all(this.row.id) as { timelapse_src: string }[]).map((r) => r.timelapse_src),
    );
    const since = Date.parse(p.started_at) - 10 * 60_000;
    // Ein Video, das nach dem Start des nächsten Drucks entstand, gehört zu dem
    const next = db.prepare("SELECT started_at FROM prints WHERE printer_id = ? AND id > ? ORDER BY id LIMIT 1").get(this.row.id, printId) as { started_at: string } | undefined;
    const until = next ? Date.parse(next.started_at) : Infinity;
    const ftp = new FtpClient(60_000);
    try {
      await ftp.access({ host: this.row.host, port: 990, user: "bblp", password: this.row.access_code, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
      const list = (await ftp.list("/timelapse").catch(() => [])).filter((f) => f.isFile && f.size > 0 && /\.(mp4|avi)$/i.test(f.name) && !used.has(f.name));
      // Zeit aus MDTM, sonst aus dem Namen (video_2026-11-13_22-01-05.mp4, Ortszeit des Druckers: mit gelerntem Abstand genau, sonst großzügig)
      const cands: { name: string; size: number; t: number }[] = [];
      for (const f of list) {
        const md = await ftp.lastMod(`/timelapse/${f.name}`).catch(() => null);
        const wall = wallClock(f.name);
        const off = this.row.clock_offset;
        const byName = wall == null ? null : off == null ? wall : wall - off * 60_000;
        const ok = (t: number) => t >= since && t < until;
        if (md ? ok(md.getTime()) : byName != null && (off != null ? ok(byName) : byName >= since - 14 * 3600_000))
          cands.push({ name: f.name, size: f.size, t: md?.getTime() ?? byName! });
      }
      const v = cands.sort((a, b) => b.t - a.t)[0];
      if (!v) return false;
      // Noch in Arbeit? Größe muss stehen
      await new Promise((r) => setTimeout(r, 8_000));
      const again = (await ftp.list("/timelapse")).find((f) => f.name === v.name);
      if (!again || again.size !== v.size) return false;
      const ext = v.name.toLowerCase().endsWith(".avi") ? "avi" : "mp4";
      const part = path.join(TIMELAPSE_DIR, `${printId}.${ext}.part`);
      await ftp.downloadTo(part, `/timelapse/${v.name}`);
      ftp.close();
      let final = ext;
      if (ext === "avi" && (await toMp4(part, path.join(TIMELAPSE_DIR, `${printId}.mp4`)))) {
        await rm(part, { force: true });
        final = "mp4";
      } else await rename(part, path.join(TIMELAPSE_DIR, `${printId}.${ext}`));
      db.prepare("UPDATE prints SET timelapse = ?, timelapse_src = ? WHERE id = ?").run(final, v.name, printId);
      console.log(`Druck ${printId}: Zeitraffer ${v.name} geholt`);
      return true;
    } finally {
      ftp.close();
    }
  }

  /** Foto der Druckplatte am Ende des Drucks (nur Drucker mit Kamera) */
  async photo(printId: number) {
    try {
      const jpg = await grabFrame(this.row, 15_000);
      if (!jpg) return;
      await writeFile(path.join(PHOTO_DIR, `${printId}.jpg`), jpg);
      db.prepare("UPDATE prints SET has_photo = 1 WHERE id = ?").run(printId);
    } catch (e) {
      console.warn(`Foto für Druck ${printId} fehlgeschlagen:`, (e as Error).message);
    }
  }
}

/** AVI (A1/P1) in MP4 umwandeln, damit Browser und iPhone es abspielen; false, wenn ffmpeg fehlt oder scheitert */
function toMp4(src: string, dst: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", dst]);
    p.on("error", () => resolve(false));
    p.on("exit", (code) => {
      if (code !== 0) void rm(dst, { force: true });
      resolve(code === 0);
    });
  });
}

/** Verbrauchsplan aus den Platten-Metadaten; mapping = ams_mapping des Starts (null = unbekannt, später zuordnen) */
function planFromMeta(meta: unknown, plate: number, mapping: { useAms: boolean; map: number[]; printerId: number } | null): PlanItem[] {
  const m = (typeof meta === "string" ? JSON.parse(meta) : meta) as { plates?: { index: number; filaments: { id: number; type: string; color: string; used_g: number | null }[] }[] };
  const pl = m.plates?.find((x) => x.index === plate);
  if (!pl) return [];
  return pl.filaments
    .filter((f) => (f.used_g ?? 0) > 0)
    .map((f) => {
      const tray = mapping ? (mapping.useAms ? (mapping.map[f.id - 1] ?? -1) : 254) : null;
      const t = tray != null && tray >= 0 ? tray : null;
      return { tray: t, spool_id: t != null && mapping ? spoolAt(mapping.printerId, t) : null, type: f.type, color: f.color, grams: f.used_g ?? 0 };
    });
}

const openPrint = (printerId: number) =>
  db.prepare("SELECT id, name, progress FROM prints WHERE printer_id = ? AND status = 'laeuft' ORDER BY id DESC LIMIT 1").get(printerId) as
    | { id: number; name: string; progress: number }
    | undefined;

const closePrint = (id: number, status: string, errorCode: number | null = null) =>
  db.prepare("UPDATE prints SET status = ?, ended_at = ?, error_code = ? WHERE id = ?").run(status, nowIso(), errorCode, id);

/** Druck, der nicht aus der App kam: Datei mit gleichem Namen suchen */
function guessFile(job: string) {
  const want = job.toLowerCase().replace(/\.gcode\.3mf$|\.3mf$/, "");
  const rows = db.prepare("SELECT id, model_id, name, meta FROM files WHERE kind = 'gcode3mf' ORDER BY id DESC").all() as { id: number; model_id: number; name: string; meta: string }[];
  return rows.find((r) => baseName(r.name).toLowerCase() === want || ftpName(r.name).replace(/\.gcode\.3mf$/, "").toLowerCase() === want);
}

const conns = new Map<number, Connection>();

/** Verbindungen an die Druckerliste anpassen (nach Start und jeder Änderung) */
export function syncPrinters() {
  const rows = printerRows();
  for (const [id, c] of conns) {
    const r = rows.find((x) => x.id === id);
    if (!r || r.host !== c.row.host || r.serial !== c.row.serial || r.access_code !== c.row.access_code) {
      c.stop();
      conns.delete(id);
    } else {
      const plugChanged = r.plug !== c.row.plug;
      c.row = r;
      if (plugChanged) void c.readPlug();
    }
  }
  for (const r of rows) {
    if (conns.has(r.id)) continue;
    const c = new Connection(r);
    conns.set(r.id, c);
    c.start();
  }
}

/** Drucker aus BAMBU_HOST/BAMBU_SERIAL/BAMBU_ACCESS_CODE übernehmen, wenn es ihn noch nicht gibt */
export function printerFromEnv() {
  const { BAMBU_HOST: host, BAMBU_SERIAL: serial, BAMBU_ACCESS_CODE: code, BAMBU_MODEL: model, BAMBU_NAME: name } = process.env;
  if (!host || !serial || !code) return;
  if (db.prepare("SELECT 1 FROM printers WHERE serial = ?").get(serial)) return;
  db.prepare("INSERT INTO printers (name, host, serial, access_code, model) VALUES (?, ?, ?, ?, ?)").run(name || "Drucker", host, serial, code, model || "P2S");
}

const conn = (id: number) => {
  const c = conns.get(id);
  if (!c) throw new PrinterError("Drucker nicht gefunden");
  return c;
};

export const liveAll = (): PrinterLive[] => [...conns.values()].map((c) => c.live());
export const live = (id: number) => conn(id).live();
/** Düsendurchmesser laut Bericht („0.4“), null = unbekannt */
export const nozzleOf = (id: number) => {
  const r = conns.get(id)?.raw;
  const d = Number(r?.nozzle_diameter ?? (r?.device?.nozzle?.info as Raw[] | undefined)?.[0]?.diameter);
  return d > 0 ? String(d) : null;
};

/** Zugangsdaten prüfen, bevor sie gespeichert werden: Verbindung und erster Statusbericht */
export function testConnection(host: string, serial: string, code: string): Promise<void> {
  return new Promise((res, rej) => {
    const c = mqtt.connect(`mqtts://${host}:8883`, {
      username: "bblp", password: code, rejectUnauthorized: false, reconnectPeriod: 0, connectTimeout: 8000,
      clientId: `druckwerk-test-${Math.random().toString(16).slice(2, 8)}`,
    });
    const done = (e?: string) => {
      clearTimeout(t);
      c.end(true);
      e ? rej(new PrinterError(e)) : res();
    };
    const t = setTimeout(() => done(c.connected ? "Verbunden, aber keine Antwort: Seriennummer prüfen" : `Drucker unter ${host} nicht erreichbar`), 12_000);
    c.on("connect", () => {
      c.subscribe(`device/${serial}/report`);
      c.publish(`device/${serial}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall", version: 1, push_target: 1 } }));
    });
    c.on("message", () => done());
    c.on("error", (e) => done(/not authorized|bad user/i.test(e.message) ? "Zugangscode falsch" : e.message));
  });
}

/** Achse bewegen bzw. Extruder vor/zurück wie die Steuerung in Bambu Studio (relativ, Softlimits an) */
export async function move(id: number, axis: "X" | "Y" | "Z" | "E" | "home", dist = 0) {
  const c = conn(id);
  const state = String(c.raw.gcode_state);
  const gcode = (line: string) => c.command({ print: { command: "gcode_line", param: line } });
  if (axis === "E") {
    if (RUNNING.has(state) && state !== "PAUSE") throw new PrinterError("Während des Drucks geht das nicht");
    if ((c.live().nozzle ?? 0) < 170) throw new PrinterError("Die Düse muss mindestens 170 °C haben");
    if (!dist || Math.abs(dist) > 50) throw new PrinterError("Extruder: höchstens 50 mm");
    return gcode(`M83 \nG0 E${dist.toFixed(1)} F900\n`);
  }
  if (RUNNING.has(state)) throw new PrinterError("Während eines Drucks lassen sich die Achsen nicht bewegen");
  if (axis === "home") return gcode("G28 \n");
  if (!dist || Math.abs(dist) > 50) throw new PrinterError("Höchstens 50 mm je Schritt");
  const f = axis === "Z" ? 900 : 3000;
  return gcode(`M211 S \nM211 X1 Y1 Z1\nM1002 push_ref_mode\nG91 \nG1 ${axis}${dist.toFixed(1)} F${f}\nM1002 pop_ref_mode\nM211 R\n`);
}

/** Druckfehler am Drucker quittieren bzw. HMS-Meldung ausblenden, bis der Drucker sie nicht mehr meldet */
export async function dismissAlert(id: number, kind: "error" | "hms", code: string) {
  const c = conn(id);
  if (kind === "hms") {
    c.hmsHidden.add(code);
    return;
  }
  const err = Number(c.raw.print_error ?? 0);
  if (!err) return;
  await c.command({ print: { command: "clean_print_error", subtask_id: String(c.raw.subtask_id ?? "0"), print_error: err } });
  c.raw.print_error = 0;
}

export async function control(id: number, action: ControlAction, value?: number, index?: number, obj?: number[]) {
  const c = conn(id);
  const v = value ?? 0;
  const gcode = (line: string) => c.command({ print: { command: "gcode_line", param: `${line}\n` } });
  switch (action) {
    case "light_on":
    case "light_off": {
      const mode = action === "light_on" ? "on" : "off";
      await c.command({ system: { command: "ledctrl", led_node: "chamber_light", led_mode: mode, led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0 } }, 4000);
      c.raw.lights_report = [{ node: "chamber_light", mode }];
      return;
    }
    case "speed":
      return c.command({ print: { command: "print_speed", param: String(Math.min(4, Math.max(1, v || 2))) } });
    case "nozzle_temp":
      if (v < 0 || v > 320) throw new PrinterError("Düsentemperatur 0–320 °C");
      await gcode(`M104 S${Math.round(v)}`);
      c.raw.nozzle_target_temper = Math.round(v);
      return;
    case "bed_temp":
      if (v < 0 || v > 120) throw new PrinterError("Betttemperatur 0–120 °C");
      // Bit 39 in `fun`: Bett per MQTT-Befehl (wie Bambu Studio), sonst G-Code
      if (c.fun(39)) await c.command({ print: { command: "set_bed_temp", temp: Math.round(v) } });
      else await gcode(`M140 S${Math.round(v)}`);
      c.raw.bed_target_temper = Math.round(v);
      return;
    case "fan": {
      if (index == null) throw new PrinterError("Welcher Lüfter?");
      const pct = Math.min(100, Math.max(0, Math.round(v / 10) * 10));
      if (c.airductRaw) await c.command({ print: { command: "set_fan", fan_index: index, speed: pct } });
      else await gcode(`M106 P${index} S${Math.round(pct * 2.55)}`);
      return;
    }
    case "skip": {
      const ids = (obj ?? []).filter((x) => Number.isInteger(x) && x > 0);
      if (!ids.length) throw new PrinterError("Keine Objekte gewählt");
      if (!RUNNING.has(String(c.raw.gcode_state))) throw new PrinterError("Es läuft kein Druck");
      if (!c.fun(49)) throw new PrinterError("Dieser Drucker kann keine Objekte überspringen");
      return c.command({ print: { command: "skip_objects", obj_list: ids } });
    }
    case "airduct":
      if (!c.airduct()?.modes.includes(v)) throw new PrinterError("Diesen Luftstrom-Modus kennt der Drucker nicht");
      return c.command({ print: { command: "set_airduct", modeId: v, submode: -1 } });
    default:
      await c.command({ print: { command: action, param: "" } });
  }
}

/** Mitte des Düsenbereichs eines Fachs, -1 = unbekannt (dann nimmt der Drucker seinen Standard, wie Bambu Studio) */
const midTemp = (t: Raw | undefined) => {
  const lo = Number(t?.nozzle_temp_min);
  const hi = Number(t?.nozzle_temp_max);
  return lo > 0 && hi > 0 ? Math.round((lo + hi) / 2) : -1;
};

/** Filament laden (Fach) bzw. entladen (null); wie „Laden“/„Entladen“ in Bambu Studio */
export async function changeFilament(id: number, tray: number | null) {
  const c = conn(id);
  if (RUNNING.has(String(c.raw.gcode_state)) && c.raw.gcode_state !== "PAUSE") throw new PrinterError("Während des Drucks geht das nicht");
  if (amsBusy(c.raw.ams_status)) throw new PrinterError("Das AMS ist gerade beschäftigt");
  const now = c.trays().find((t) => t.active)?.id ?? null;
  const cur = now != null ? midTemp(c.trayRaw(now)) : -1;
  if (tray == null) {
    if (now == null) throw new PrinterError("Es ist kein Filament geladen");
    const ams = now === 254 ? 254 : now >> 2;
    return c.command({ print: { command: "ams_change_filament", curr_temp: cur, tar_temp: cur, ams_id: ams, target: 255, slot_id: 255 } }, 15_000);
  }
  const t = c.trays().find((x) => x.id === tray);
  if (!t?.loaded) throw new PrinterError("Im Fach steckt keine Spule");
  if (tray === now) throw new PrinterError("Dieses Filament ist schon geladen");
  const ext = tray === 254;
  const ams = ext ? 254 : tray >> 2;
  const slot = ext ? 0 : tray & 3;
  // Ziel: Fach-Nr. (AMS × 4 + Fach); AMS HT und extern: ams_id
  const target = ext || ams >= 16 ? ams : ams * 4 + slot;
  return c.command(
    { print: { command: "ams_change_filament", curr_temp: cur, tar_temp: midTemp(c.trayRaw(tray)), ams_id: ams, target, slot_id: slot } },
    15_000,
  );
}

/** RFID eines Fachs neu lesen (das AMS dreht die Spule kurz) */
export async function readRfid(id: number, tray: number) {
  const c = conn(id);
  if (tray === 254 || !c.trays().some((t) => t.id === tray)) throw new PrinterError("Nur Fächer im AMS haben einen Leser");
  if (RUNNING.has(String(c.raw.gcode_state))) throw new PrinterError("Während des Drucks geht das nicht");
  return c.command({ print: { command: "ams_get_rfid", ams_id: tray >> 2, slot_id: tray & 3 } });
}

/** AMS trocknen (Temperatur °C, Dauer h) bzw. Trocknung beenden (null) */
export async function dryAms(id: number, amsId: number, o: { temp: number; hours: number; filament: string; rotate: boolean } | null) {
  const c = conn(id);
  const u = c.amsUnits(c.trays()).find((x) => x.id === amsId);
  if (!u?.can_dry) throw new PrinterError("Dieses AMS kann nicht per Befehl trocknen");
  const base = { command: "ams_filament_drying", ams_id: amsId, humidity: 0, close_power_conflict: false };
  if (c.dryPending.has(amsId)) throw new PrinterError("Der Drucker setzt den letzten Befehl noch um");
  let print: Raw = { ...base, mode: 0, filament: "", temp: 0, duration: 0, rotate_tray: false, cooling_temp: 0 };
  if (o) {
    const blocked = u.dry_blocked.find((r) => r !== 6);
    if (blocked != null) throw new PrinterError(DRY_BLOCK[blocked] ?? `Trocknen gerade nicht möglich (${blocked})`);
    if (o.temp < 45 || o.temp > u.dry_max) throw new PrinterError(`Temperatur 45–${u.dry_max} °C`);
    if (o.hours < 1 || o.hours > 72) throw new PrinterError("Dauer 1–72 Stunden");
    // zone_id 0 und Abkühlen auf 50 °C wie Bambu Studio ohne Filament-Vorgabe
    const { temp, hours } = { temp: Math.round(o.temp), hours: Math.round(o.hours) };
    print = { ...base, zone_id: 0, mode: 1, filament: o.filament || "PLA", temp, duration: hours, rotate_tray: o.rotate, cooling_temp: 50 };
  }
  // Schon vor dem Senden sperren (Doppelklick), bei Fehler wieder frei; bleibt stehen, bis der Bericht die Änderung zeigt
  c.dryPending.set(amsId, { stop: !o, until: Date.now() + 60_000 });
  try {
    await c.command({ print });
  } catch (e) {
    c.dryPending.delete(amsId);
    throw e;
  }
}

/** Druckoption bzw. KI-Erkennung schalten (siehe options.ts) */
export async function setOption(id: number, key: string, o: OptionInput) {
  const c = conn(id);
  const cmd = optionCommand(c.raw, key, o, c.holds);
  if (!cmd) throw new PrinterError("Diese Option kennt der Drucker nicht");
  await c.command(cmd);
  c.holds.set(key, { ...o, until: Date.now() + 8000 });
}

/**
 * Spule ohne Chip im Fach einstellen (wie „Filament bearbeiten“ in Bambu Studio): Profil-ID als tray_info_idx, Farbe, Düse, Typ.
 * Fach-Nr. AMS × 4 + Fach (AMS HT ab 512), 254 = externe Spule (ams_id 255). Fächer mit Bambu-Chip stellt der Drucker selbst ein.
 */
export async function pushTray(printerId: number, tray: number, s: Spool): Promise<string> {
  const c = conn(printerId);
  const raw = c.rawTrays().find((t) => t.id === tray);
  if (raw?.uuid) throw new PrinterError("Im Fach steckt eine Bambu-Spule mit Chip, das Profil setzt der Drucker selbst.");
  if (RUNNING.has(String(c.raw.gcode_state)) && c.trays().find((t) => t.id === tray)?.active) throw new PrinterError("Das Fach druckt gerade.");
  const p = profileById(s.profile_id) ?? autoProfile(s.material, s.name);
  const ext = tray === 254;
  await c.command({
    print: {
      command: "ams_filament_setting",
      ams_id: ext ? 255 : tray >> 2,
      tray_id: ext ? 254 : tray & 3,
      slot_id: ext ? 0 : tray & 3,
      tray_info_idx: p?.id ?? "",
      setting_id: "",
      tray_color: `${s.color.replace("#", "").toUpperCase()}FF`,
      nozzle_temp_min: s.nozzle_min ?? p?.nozzle_min ?? 190,
      nozzle_temp_max: s.nozzle_max ?? p?.nozzle_max ?? 240,
      tray_type: p?.type ?? s.material.toUpperCase(),
    },
  });
  return p?.name ?? s.material;
}

/** Fach-Nummern mit Bambu-Chip (dort keine Spulen von Hand) */
export const chipTrays = (printerId: number) => new Set(conns.get(printerId)?.rawTrays().filter((t) => t.uuid).map((t) => t.id) ?? []);

/** Name auf der SD-Karte: nur ASCII, Bambu-Firmware verträgt keine Umlaute */
export const ftpName = (name: string) =>
  baseName(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) +
  ".gcode.3mf";

const md5 = (p: string) =>
  new Promise<string>((res, rej) => {
    const h = createHash("md5");
    createReadStream(p).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej);
  });

/** P2S und H2 (Seriennummern 22E… bzw. 094…/239…) brauchen den neueren project_file-Befehl */
const isModern = (model: string, serial: string) => /^(P2|H2)/i.test(model) || serial.startsWith("22E");

/** md5 des G-Codes der Platte: steht als Metadata/plate_N.gcode.md5 in der Datei, sonst selbst rechnen */
async function plateMd5(local: string, plate: number): Promise<string> {
  const want = new Set([`Metadata/plate_${plate}.gcode.md5`, `Metadata/plate_${plate}.gcode`]);
  const z = unzipSync(new Uint8Array(await readFile(local)), { filter: (f) => want.has(f.name) });
  const stored = z[`Metadata/plate_${plate}.gcode.md5`];
  if (stored) return Buffer.from(stored).toString().trim().toLowerCase();
  const g = z[`Metadata/plate_${plate}.gcode`];
  if (!g) throw new PrinterError(`Platte ${plate} hat keinen G-Code`);
  return createHash("md5").update(g).digest("hex");
}

/** Anzahl Filamente im Projekt (filament_colour in project_settings.config) */
async function projectFilaments(local: string): Promise<number> {
  try {
    const z = unzipSync(new Uint8Array(await readFile(local)), { filter: (f) => f.name === "Metadata/project_settings.config" });
    const cfg = z["Metadata/project_settings.config"];
    return cfg ? (JSON.parse(Buffer.from(cfg).toString()).filament_colour?.length ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** Geslicte .gcode.3mf per FTPS hochladen und den Druck per MQTT starten */
export async function startPrint(id: number, req: PrintRequest) {
  const c = conn(id);
  if (!c.connected) throw new PrinterError("Drucker nicht verbunden");
  if (RUNNING.has(String(c.raw.gcode_state))) throw new PrinterError("Der Drucker druckt gerade");
  const file = fileRow(req.file_id);
  if (!file || file.kind !== "gcode3mf") throw new PrinterError("Nur geslicte .gcode.3mf-Dateien lassen sich drucken");
  const meta = JSON.parse(file.meta) as { plates?: { index: number; filaments: { id: number; type: string; color: string }[] }[] };
  const plate = meta.plates?.find((p) => p.index === req.plate);
  if (!plate) throw new PrinterError(`Platte ${req.plate} hat keinen G-Code`);

  const remote = ftpName(file.name);
  const local = absPath(file);
  // P2S und H2 wollen den neueren Startbefehl (wie Bambu Studio): Datei per ftp://, Schalter als 0/1, IDs ≠ 0, ams_mapping2.
  // Der alte Befehl mit file:///sdcard/ endet dort mit „kann nicht laden“ und ERROR STATE
  const modern = isModern(c.row.model, c.row.serial);
  const dir = /^P2/i.test(c.row.model) || c.row.serial.startsWith("22E") ? "/cache/" : "/";
  const ftp = new FtpClient(60_000);
  try {
    await ftp.access({ host: c.row.host, port: 990, user: "bblp", password: c.row.access_code, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
    // Auf einem frischen USB-Stick gibt es /cache noch nicht (553 Could not create file)
    if (modern && dir !== "/") await ftp.ensureDir(dir);
    await ftp.uploadFrom(local, modern ? `${dir}${remote}` : `/${remote}`);
  } catch (e) {
    throw new PrinterError(`Upload auf den Drucker fehlgeschlagen: ${(e as Error).message}`);
  } finally {
    ftp.close();
  }

  const name = remote.replace(/\.gcode\.3mf$/, "");
  const trays = c.trays();
  c.pending = {
    name,
    fileId: file.id,
    modelId: file.model_id,
    plate: req.plate,
    filaments: req.use_ams
      ? plate.filaments.map((f) => {
          const t = trays.find((x) => x.id === req.ams_mapping[f.id - 1]);
          return { type: t?.type || f.type, color: t?.color || f.color };
        })
      : plate.filaments.map((f) => ({ type: f.type, color: f.color })),
    plan: planFromMeta(file.meta, req.plate, { useAms: req.use_ams, map: req.ams_mapping, printerId: c.row.id }),
    at: Date.now(),
  };
  // Alte Firmware kennt nur an/aus; „Automatisch“ heißt dort an
  const bedOn = req.bed_leveling === true || req.bed_leveling === "on" || req.bed_leveling === "auto";
  if (!modern) {
    await c.command({
      print: {
        command: "project_file",
        param: `Metadata/plate_${req.plate}.gcode`,
        project_id: "0",
        profile_id: "0",
        task_id: "0",
        subtask_id: "0",
        subtask_name: name,
        url: `file:///sdcard/${remote}`,
        md5: await md5(local),
        timelapse: req.timelapse,
        bed_type: "auto",
        bed_levelling: bedOn,
        bed_leveling: bedOn,
        flow_cali: req.flow_cali === true || req.flow_cali === "on" || req.flow_cali === "auto",
        vibration_cali: req.vibration_cali ?? true,
        layer_inspect: false,
        use_ams: req.use_ams,
        ...(req.use_ams ? { ams_mapping: req.ams_mapping } : {}),
      },
    }, 15_000);
    return;
  }
  // ams_mapping je Filament des Projekts (nicht nur der Platte), unbenutzte mit -1
  const count = Math.max(req.ams_mapping.length, ...plate.filaments.map((f) => f.id), await projectFilaments(local));
  const mapping = Array.from({ length: count }, (_, i) => (req.use_ams ? (req.ams_mapping[i] ?? -1) : -1));
  const ids = String(Date.now() & 0x7fffffff);
  const b = (v: boolean | undefined) => (v ? 1 : 0);
  const tri = (v: boolean | string) => (v === true || v === "on" ? 1 : v === "auto" ? 2 : 0);
  await c.command({
    print: {
      command: "project_file",
      param: `Metadata/plate_${req.plate}.gcode`,
      file: remote,
      url: `ftp://${dir}${remote}`,
      md5: await plateMd5(local, req.plate),
      project_id: ids,
      profile_id: "0",
      task_id: ids,
      subtask_id: ids,
      subtask_name: name,
      bed_type: "auto",
      timelapse: b(req.timelapse),
      // Wie Bambu Studio: das bool nur bei „an“, der Zahlwert 0 aus, 1 immer, 2 automatisch (Drucker prüft kurz, überspringt wenn unnötig)
      bed_leveling: b(req.bed_leveling === true || req.bed_leveling === "on"),
      auto_bed_leveling: tri(req.bed_leveling),
      flow_cali: b(req.flow_cali === true || req.flow_cali === "on"),
      extrude_cali_flag: tri(req.flow_cali),
      extrude_cali_manual_mode: 0,
      // Vibration schickt Studio beim Druckstart nicht mehr mit, Düsenversatz gibt es nur bei zwei Düsen
      vibration_cali: 0,
      nozzle_offset_cali: 0,
      layer_inspect: 0,
      use_ams: req.use_ams,
      ams_mapping: mapping,
      ams_mapping2: mapping.map((v) =>
        v < 0 || v === 255
          ? { ams_id: 255, slot_id: 255 }
          : v === 254
            ? { ams_id: 254, slot_id: 254 }
            : v >= 128
              ? { ams_id: 128, slot_id: v - 128 }
              : { ams_id: Math.floor(v / 4), slot_id: v % 4 },
      ),
    },
  }, 15_000);
}

export function stopAll() {
  for (const c of conns.values()) c.stop();
}

export const printerOf = (id: number) => printerRow(id);

/** FTPS-Zugang zum Speicher des Druckers (SD-Karte bzw. USB-Stick); der Zugangscode bleibt im Server */
export async function printerFtp(id: number, timeoutMs = 30_000): Promise<FtpClient> {
  const c = conn(id);
  if (c.raw.sdcard === false) throw new PrinterError(/^(P2|H2)/.test(c.row.model) ? "Kein USB-Stick im Drucker" : "Keine SD-Karte im Drucker");
  const ftp = new FtpClient(timeoutMs);
  try {
    await ftp.access({ host: c.row.host, port: 990, user: "bblp", password: c.row.access_code, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
  } catch (e) {
    ftp.close();
    throw new PrinterError(`Speicher des Druckers nicht erreichbar: ${(e as Error).message}`);
  }
  return ftp;
}

const NOZZLE_TYPE: Record<string, string> = { HS: "Gehärteter Stahl", HH: "Gehärteter Stahl, High Flow", SS: "Edelstahl", TC: "Wolframkarbid" };
const nozzleType = (t: string) =>
  ({ hardened_steel: "Gehärteter Stahl", stainless_steel: "Edelstahl", tungsten_carbide: "Wolframkarbid" })[t] ?? NOZZLE_TYPE[t.slice(0, 2).toUpperCase()] ?? t;

/** Verbaute Düse für den Slice-Dialog: Durchmesser („0.4“), Material, High Flow; null = Drucker nicht verbunden */
export function nozzleInfo(id: number): { diameter: string | null; type: string | null; highFlow: boolean } | null {
  const r = conns.get(id)?.raw;
  if (!r) return null;
  const nz = (r.device?.nozzle?.info as Raw[] | undefined)?.[0];
  const t = String(r.nozzle_type ?? nz?.type ?? "");
  return { diameter: nozzleOf(id), type: t ? nozzleType(t) : null, highFlow: /^HH/i.test(t) || /high.?flow/i.test(String(nz?.flow ?? r.nozzle_flow ?? "")) };
}

/** Geräteinfo wie „Firmware“ in der Handy-App: Module mit Version, Düse, Speicher, Update-Hinweis; holt die Versionen neu, wenn älter als 1 min */
export async function deviceInfo(id: number): Promise<DeviceInfo> {
  const c = conn(id);
  if (c.connected && Date.now() - c.versionAt > 60_000) {
    await new Promise<void>((res) => {
      const t = setTimeout(res, 4000);
      c.versionWaiters.push(() => (clearTimeout(t), res()));
      try {
        c.publish({ info: { command: "get_version" } });
      } catch {
        res();
      }
    });
  }
  const r = c.raw;
  const nz = (r.device?.nozzle?.info as Raw[] | undefined)?.[0];
  const dia = Number(r.nozzle_diameter ?? nz?.diameter) || null;
  const type = String(r.nozzle_type ?? nz?.type ?? "");
  const up = r.upgrade_state as Raw | undefined;
  return {
    serial: c.row.serial,
    model: c.row.model,
    connected: c.connected,
    modules: c.modules
      .filter((m) => m.sw_ver)
      .map((m) => ({ name: String(m.name ?? ""), product: String(m.product_name ?? ""), sw: String(m.sw_ver), hw: String(m.hw_ver ?? ""), sn: String(m.sn ?? "") })),
    nozzle: dia || type ? { diameter: dia, type: type ? nozzleType(type) : null } : null,
    wifi: r.wifi_signal ? String(r.wifi_signal) : null,
    storage: typeof r.sdcard === "boolean" ? r.sdcard : null,
    update: up && Number(up.new_version_state) === 1 && up.ota_new_version_number ? String(up.ota_new_version_number) : null,
  };
}

/** Kalibrierung wie in der Handy-App; option-Bits wie Bambu Studio: 1 Bett nivellieren, 2 Vibration, 3 Motorgeräusch */
export async function calibrate(id: number, o: { bed: boolean; vibration: boolean; motor: boolean }) {
  const c = conn(id);
  if (RUNNING.has(String(c.raw.gcode_state))) throw new PrinterError("Während eines Drucks geht das nicht");
  const option = (o.motor ? 1 << 3 : 0) | (o.vibration ? 1 << 2 : 0) | (o.bed ? 1 << 1 : 0);
  if (!option) throw new PrinterError("Nichts zum Kalibrieren gewählt");
  await c.command({ print: { command: "calibration", option } }, 10_000);
}
