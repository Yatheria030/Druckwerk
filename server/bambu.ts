// Lokale Anbindung von Bambu-Lab-Druckern im LAN-Modus:
// MQTT über TLS (8883, Nutzer bblp, Passwort = Zugangscode) für Status und Befehle, FTPS (implizit, 990) für den Upload.
// Seit der Firmware mit „Authorization Control“ (2025) nimmt der Drucker Befehle von Fremdsoftware nur im
// LAN-Modus mit eingeschaltetem Entwicklermodus an. Status lesen geht auch ohne.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client as FtpClient } from "basic-ftp";
import { unzipSync } from "fflate";
import mqtt, { type MqttClient } from "mqtt";
import { autoProfile, profileById } from "../shared/profiles.ts";
import type { AmsUnit, PrinterLive, PrintRequest, Spool, Tray } from "../shared/types.ts";
import { grabFrame } from "./camera.ts";
import { DATA_DIR, db, nowIso, PHOTO_DIR } from "./db.ts";
import { absPath, baseName, fileRow, parseSliceInfo } from "./files.ts";
import { setting } from "./settings.ts";
import { bookPrint, slotMap, spoolAt, syncRfidRemain, syncTrays, trayLabel, type PlanItem, type TrayInfo, type TrayStart } from "./spools.ts";
import { printerRow, printerRows, type PrinterRow } from "./store.ts";

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

  constructor(public row: PrinterRow) {}

  get reportTopic() {
    return `device/${this.row.serial}/report`;
  }

  start() {
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

  /** Befehl senden und auf die Antwort mit gleicher sequence_id warten (P1/A1 antworten mit result) */
  async command(msg: Raw, timeoutMs = 8000): Promise<void> {
    const seq = this.publish(msg);
    const reply = await new Promise<Raw | null>((res) => {
      const t = setTimeout(() => (this.waiters.delete(seq), res(null)), timeoutMs);
      this.waiters.set(seq, (r) => (clearTimeout(t), this.waiters.delete(seq), res(r)));
    });
    if (reply && String(reply.result ?? "").toLowerCase() === "fail") {
      const reason = String(reply.reason ?? reply.err_code ?? "");
      throw new PrinterError(
        `Der Drucker hat den Befehl abgelehnt${reason ? ` (${reason})` : ""}. Fremdsoftware darf nur im LAN-Modus mit eingeschaltetem Entwicklermodus steuern.`,
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
    if (msg.system?.command === "ledctrl" && msg.system.led_node === "chamber_light") {
      this.raw.lights_report = [{ node: "chamber_light", mode: msg.system.led_mode }];
    }
    this.syncLibrary();
    this.track();
  }

  traySig = "";
  /** Bibliothek nachziehen, wenn sich in den Fächern etwas geändert hat (Spule eingelegt, getauscht, leer) */
  syncLibrary() {
    if (!this.raw.ams) return;
    const trays = this.rawTrays();
    // Während eines Drucks fällt der Restwert laufend: dann nur neue Spulen übernehmen, der Rest nach der Druckbuchung am Ende
    const printing = RUNNING.has(String(this.raw.gcode_state));
    const sig = trays.map((t) => `${t.id}:${t.uuid}:${t.type}:${+t.loaded}:${printing ? t.remain != null : t.remain}`).join("|") + (printing ? "|druckt" : "");
    if (sig === this.traySig) return;
    this.traySig = sig;
    try {
      syncTrays(this.row.id, trays);
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

  trays(): Tray[] {
    const now = Number(this.raw.ams?.tray_now ?? 255);
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
    }));
  }

  amsUnits(trays: Tray[]): AmsUnit[] {
    const lite = this.row.model === "A1" || this.row.model === "A1M";
    return ((this.raw.ams?.ams ?? []) as Raw[]).map((u) => {
      const a = Number(u.id);
      const own = trays.filter((t) => t.id >> 2 === a && t.id !== 254);
      const humidity = n(u.humidity_raw);
      const dry = n(u.dry_time);
      return {
        id: a,
        label: a >= 128 ? `AMS HT ${a - 127}` : `AMS ${"ABCDEFGH"[a] ?? a + 1}`,
        kind: lite ? "AMS lite" : own.length === 1 ? "AMS HT" : humidity != null ? "AMS 2 Pro" : "AMS",
        humidity,
        humidity_level: n(u.humidity),
        temp: n(u.temp) || null,
        drying_min: dry && dry > 0 ? dry : null,
        trays: own,
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
      hms: ((r.hms ?? []) as Raw[]).map((h) => {
        const attr = Number(h.attr) >>> 0;
        const code = Number(h.code) >>> 0;
        const p = (x: number) => x.toString(16).toUpperCase().padStart(4, "0");
        const ts = String(h.ts_unix ?? "").match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)/);
        return {
          code: `${p(attr >>> 16)}_${p(attr & 0xffff)}_${p(code >>> 16)}_${p(code & 0xffff)}`,
          severity: code >>> 16,
          at: ts ? `${ts[1]}-${ts[2]}-${ts[3]} ${ts[4]}:${ts[5]}` : null,
        };
      }),
      current_print_id: open?.id ?? null,
    };
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
      const p = this.pending && this.pending.name === name && Date.now() - this.pending.at < 30 * 60_000 ? this.pending : null;
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
      if (!plan.length) void this.fetchPlan(id, name, plateNo);
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
      void this.photo(open.id);
    }
  }

  close(open: { id: number; progress: number }, status: string, err: number | null = null) {
    closePrint(open.id, status, err);
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
   * Druck aus Bambu Studio oder der Cloud: die .gcode.3mf liegt auf der SD-Karte (Wurzel oder /cache),
   * daraus slice_info.config lesen, damit der Verbrauch je Filament bekannt ist
   */
  async fetchPlan(printId: number, name: string, plate: number | null) {
    const ftp = new FtpClient(30_000);
    const tmp = path.join(DATA_DIR, `plan-${printId}.3mf`);
    try {
      await ftp.access({ host: this.row.host, port: 990, user: "bblp", password: this.row.access_code, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
      const want = name.toLowerCase().replace(/\.gcode\.3mf$|\.3mf$/, "");
      for (const dir of ["/", "/cache"]) {
        const list = await ftp.list(dir).catch(() => []);
        const f = list.find((x) => x.isFile && x.name.toLowerCase().replace(/\.gcode\.3mf$|\.3mf$/, "") === want && /\.3mf$/i.test(x.name));
        if (!f) continue;
        if (f.size > 300 * 1024 ** 2) return;
        await ftp.downloadTo(tmp, `${dir === "/" ? "" : dir}/${f.name}`);
        const out = unzipSync(await readFile(tmp), { filter: (e) => e.name === "Metadata/slice_info.config" });
        const xml = out["Metadata/slice_info.config"];
        if (!xml) return;
        const plates = parseSliceInfo(new TextDecoder().decode(xml));
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
        return;
      }
    } catch (e) {
      console.warn(`Filamentbedarf für Druck ${printId} nicht lesbar:`, (e as Error).message);
    } finally {
      ftp.close();
      await rm(tmp, { force: true });
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
    } else c.row = r;
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

export async function control(id: number, action: "pause" | "resume" | "stop" | "light_on" | "light_off" | "speed", value?: number) {
  const c = conn(id);
  if (action === "light_on" || action === "light_off") {
    const mode = action === "light_on" ? "on" : "off";
    await c.command({ system: { command: "ledctrl", led_node: "chamber_light", led_mode: mode, led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0 } }, 4000);
    c.raw.lights_report = [{ node: "chamber_light", mode }];
    return;
  }
  if (action === "speed") return c.command({ print: { command: "print_speed", param: String(Math.min(4, Math.max(1, value ?? 2))) } });
  await c.command({ print: { command: action, param: "" } });
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
  const ftp = new FtpClient(60_000);
  try {
    await ftp.access({ host: c.row.host, port: 990, user: "bblp", password: c.row.access_code, secure: "implicit", secureOptions: { rejectUnauthorized: false } });
    await ftp.uploadFrom(local, `/${remote}`);
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
      bed_levelling: req.bed_leveling,
      bed_leveling: req.bed_leveling,
      flow_cali: req.flow_cali,
      vibration_cali: true,
      layer_inspect: false,
      use_ams: req.use_ams,
      ...(req.use_ams ? { ams_mapping: req.ams_mapping } : {}),
    },
  }, 15_000);
}

export function stopAll() {
  for (const c of conns.values()) c.stop();
}

export const printerOf = (id: number) => printerRow(id);
