import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { compress } from "hono/compress";
import { stream } from "hono/streaming";
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { z } from "zod";
import { SECTIONS, type SectionId } from "../shared/settings.ts";
import { PRINTER_MODELS } from "../shared/types.ts";
import { partsOf, pickPath } from "./parts.ts";
import { deleteStorage, importStorage, listStorage } from "./storage.ts";
import { calibrate, changeFilament, chipTrays, control, deviceInfo, dismissAlert, dryAms, move, readRfid, live, liveAll, nozzleInfo, nozzleOf, printerFromEnv, PrinterError, pushTray, setOption, startPrint, stopAll, syncPrinters, testConnection } from "./bambu.ts";
import { camera, grabFrame } from "./camera.ts";
import { PLUG_RE, readPlug } from "./plug.ts";
import * as catalog from "./catalog.ts";
import { ScrapeError, scrapeFilament } from "./scrape.ts";
import { saveSection, setSetupDone, settingsState } from "./settings.ts";
import { db, PHOTO_DIR, TIMELAPSE_DIR } from "./db.ts";
import { absPath, FileError, fileRow, parseSliceInfo, readStream, removeFile, removeModelFiles, saveThumb, saveUpload, thumbPath, upgradeMeta } from "./files.ts";
import { checkLowSpools, checkMaintenance, notify, notifyConfigured } from "./notify.ts";
import * as maint from "./maintenance.ts";
import { addQueue, listQueue, orderQueue, removeQueue } from "./queue.ts";
import { account as bambuAccount, BambuError, confirm as bambuConfirm, login as bambuLogin, logout as bambuLogout } from "./bambucloud.ts";
import { MW_ORDER, mwDetail, mwImport, mwSearch } from "./makerworld.ts";
import { importModel, PRINTABLES_ORDER, printablesDetail, printablesLink, printablesSearch } from "./modelimport.ts";
import { preview, processes, slice, SliceError, slicerAvailable, MAX_COPIES, slicerName, sourceSlots } from "./slicer.ts";
import * as spools from "./spools.ts";
import * as stock from "./stock.ts";
import * as store from "./store.ts";

const app = new Hono();
const api = new Hono();

const idParam = (c: Context, key = "id") => {
  const n = Number(c.req.param(key));
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | Response> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Ungültiges JSON" }, 400);
  }
  const r = schema.safeParse(raw);
  if (!r.success) return c.json({ error: r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "Eingabe"}: ${i.message}`).join("; ") }, 400);
  return r.data;
}

const fail = (c: Context, e: unknown) => {
  if (e instanceof PrinterError || e instanceof FileError) return c.json({ error: e.message }, 400);
  console.error(e);
  return c.json({ error: "Interner Fehler" }, 500);
};

api.get("/health", (c) => c.json({ ok: true }));

// Modelle
const modelSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(20_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  source_url: z.string().trim().max(1000),
  creator: z.string().trim().max(200),
  license: z.string().trim().max(200),
  favorite: z.boolean(),
  cover_file_id: z.number().int().positive().nullable(),
});

api.get("/models", (c) => c.json(store.listModels()));
api.get("/tags", (c) => c.json(store.allTags()));
api.post("/models", async (c) => {
  const b = await body(c, modelSchema.partial().required({ name: true }));
  if (b instanceof Response) return b;
  return c.json({ id: store.createModel(b) }, 201);
});
api.get("/models/:id", (c) => {
  const id = idParam(c);
  const d = id ? store.getModel(id) : null;
  return d ? c.json(d) : c.json({ error: "Modell nicht gefunden" }, 404);
});
api.patch("/models/:id", async (c) => {
  const id = idParam(c);
  if (!id || !store.getModel(id)) return c.json({ error: "Modell nicht gefunden" }, 404);
  const b = await body(c, modelSchema.partial());
  if (b instanceof Response) return b;
  if (b.cover_file_id && fileRow(b.cover_file_id)?.model_id !== id) return c.json({ error: "Datei gehört nicht zum Modell" }, 400);
  store.updateModel(id, b);
  return c.json(store.getModel(id));
});
api.delete("/models/:id", async (c) => {
  const id = idParam(c);
  if (!id) return c.json({ error: "Modell nicht gefunden" }, 404);
  await removeModelFiles(id);
  return store.deleteModel(id) ? c.json({ ok: true }) : c.json({ error: "Modell nicht gefunden" }, 404);
});

// Dateien: Upload als roher Körper, Name in ?name=
// Sammlungen (Projekte)
const collSchema = z.object({ name: z.string().trim().min(1, "Name fehlt").max(120), description: z.string().trim().max(2000).default("") });
api.get("/collections", (c) => c.json(store.listCollections()));
api.post("/collections", async (c) => {
  const b = await body(c, collSchema.extend({ models: z.array(z.number().int()).max(5000).optional() }));
  if (b instanceof Response) return b;
  const id = store.createCollection(b.name, b.description);
  for (const m of b.models ?? []) if (store.getModel(m)) store.setModelCollections(m, [...store.getModel(m)!.collections, id]);
  return c.json({ id }, 201);
});
api.patch("/collections/:id", async (c) => {
  const id = idParam(c) ?? 0;
  if (!store.getCollection(id)) return c.json({ error: "Sammlung nicht gefunden" }, 404);
  const b = await body(c, collSchema.partial());
  if (b instanceof Response) return b;
  store.updateCollection(id, b);
  return c.json({ ok: true });
});
api.delete("/collections/:id", (c) => (store.deleteCollection(idParam(c) ?? 0) ? c.json({ ok: true }) : c.json({ error: "Sammlung nicht gefunden" }, 404)));
api.put("/models/:id/collections", async (c) => {
  const id = idParam(c) ?? 0;
  if (!store.getModel(id)) return c.json({ error: "Modell nicht gefunden" }, 404);
  const b = await body(c, z.object({ ids: z.array(z.number().int()).max(1000) }));
  if (b instanceof Response) return b;
  store.setModelCollections(id, b.ids);
  return c.json({ ok: true });
});

api.post("/models/:id/files", async (c) => {
  const id = idParam(c);
  if (!id || !store.getModel(id)) return c.json({ error: "Modell nicht gefunden" }, 404);
  const name = c.req.query("name");
  if (!name || !c.req.raw.body) return c.json({ error: "Dateiname oder Inhalt fehlt" }, 400);
  try {
    return c.json({ ids: await saveUpload(id, name, c.req.raw.body) }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

const MIME: Record<string, string> = {
  stl: "model/stl", "3mf": "model/3mf", gcode3mf: "model/3mf", obj: "model/obj", step: "model/step",
};
const IMG: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

function sendFile(c: Context, p: string, type: string, extra: Record<string, string> = {}) {
  if (!existsSync(p)) return c.json({ error: "Datei fehlt" }, 404);
  return new Response(readStream(p), { headers: { "content-type": type, "content-length": String(statSync(p).size), ...extra } });
}

// Inline für die 3D-Ansicht; /download/<name> als Anhang (der Name am Ende hilft Bambu Studio beim Öffnen per Link)
api.get("/files/:id/raw", (c) => {
  const f = fileRow(idParam(c) ?? 0);
  if (!f) return c.json({ error: "Datei nicht gefunden" }, 404);
  const type = f.kind === "image" ? (IMG[path.extname(f.path)] ?? "application/octet-stream") : (MIME[f.kind] ?? "application/octet-stream");
  return sendFile(c, absPath(f), type, { "cache-control": "private, max-age=86400" });
});
api.get("/files/:id/download/:name?", (c) => {
  const f = fileRow(idParam(c) ?? 0);
  if (!f) return c.json({ error: "Datei nicht gefunden" }, 404);
  return sendFile(c, absPath(f), "application/octet-stream", { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` });
});
api.get("/files/:id/thumb", (c) => {
  const f = fileRow(idParam(c) ?? 0);
  if (!f?.has_thumb) return c.json({ error: "Keine Vorschau" }, 404);
  if (f.kind === "image") return sendFile(c, absPath(f), IMG[path.extname(f.path)] ?? "image/png", { "cache-control": "private, max-age=600" });
  return sendFile(c, thumbPath(f.id), "image/png", { "cache-control": "private, max-age=600" });
});
api.get("/files/:id/plate/:n", (c) => {
  const id = idParam(c);
  const n = idParam(c, "n");
  return id && n ? sendFile(c, thumbPath(id, n), "image/png", { "cache-control": "private, max-age=86400" }) : c.json({ error: "Nicht gefunden" }, 404);
});
api.put("/files/:id/thumb", async (c) => {
  const f = fileRow(idParam(c) ?? 0);
  if (!f) return c.json({ error: "Datei nicht gefunden" }, 404);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.length > 3_000_000) return c.json({ error: "Vorschau zu groß" }, 400);
  try {
    await saveThumb(f.id, buf);
    store.updateModel(f.model_id, {});
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});
api.delete("/files/:id", async (c) => ((await removeFile(idParam(c) ?? 0)) ? c.json({ ok: true }) : c.json({ error: "Datei nicht gefunden" }, 404)));

// Druckhistorie
api.get("/prints", (c) => c.json(store.listPrints()));
api.get("/stats", (c) => c.json(store.stats()));
api.post("/notify/test", async (c) => {
  if (!notifyConfigured()) return c.json({ error: "Noch kein Kanal eingetragen (ntfy, Gotify mit Token oder Webhook)." }, 400);
  return c.json(
    await notify({ event: "test", title: "Druckwerk: Test", message: "Benachrichtigungen kommen an.", priority: 3, tags: ["tada"], link: "#/einstellungen" }),
  );
});
api.patch("/prints/:id", async (c) => {
  const id = idParam(c);
  if (!id || !store.getPrint(id)) return c.json({ error: "Druck nicht gefunden" }, 404);
  const b = await body(c, z.object({ rating: z.number().int().min(1).max(5).nullable(), note: z.string().max(5000), model_id: z.number().int().positive().nullable() }).partial());
  if (b instanceof Response) return b;
  store.updatePrint(id, b);
  return c.json(store.getPrint(id));
});
// Verbrauch nachtragen bzw. korrigieren (ersetzt die Druckbuchungen dieses Drucks)
api.put("/prints/:id/usage", async (c) => {
  const id = idParam(c);
  if (!id || !store.getPrint(id)) return c.json({ error: "Druck nicht gefunden" }, 404);
  const b = await body(c, z.object({ items: z.array(z.object({ spool_id: z.number().int().positive(), grams: z.number().min(0).max(20_000) })).max(32) }));
  if (b instanceof Response) return b;
  spools.setPrintUsage(id, b.items);
  return c.json(store.getPrint(id));
});
// Filamentbedarf aus einer .gcode.3mf (aus Bambu Studio exportiert) lesen, ohne sie zu speichern: Platte des Drucks
api.post("/prints/:id/usage/file", async (c) => {
  const p = store.getPrint(idParam(c) ?? 0);
  if (!p) return c.json({ error: "Druck nicht gefunden" }, 404);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.length > 300 * 1024 ** 2) return c.json({ error: "Datei zu groß" }, 400);
  let plates: ReturnType<typeof parseSliceInfo> = [];
  try {
    const xml = unzipSync(buf, { filter: (e) => e.name === "Metadata/slice_info.config" })["Metadata/slice_info.config"];
    plates = xml ? parseSliceInfo(new TextDecoder().decode(xml)) : [];
  } catch {
    return c.json({ error: "Keine lesbare 3MF-Datei" }, 400);
  }
  if (!plates.length) return c.json({ error: "Die Datei ist nicht geslict (keine slice_info). In Bambu Studio „Geslicte Platte exportieren“ nehmen." }, 400);
  const plate = plates.find((x) => x.index === p.plate) ?? (plates.length === 1 ? plates[0] : null);
  if (!plate) return c.json({ error: `Die Datei hat ${plates.length} Platten, welche gedruckt wurde, ist unbekannt.`, plates: plates.map((x) => x.index) }, 400);
  return c.json({ plate: plate.index, filaments: plate.filaments.filter((f) => (f.used_g ?? 0) > 0) });
});
api.delete("/prints/:id", async (c) => {
  const id = idParam(c) ?? 0;
  await rm(path.join(PHOTO_DIR, `${id}.jpg`), { force: true });
  const tl = store.getPrint(id)?.timelapse;
  if (tl) await rm(path.join(TIMELAPSE_DIR, `${id}.${tl}`), { force: true });
  return store.deletePrint(id) ? c.json({ ok: true }) : c.json({ error: "Druck nicht gefunden" }, 404);
});
// Zeitraffer mit Range-Anfragen (Safari auf iOS spielt Videos nur so ab, Spulen braucht es auch)
api.get("/prints/:id/timelapse", (c) => {
  const id = idParam(c) ?? 0;
  const ext = store.getPrint(id)?.timelapse;
  const p = ext ? path.join(TIMELAPSE_DIR, `${id}.${ext}`) : "";
  if (!ext || !existsSync(p)) return c.json({ error: "Kein Zeitraffer" }, 404);
  const size = statSync(p).size;
  const type = ext === "mp4" ? "video/mp4" : "video/x-msvideo";
  const head = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=86400" };
  const m = (c.req.header("range") ?? "").match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return new Response(readStream(p), { headers: { ...head, "content-length": String(size) } });
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  const body = Readable.toWeb(createReadStream(p, { start, end })) as ReadableStream;
  return new Response(body, { status: 206, headers: { ...head, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` } });
});
api.get("/prints/:id/photo", (c) => sendFile(c, path.join(PHOTO_DIR, `${idParam(c) ?? 0}.jpg`), "image/jpeg", { "cache-control": "private, max-age=86400" }));

// Filament-Bibliothek
const spoolSchema = z.object({
  brand: z.string().trim().max(80),
  material: z.string().trim().min(1).max(40),
  name: z.string().trim().max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Farbe als #RRGGBB").transform((s) => s.toUpperCase()),
  color_name: z.string().trim().max(60),
  net_g: z.number().positive().max(50_000),
  used_g: z.number().min(0).max(50_000).optional(),
  tare_g: z.number().min(0).max(5000).nullable(),
  price: z.number().min(0).max(10_000).nullable(),
  price_sale: z.number().min(0).max(10_000).nullable().optional(),
  profile_id: z.string().trim().regex(/^[A-Z0-9_]{3,16}$/).nullable().optional(),
  nozzle_min: z.number().int().min(100).max(500).nullable().optional(),
  nozzle_max: z.number().int().min(100).max(500).nullable().optional(),
  bed_temp: z.number().int().min(0).max(150).nullable().optional(),
  dry_temp: z.number().int().min(20).max(150).nullable().optional(),
  dry_hours: z.number().min(0).max(96).nullable().optional(),
  url: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(80),
  note: z.string().max(5000),
  archived: z.boolean().optional(),
  track: z.enum(["eigen", "rfid"]).optional(),
});

api.get("/spools", (c) => c.json(spools.listSpools()));
api.post("/spools", async (c) => {
  const b = await body(c, spoolSchema.extend({ count: z.number().int().min(1).max(20).optional() }));
  if (b instanceof Response) return b;
  const ids = Array.from({ length: b.count ?? 1 }, () => spools.createSpool(b));
  return c.json({ id: ids[0], ids }, 201);
});
api.patch("/spools/:id", async (c) => {
  const id = idParam(c) ?? 0;
  if (!spools.getSpool(id)) return c.json({ error: "Spule nicht gefunden" }, 404);
  const b = await body(c, spoolSchema.partial());
  if (b instanceof Response) return b;
  const before = spools.getSpool(id)!;
  spools.updateSpool(id, b);
  const s = spools.getSpool(id)!;
  // Liegt die Spule im Fach und ändern sich Profil, Farbe, Material oder Temperaturen: Fach am Drucker nachziehen
  const pushed = [];
  if (s.printer_id != null && s.tray != null && (["profile_id", "color", "material", "nozzle_min", "nozzle_max"] as const).some((k) => before[k] !== s[k]))
    pushed.push(await pushSlot(s.printer_id, s.tray, id));
  return c.json({ ...s, pushed });
});
api.delete("/spools/:id", (c) => (spools.deleteSpool(idParam(c) ?? 0) ? c.json({ ok: true }) : c.json({ error: "Spule nicht gefunden" }, 404)));
api.get("/spools/:id/usage", (c) => c.json(spools.usageOf(idParam(c) ?? 0)));
/** Verbrauch von Hand buchen (negativ = Korrektur) oder Restgewicht per Waage setzen */
api.post("/spools/:id/usage", async (c) => {
  const id = idParam(c) ?? 0;
  const s = spools.getSpool(id);
  if (!s) return c.json({ error: "Spule nicht gefunden" }, 404);
  const b = await body(c, z.union([z.object({ grams: z.number().min(-50_000).max(50_000), note: z.string().max(500).default("") }), z.object({ gross_g: z.number().min(0).max(60_000) })]));
  if (b instanceof Response) return b;
  if ("gross_g" in b) {
    if (s.tare_g == null) return c.json({ error: "Leergewicht der Spule fehlt" }, 400);
    const remaining = Math.max(0, b.gross_g - s.tare_g);
    spools.addUsage(id, Math.round((s.remaining_g - remaining) * 10) / 10, "waage", null, `gewogen: ${b.gross_g} g`);
  } else spools.addUsage(id, b.grams, "manuell", null, b.note);
  // Gewogen oder korrigiert: ab jetzt zählt die App, auch wenn sich nichts geändert hat
  spools.updateSpool(id, { track: "eigen" });
  return c.json(spools.getSpool(id));
});
/** Spule ins Fach legen und das Fach am Drucker einstellen; Ergebnis je Fach in `pushed` (Profilname oder Fehler) */
async function pushSlot(printerId: number, tray: number, spoolId: number): Promise<{ tray: number; label: string; ok: boolean; text: string }> {
  const s = spools.getSpool(spoolId);
  const label = spools.trayLabel(tray);
  if (!s || s.rfid) return { tray, label, ok: true, text: "" };
  try {
    return { tray, label, ok: true, text: await pushTray(printerId, tray, s) };
  } catch (e) {
    return { tray, label, ok: false, text: (e as Error).message };
  }
}

api.put("/spools/:id/slot", async (c) => {
  const id = idParam(c) ?? 0;
  const s = spools.getSpool(id);
  if (!s) return c.json({ error: "Spule nicht gefunden" }, 404);
  const b = await body(
    c,
    z.object({ printer_id: z.number().int().positive(), tray: z.number().int().min(0).max(1023), swap: z.boolean().optional() }).nullable(),
  );
  if (b instanceof Response) return b;
  if (b && !store.printerRow(b.printer_id)) return c.json({ error: "Drucker nicht gefunden" }, 404);
  if (b && s.rfid) return c.json({ error: "Bambu-Spulen mit Chip legt der Drucker selbst ins Fach." }, 400);
  if (b && chipTrays(b.printer_id).has(b.tray)) return c.json({ error: "In diesem Fach steckt eine Bambu-Spule mit Chip." }, 400);
  const pushed: Awaited<ReturnType<typeof pushSlot>>[] = [];
  if (b) {
    // Tauschen: die Spule im Zielfach wandert ins bisherige Fach der gezogenen Spule
    const other = spools.spoolAt(b.printer_id, b.tray);
    const from = s.printer_id != null && s.tray != null ? { printer_id: s.printer_id, tray: s.tray } : null;
    spools.setSlot(id, b.printer_id, b.tray);
    if (b.swap && other && other !== id && from && !chipTrays(from.printer_id).has(from.tray)) {
      spools.setSlot(other, from.printer_id, from.tray);
      pushed.push(await pushSlot(from.printer_id, from.tray, other));
    }
    pushed.unshift(await pushSlot(b.printer_id, b.tray, id));
  } else spools.setSlot(id, null, null);
  return c.json({ ...spools.getSpool(id)!, pushed });
});

// Neue Sorte per Link (Anthropic-API): NDJSON mit ping alle 15 s gegen das Zeitlimit des Proxys, no-transform hält gzip fern
api.post("/spools/scrape", async (c) => {
  const b = await body(c, z.object({ url: z.string().trim().url().max(2000) }));
  if (b instanceof Response) return b;
  c.header("content-type", "application/x-ndjson; charset=utf-8");
  c.header("cache-control", "no-cache, no-transform");
  c.header("x-accel-buffering", "no");
  return stream(c, async (s) => {
    const ac = new AbortController();
    s.onAbort(() => ac.abort());
    let chain: Promise<unknown> = Promise.resolve();
    const emit = (e: object) => {
      if (ac.signal.aborted) return;
      chain = chain.then(() => s.writeln(JSON.stringify(e))).catch(() => ac.abort());
    };
    emit({ t: "ping" });
    const ping = setInterval(() => emit({ t: "ping" }), 15_000);
    try {
      emit({ t: "done", draft: await scrapeFilament(b.url, ac.signal) });
    } catch (e) {
      const err = e instanceof ScrapeError ? e : new ScrapeError(e instanceof Error ? e.message : String(e), 500);
      if (!ac.signal.aborted) console.error("scrape:", err.message);
      emit({ t: "error", message: err.message, status: err.status });
    } finally {
      clearInterval(ping);
    }
    await chain;
  });
});

/** Modell per Link (Printables mit Dateien, andere Seiten mit Angaben und Bildern); NDJSON mit Status und Ping wie beim Filament */
api.post("/models/import", async (c) => {
  const b = await body(c, z.object({ url: z.string().trim().url().max(2000) }));
  if (b instanceof Response) return b;
  c.header("content-type", "application/x-ndjson; charset=utf-8");
  c.header("cache-control", "no-cache, no-transform");
  c.header("x-accel-buffering", "no");
  return stream(c, async (s) => {
    const ac = new AbortController();
    s.onAbort(() => ac.abort());
    let chain: Promise<unknown> = Promise.resolve();
    const emit = (e: object) => {
      if (ac.signal.aborted) return;
      chain = chain.then(() => s.writeln(JSON.stringify(e))).catch(() => ac.abort());
    };
    emit({ t: "ping" });
    const ping = setInterval(() => emit({ t: "ping" }), 15_000);
    try {
      await importModel(b.url, emit, ac.signal);
    } catch (e) {
      const err = e instanceof ScrapeError ? e : new ScrapeError(e instanceof Error ? e.message : String(e), 500);
      if (!ac.signal.aborted) console.error("Modell-Import:", err.message);
      emit({ t: "error", message: err.message, status: err.status });
    } finally {
      clearInterval(ping);
    }
    await chain;
  });
});

// Slicen im Server (OrcaSlicer-CLI): Profile je Drucker, dann Datei → .gcode.3mf im selben Modell
api.get("/slicer", async (c) => {
  if (!slicerAvailable()) return c.json({ available: false });
  const printer = store.printerRow(Number(c.req.query("printer_id")) || 0) ?? store.printerRows()[0];
  if (!printer) return c.json({ available: true, printer: null });
  try {
    const nozzle = c.req.query("nozzle") || nozzleOf(printer.id) || "0.4";
    const fid = Number(c.req.query("file_id")) || 0;
    const installed = nozzleInfo(printer.id); // verbaute Düse laut Drucker, null = nicht verbunden
    return c.json({ available: true, engine: slicerName(), printer: printer.id, nozzle, installed, ...processes(printer.model, nozzle), slots: fid ? await sourceSlots(fid) : [] });
  } catch (e) {
    const err = e instanceof SliceError ? e : new SliceError((e as Error).message, 500);
    return c.json({ error: err.message }, err.status as 400);
  }
});

api.post("/files/:id/slice", async (c) => {
  const id = idParam(c);
  const b = await body(
    c,
    z.object({
      printer_id: z.number().int(),
      nozzle: z.string().regex(/^\d\.\d$/),
      process: z.string().min(1).max(200),
      trays: z.array(z.number().int().nullable()).max(16),
      support: z.enum(["aus", "normal", "baum"]),
      brim: z.boolean(),
      infill: z.number().min(0).max(100).nullable(),
      pattern: z.enum(["grid", "gyroid", "honeycomb", "cubic", "triangles", "lightning", "zig-zag"]).nullable().optional(),
      walls: z.number().int().min(1).max(10).nullable().optional(),
      orient: z.boolean(),
      bed: z.string().max(40),
      plate: z.number().int().min(1).max(200).nullable().optional(), // nur diese Platte einer Projekt-3MF
      flush: z.number().min(0.3).max(1.5).nullable().optional(), // Spülmenge beim Farbwechsel (1 = wie Bambu Studio)
      copies: z.number().int().min(1).max(MAX_COPIES).nullable().optional(), // Anzahl Exemplare, ordnet die CLI an
      preview: z.boolean().optional(), // nur rechnen (Gramm, Zeit), Ergebnis bleibt für „Slicen“ liegen
      compare: z.boolean().optional(), // Vorschau des Standards zum Vergleich, bricht die laufende nicht ab
    }),
  );
  if (b instanceof Response) return b;
  const printer = store.printerRow(b.printer_id);
  if (!id || !printer) return c.json({ error: "Datei oder Drucker nicht gefunden" }, 404);
  const trays = (() => {
    try {
      return live(printer.id).trays;
    } catch {
      return [];
    }
  })();
  c.header("content-type", "application/x-ndjson; charset=utf-8");
  c.header("cache-control", "no-cache, no-transform");
  c.header("x-accel-buffering", "no");
  return stream(c, async (s) => {
    const ac = new AbortController();
    s.onAbort(() => ac.abort());
    let chain: Promise<unknown> = Promise.resolve();
    const emit = (e: object) => {
      if (ac.signal.aborted) return;
      chain = chain.then(() => s.writeln(JSON.stringify(e))).catch(() => ac.abort());
    };
    emit({ t: "ping" });
    const ping = setInterval(() => emit({ t: "ping" }), 15_000);
    try {
      const { preview: onlyPreview, compare, ...opts } = b;
      const req = { ...opts, file_id: id, model: printer.model, trays: b.trays.map((t) => (t == null ? null : (trays.find((x) => x.id === t) ?? null))) };
      if (onlyPreview) {
        emit({ t: "done", plate: await preview(req, (text) => emit({ t: "status", text }), ac.signal, !!compare) });
        return;
      }
      const r = await slice(req, (text) => emit({ t: "status", text }), ac.signal);
      const f = db.prepare("SELECT * FROM files WHERE id = ?").get(r.id) as Record<string, unknown>;
      emit({ t: "done", file: store.toFile(f) });
    } catch (e) {
      const err = e instanceof SliceError || e instanceof FileError ? e : new SliceError(e instanceof Error ? e.message : String(e), 500);
      if (!ac.signal.aborted) console.error("Slicen:", err.message);
      emit({ t: "error", message: err.message, status: err instanceof SliceError ? err.status : 400 });
    } finally {
      clearInterval(ping);
      await chain; // auch nach dem return der Vorschau: erst alle Zeilen schreiben, dann schließt Hono den Strom
    }
  });
});

// Printables durchsuchen (öffentliche API, ohne Anmeldung); Fehler der Gegenstelle als 502
const printablesErr = (c: Context, e: unknown) => {
  const err = e instanceof ScrapeError ? e : new ScrapeError(`Printables nicht erreichbar: ${(e as Error).message}`, 502);
  return c.json({ error: err.message }, err.status as 400);
};
api.get("/printables/search", async (c) => {
  const order = PRINTABLES_ORDER.find((o) => o === c.req.query("order")) ?? "popular";
  const offset = Math.max(0, Math.min(10_000, Number(c.req.query("offset")) || 0));
  try {
    return c.json(await printablesSearch((c.req.query("q") ?? "").trim().slice(0, 200), order, offset));
  } catch (e) {
    return printablesErr(c, e);
  }
});
api.get("/printables/:id", async (c) => {
  if (!/^\d+$/.test(c.req.param("id"))) return c.json({ error: "Ungültige ID" }, 400);
  try {
    return c.json(await printablesDetail(c.req.param("id")));
  } catch (e) {
    return printablesErr(c, e);
  }
});
api.get("/printables/:id/files/:file", async (c) => {
  const type = (["stl", "gcode", "other"] as const).find((t) => t === c.req.query("type"));
  if (!/^\d+$/.test(c.req.param("id")) || !/^\d+$/.test(c.req.param("file")) || !type) return c.json({ error: "Ungültige Datei" }, 400);
  try {
    return c.json({ link: await printablesLink(c.req.param("id"), c.req.param("file"), type) });
  } catch (e) {
    return printablesErr(c, e);
  }
});

// MakerWorld: Suche und Modelle öffentlich, Dateien mit Bambu-Konto
const mwErr = (c: Context, e: unknown) => {
  const err = e instanceof ScrapeError || e instanceof BambuError ? e : new ScrapeError(`MakerWorld nicht erreichbar: ${(e as Error).message}`, 502);
  return c.json({ error: err.message }, err.status as 400);
};
api.get("/makerworld/search", async (c) => {
  const order = MW_ORDER.find((o) => o === c.req.query("order")) ?? "";
  const offset = Math.max(0, Math.min(10_000, Number(c.req.query("offset")) || 0));
  try {
    return c.json(await mwSearch((c.req.query("q") ?? "").trim().slice(0, 200), order, offset));
  } catch (e) {
    return mwErr(c, e);
  }
});
api.get("/makerworld/:id", async (c) => {
  if (!/^\d+$/.test(c.req.param("id"))) return c.json({ error: "Ungültige ID" }, 400);
  try {
    return c.json(await mwDetail(c.req.param("id")));
  } catch (e) {
    return mwErr(c, e);
  }
});
/** Modell (und 3MF eines Druckprofils) übernehmen; NDJSON wie der Link-Import */
api.post("/makerworld/:id/import", async (c) => {
  const b = await body(c, z.object({ profile: z.string().regex(/^\d+$/).nullable().optional() }));
  if (b instanceof Response) return b;
  const id = c.req.param("id");
  if (!/^\d+$/.test(id)) return c.json({ error: "Ungültige ID" }, 400);
  c.header("content-type", "application/x-ndjson; charset=utf-8");
  c.header("cache-control", "no-cache, no-transform");
  c.header("x-accel-buffering", "no");
  return stream(c, async (s) => {
    const ac = new AbortController();
    s.onAbort(() => ac.abort());
    let chain: Promise<unknown> = Promise.resolve();
    const emit = (e: object) => {
      if (ac.signal.aborted) return;
      chain = chain.then(() => s.writeln(JSON.stringify(e))).catch(() => ac.abort());
    };
    emit({ t: "ping" });
    const ping = setInterval(() => emit({ t: "ping" }), 15_000);
    try {
      await mwImport(id, b.profile ?? null, emit, ac.signal);
    } catch (e) {
      const err = e instanceof ScrapeError || e instanceof BambuError ? e : new ScrapeError(e instanceof Error ? e.message : String(e), 500);
      if (!ac.signal.aborted) console.error("MakerWorld-Import:", err.message);
      emit({ t: "error", message: err.message, status: err.status });
    } finally {
      clearInterval(ping);
      await chain;
    }
  });
});

// Bambu-Konto (nur für MakerWorld-Dateien): Passwort geht einmal an Bambu und wird nie gespeichert
api.get("/bambu/account", (c) => c.json(bambuAccount()));
api.post("/bambu/login", async (c) => {
  const b = await body(c, z.object({ email: z.string().trim().email("Das ist keine E-Mail-Adresse").max(200), password: z.string().max(200) }));
  if (b instanceof Response) return b;
  try {
    return c.json(await bambuLogin(b.email, b.password));
  } catch (e) {
    const err = e instanceof BambuError ? e : new BambuError((e as Error).message, 500);
    return c.json({ error: err.message }, err.status as 400);
  }
});
api.post("/bambu/code", async (c) => {
  const b = await body(c, z.object({ code: z.string().trim().regex(/^\d{4,8}$/, "Der Code besteht aus Ziffern") }));
  if (b instanceof Response) return b;
  try {
    return c.json(await bambuConfirm(b.code));
  } catch (e) {
    const err = e instanceof BambuError ? e : new BambuError((e as Error).message, 500);
    return c.json({ error: err.message }, err.status as 400);
  }
});
api.delete("/bambu/account", (c) => {
  bambuLogout();
  return c.json(bambuAccount());
});

// Wartung je Drucker: Intervalle nach Druckstunden und/oder Tagen
const maintSchema = z.object({
  name: z.string().trim().min(1, "Bezeichnung fehlt").max(120),
  interval_h: z.number().positive().max(100_000).nullable(),
  interval_d: z.number().positive().max(3650).nullable(),
  note: z.string().trim().max(1000),
});
api.get("/maintenance", (c) => c.json(maint.overview()));
api.post("/printers/:id/maintenance", async (c) => {
  const id = idParam(c) ?? 0;
  if (!store.printerRow(id)) return c.json({ error: "Drucker nicht gefunden" }, 404);
  const b = await body(c, maintSchema.extend({ done_hours_ago: z.number().min(0).max(100_000).optional() }));
  if (b instanceof Response) return b;
  if (!b.interval_h && !b.interval_d) return c.json({ error: "Intervall in Stunden oder Tagen fehlt" }, 400);
  return c.json({ id: maint.addTask(id, b, b.done_hours_ago ?? 0) }, 201);
});
api.put("/printers/:id/hours", async (c) => {
  const b = await body(c, z.object({ hours_base: z.number().min(0).max(100_000) }));
  if (b instanceof Response) return b;
  return maint.setHoursBase(idParam(c) ?? 0, b.hours_base) ? c.json({ ok: true }) : c.json({ error: "Drucker nicht gefunden" }, 404);
});
api.patch("/maintenance/:id", async (c) => {
  const id = idParam(c) ?? 0;
  const t = maint.getTask(id);
  if (!t) return c.json({ error: "Wartungspunkt nicht gefunden" }, 404);
  const b = await body(c, maintSchema.partial());
  if (b instanceof Response) return b;
  if (!(b.interval_h !== undefined ? b.interval_h : t.interval_h) && !(b.interval_d !== undefined ? b.interval_d : t.interval_d))
    return c.json({ error: "Intervall in Stunden oder Tagen fehlt" }, 400);
  maint.updateTask(id, b);
  return c.json({ ok: true });
});
api.post("/maintenance/:id/done", (c) => {
  const id = idParam(c) ?? 0;
  if (!maint.getTask(id)) return c.json({ error: "Wartungspunkt nicht gefunden" }, 404);
  maint.doneTask(id);
  checkMaintenance();
  return c.json({ ok: true });
});
api.delete("/maintenance/:id", (c) => (maint.deleteTask(idParam(c) ?? 0) ? c.json({ ok: true }) : c.json({ error: "Wartungspunkt nicht gefunden" }, 404)));

// Mindestbestände: Regeln je Sorte oder Farbe, Bestand rechnet die Oberfläche aus den Spulen (shared/stock.ts)
const ruleSchema = z.object({
  brand: z.string().trim().max(80), // leer = alle Marken
  line: z.string().trim().max(120),
  material: z.string().trim().max(40), // leer = alle Materialien
  color: z.string().trim().regex(/^(#[0-9A-Fa-f]{6})?$/, "Farbe als #RRGGBB").transform((x) => x.toUpperCase()),
  color_name: z.string().trim().max(80),
  min_g: z.number().min(1, "Mindestbestand fehlt").max(100_000),
  url: z.string().trim().max(2000).refine((u) => !u || /^https?:\/\//i.test(u), "Shop-Link mit http(s)://"),
});
api.get("/stock", (c) => c.json(stock.listRules()));
api.post("/stock", async (c) => {
  const b = await body(c, ruleSchema);
  if (b instanceof Response) return b;
  return c.json({ id: stock.addRule(b) }, 201);
});
api.patch("/stock/:id", async (c) => {
  const id = idParam(c) ?? 0;
  if (!stock.getRule(id)) return c.json({ error: "Mindestbestand nicht gefunden" }, 404);
  const b = await body(c, ruleSchema.partial());
  if (b instanceof Response) return b;
  stock.updateRule(id, b);
  return c.json(stock.getRule(id));
});
api.delete("/stock/:id", (c) => (stock.deleteRule(idParam(c) ?? 0) ? c.json({ ok: true }) : c.json({ error: "Mindestbestand nicht gefunden" }, 404)));

// Farbkatalog (Marken, Sorten, Farben) aus der Datenbank, in der App pflegbar
const brandSchema = z.object({
  name: z.string().trim().min(1).max(80),
  match: z.string().trim().min(2).max(40),
  url: z.string().trim().max(500),
  source: z.string().trim().max(500),
});
const lineSchema = z.object({
  material: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  profile_id: z.string().trim().max(20).nullable(),
});
const colorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  hex: z.string().trim().max(7).nullable(),
  code: z.string().trim().max(20).nullable(),
});
const catalogOk = (c: Context, fn: () => unknown, status: 200 | 201 = 200) => {
  try {
    const r = fn();
    return c.json(typeof r === "number" ? { id: r } : { ok: true }, status);
  } catch (e) {
    if (e instanceof catalog.CatalogError) return c.json({ error: e.message }, 400);
    return fail(c, e);
  }
};
api.get("/catalog", (c) => c.json(catalog.readCatalog()));
api.post("/catalog/brands", async (c) => {
  const b = await body(c, brandSchema.partial().required({ name: true }));
  if (b instanceof Response) return b;
  return catalogOk(c, () => catalog.addBrand(b), 201);
});
api.patch("/catalog/brands/:id", async (c) => {
  const b = await body(c, brandSchema.partial());
  if (b instanceof Response) return b;
  return catalogOk(c, () => catalog.updateBrand(idParam(c) ?? 0, b));
});
api.delete("/catalog/brands/:id", (c) => catalogOk(c, () => catalog.deleteBrand(idParam(c) ?? 0)));
api.post("/catalog/brands/:id/lines", async (c) => {
  const b = await body(c, lineSchema.partial().required({ material: true, name: true }));
  if (b instanceof Response) return b;
  return catalogOk(c, () => catalog.addLine(idParam(c) ?? 0, b), 201);
});
api.patch("/catalog/lines/:id", async (c) => {
  const b = await body(c, lineSchema.partial());
  if (b instanceof Response) return b;
  return catalogOk(c, () => catalog.updateLine(idParam(c) ?? 0, b));
});
api.delete("/catalog/lines/:id", (c) => catalogOk(c, () => catalog.deleteLine(idParam(c) ?? 0)));
api.post("/catalog/lines/:id/colors", async (c) => {
  const b = await body(c, colorSchema.partial().required({ name: true }));
  if (b instanceof Response) return b;
  return catalogOk(c, () => catalog.addColor(idParam(c) ?? 0, b), 201);
});
api.patch("/catalog/colors/:id", async (c) => {
  const b = await body(c, colorSchema.partial());
  if (b instanceof Response) return b;
  return catalogOk(c, () => catalog.updateColor(idParam(c) ?? 0, b));
});
api.delete("/catalog/colors/:id", (c) => catalogOk(c, () => catalog.deleteColor(idParam(c) ?? 0)));

// Einstellungen je Bereich: gespeichert, wirksam, Standard und Herkunft; Secrets verlassen den Server nie, nur „…abcd“
api.get("/settings", (c) => c.json(settingsState()));
api.put("/settings/:section", async (c) => {
  const id = c.req.param("section") as SectionId;
  if (!SECTIONS.some((s) => s.id === id)) return c.json({ error: "Unbekannter Bereich" }, 404);
  const b = await body(c, z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])));
  if (b instanceof Response) return b;
  try {
    saveSection(id, b);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  return c.json(settingsState());
});
api.put("/setup", async (c) => {
  const b = await body(c, z.object({ done: z.boolean() }));
  if (b instanceof Response) return b;
  setSetupDone(b.done);
  return c.json(settingsState());
});

// Drucker
const printerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  host: z.string().trim().regex(/^[a-zA-Z0-9.-]+$/, "IP oder Hostname"),
  serial: z.string().trim().regex(/^[A-Z0-9]{8,20}$/i, "Seriennummer aus 8–20 Buchstaben/Ziffern").transform((s) => s.toUpperCase()),
  model: z.enum(PRINTER_MODELS.map((m) => m.id) as [string, ...string[]]),
  access_code: z.string().trim().regex(/^[A-Za-z0-9]{8}$/, "Zugangscode hat 8 Zeichen").optional(),
  plug: z.string().trim().regex(new RegExp(`${PLUG_RE.source}|^$`), "Steckdose als shelly:<IP> oder tasmota:<IP>").optional(),
});

/** Steckdose vor dem Speichern einmal lesen, damit Tippfehler gleich auffallen */
async function checkPlug(c: Context, plug: string | undefined, before = "") {
  if (!plug || plug === before) return null;
  try {
    await readPlug(plug);
    return null;
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
}

api.get("/printers", (c) => c.json(store.printerRows().map(store.toPrinter)));
api.get("/printers/live", (c) => c.json(liveAll()));
// Fehlertexte aller Bambu-Drucker (scripts/bambu-hms.py), ändern sich nur mit dem Image
let hmsJson: Promise<string> | undefined;
api.get("/hms", async (c) =>
  c.body(await (hmsJson ??= readFile(path.join(import.meta.dirname, "hms.json"), "utf8")), 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "max-age=3600",
  }),
);
api.post("/printers", async (c) => {
  const b = await body(c, printerSchema);
  if (b instanceof Response) return b;
  if (!b.access_code) return c.json({ error: "Zugangscode fehlt" }, 400);
  const bad = await checkPlug(c, b.plug);
  if (bad) return bad;
  try {
    await testConnection(b.host, b.serial, b.access_code);
  } catch (e) {
    return fail(c, e);
  }
  const r = db
    .prepare("INSERT INTO printers (name, host, serial, access_code, model, plug) VALUES (?, ?, ?, ?, ?, ?)")
    .run(b.name, b.host, b.serial, b.access_code, b.model, b.plug ?? "");
  syncPrinters();
  return c.json({ id: Number(r.lastInsertRowid) }, 201);
});
api.put("/printers/:id", async (c) => {
  const row = store.printerRow(idParam(c) ?? 0);
  if (!row) return c.json({ error: "Drucker nicht gefunden" }, 404);
  const b = await body(c, printerSchema);
  if (b instanceof Response) return b;
  const code = b.access_code || row.access_code;
  const bad = await checkPlug(c, b.plug, row.plug);
  if (bad) return bad;
  if (b.host !== row.host || b.serial !== row.serial || code !== row.access_code) {
    try {
      await testConnection(b.host, b.serial, code);
    } catch (e) {
      return fail(c, e);
    }
  }
  db.prepare("UPDATE printers SET name = ?, host = ?, serial = ?, access_code = ?, model = ?, plug = ? WHERE id = ?")
    .run(b.name, b.host, b.serial, code, b.model, b.plug ?? row.plug, row.id);
  syncPrinters();
  return c.json({ ok: true });
});
api.delete("/printers/:id", (c) => {
  const r = db.prepare("DELETE FROM printers WHERE id = ?").run(idParam(c) ?? 0);
  syncPrinters();
  return r.changes ? c.json({ ok: true }) : c.json({ error: "Drucker nicht gefunden" }, 404);
});
api.get("/printers/:id/live", (c) => {
  try {
    return c.json(live(idParam(c) ?? 0));
  } catch (e) {
    return fail(c, e);
  }
});
// Objekte des laufenden Drucks zum Überspringen
api.get("/printers/:id/parts", async (c) => {
  try {
    const l = live(idParam(c) ?? 0);
    const parts = l.current_print_id ? await partsOf(l.current_print_id) : null;
    return c.json(parts ? { ...parts, skipped: l.skipped } : null);
  } catch (e) {
    return fail(c, e);
  }
});
api.get("/printers/:id/parts/:print/pick.png", async (c) => {
  const p = pickPath(Number(c.req.param("print")) || 0);
  if (!existsSync(p)) return c.json({ error: "Kein Auswahlbild" }, 404);
  return c.body(await readFile(p), 200, { "content-type": "image/png", "cache-control": "private, max-age=86400" });
});
// Speicher des Druckers (SD-Karte bzw. USB-Stick)
api.get("/printers/:id/storage", async (c) => {
  try {
    return c.json(await listStorage(idParam(c) ?? 0));
  } catch (e) {
    return fail(c, e);
  }
});
api.post("/printers/:id/storage/import", async (c) => {
  const b = await body(c, z.object({ path: z.string().min(2).max(300) }));
  if (b instanceof Response) return b;
  try {
    return c.json(await importStorage(idParam(c) ?? 0, b.path));
  } catch (e) {
    return fail(c, e);
  }
});
api.delete("/printers/:id/storage", async (c) => {
  try {
    await deleteStorage(idParam(c) ?? 0, c.req.query("path") ?? "");
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});
// AMS: Filament laden/entladen, RFID neu lesen, trocknen
api.post("/printers/:id/ams/load", async (c) => {
  const b = await body(c, z.object({ tray: z.number().int().min(0).max(1023).nullable() }));
  if (b instanceof Response) return b;
  try {
    await changeFilament(idParam(c) ?? 0, b.tray);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

api.post("/printers/:id/ams/rfid", async (c) => {
  const b = await body(c, z.object({ tray: z.number().int().min(0).max(1023) }));
  if (b instanceof Response) return b;
  try {
    await readRfid(idParam(c) ?? 0, b.tray);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

api.post("/printers/:id/ams/dry", async (c) => {
  const b = await body(
    c,
    z.object({
      ams: z.number().int().min(0).max(255),
      stop: z.boolean().optional(),
      temp: z.number().int().min(0).max(90).optional(),
      hours: z.number().int().min(0).max(72).optional(),
      filament: z.string().max(40).optional(),
      rotate: z.boolean().optional(),
    }),
  );
  if (b instanceof Response) return b;
  try {
    await dryAms(idParam(c) ?? 0, b.ams, b.stop ? null : { temp: b.temp ?? 0, hours: b.hours ?? 0, filament: b.filament ?? "", rotate: !!b.rotate });
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

api.post("/printers/:id/options", async (c) => {
  const b = await body(c, z.object({ key: z.string().max(40), on: z.boolean(), level: z.string().max(20).optional(), choice: z.number().int().min(0).max(3).optional() }));
  if (b instanceof Response) return b;
  try {
    await setOption(idParam(c) ?? 0, b.key, b);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

api.post("/printers/:id/move", async (c) => {
  const b = await body(c, z.object({ axis: z.enum(["X", "Y", "Z", "E", "home"]), dist: z.number().min(-50).max(50).optional() }));
  if (b instanceof Response) return b;
  try {
    await move(idParam(c) ?? 0, b.axis, b.dist);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

api.get("/printers/:id/info", async (c) => {
  try {
    return c.json(await deviceInfo(idParam(c) ?? 0));
  } catch (e) {
    return fail(c, e);
  }
});

api.post("/printers/:id/calibrate", async (c) => {
  const b = await body(c, z.object({ bed: z.boolean(), vibration: z.boolean(), motor: z.boolean() }));
  if (b instanceof Response) return b;
  try {
    await calibrate(idParam(c) ?? 0, b);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

api.post("/printers/:id/dismiss", async (c) => {
  const b = await body(c, z.object({ kind: z.enum(["error", "hms"]), code: z.string().max(40) }));
  if (b instanceof Response) return b;
  try {
    await dismissAlert(idParam(c) ?? 0, b.kind, b.code);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

api.post("/printers/:id/control", async (c) => {
  const b = await body(
    c,
    z.object({
      action: z.enum(["pause", "resume", "stop", "light_on", "light_off", "speed", "nozzle_temp", "bed_temp", "fan", "airduct", "skip"]),
      value: z.number().int().min(0).max(320).optional(),
      index: z.number().int().min(0).max(255).optional(),
      objects: z.array(z.number().int().positive()).max(500).optional(),
    }),
  );
  if (b instanceof Response) return b;
  try {
    await control(idParam(c) ?? 0, b.action, b.value, b.index, b.objects);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});
api.post("/printers/:id/print", async (c) => {
  const b = await body(
    c,
    z.object({
      file_id: z.number().int().positive(),
      plate: z.number().int().min(1).max(64),
      use_ams: z.boolean(),
      ams_mapping: z.array(z.number().int().min(-1).max(254)).max(32),
      bed_leveling: z.union([z.boolean(), z.enum(["off", "on", "auto"])]),
      flow_cali: z.union([z.boolean(), z.enum(["off", "on", "auto"])]),
      vibration_cali: z.boolean().optional(),
      timelapse: z.boolean(),
      queue_id: z.number().int().positive().optional(),
    }),
  );
  if (b instanceof Response) return b;
  try {
    await startPrint(idParam(c) ?? 0, b);
    if (b.queue_id) removeQueue(b.queue_id);
    return c.json({ ok: true });
  } catch (e) {
    return fail(c, e);
  }
});

// Druckwarteschlange
api.get("/queue", (c) => c.json(listQueue()));
api.post("/queue", async (c) => {
  const b = await body(
    c,
    z.object({ file_id: z.number().int().positive(), plate: z.number().int().min(1).max(64), printer_id: z.number().int().positive().nullable(), note: z.string().max(500).optional() }),
  );
  if (b instanceof Response) return b;
  const f = db.prepare("SELECT kind FROM files WHERE id = ?").get(b.file_id) as { kind: string } | undefined;
  if (f?.kind !== "gcode3mf") return c.json({ error: "Nur geslicte .gcode.3mf-Dateien lassen sich drucken" }, 400);
  return c.json({ id: addQueue(b.file_id, b.plate, b.printer_id, b.note ?? "") });
});
api.put("/queue/order", async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.number().int().positive()).max(500) }));
  if (b instanceof Response) return b;
  orderQueue(b.ids);
  return c.json({ ok: true });
});
api.delete("/queue/:id", (c) => (removeQueue(idParam(c) ?? 0) ? c.json({ ok: true }) : c.json({ error: "Nicht gefunden" }, 404)));

// Kamera als MJPEG-Strom (für <img>) und Einzelbild
api.get("/printers/:id/camera", (c) => {
  const row = store.printerRow(idParam(c) ?? 0);
  const cam = row && camera(row);
  if (!cam) return c.json({ error: "Keine Kamera" }, 404);
  c.header("content-type", "multipart/x-mixed-replace; boundary=frame");
  c.header("cache-control", "no-store");
  // Hinter einem Reverse-Proxy (nginx) sonst gepuffert: Bilder kämen verzögert oder gar nicht
  c.header("x-accel-buffering", "no");
  return stream(c, async (s) => {
    let un = () => {};
    const closed = new Promise<void>((res) => {
      s.onAbort(() => (un(), res()));
      const end = () => (un(), res());
      cam.ends.add(end);
      un = () => cam.ends.delete(end);
    });
    const send = (jpg: Buffer) =>
      void s.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`), jpg, Buffer.from("\r\n")])).catch(() => un());
    if (cam.last) send(cam.last);
    const unEnd = un;
    const unSub = cam.subscribe(send);
    un = () => (unEnd(), unSub());
    await closed;
  });
});
api.get("/printers/:id/snapshot", async (c) => {
  const row = store.printerRow(idParam(c) ?? 0);
  if (!row) return c.json({ error: "Drucker nicht gefunden" }, 404);
  const jpg = await grabFrame(row, 8000);
  if (!jpg) return c.json({ error: camera(row)?.error ?? "Keine Kamera" }, 502);
  return new Response(new Uint8Array(jpg), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
});

app.use("/api/*", compress({ encoding: "gzip" }));
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Nicht gefunden" }, 404));

// Oberfläche aus dist/: index.html nie cachen, Assets mit Hash dauerhaft
const DIST = path.resolve("dist");
app.use("/assets/*", async (c, next) => {
  await next();
  c.header("cache-control", "public, max-age=31536000, immutable");
});
const index = async (c: Context) => {
  const p = path.join(DIST, "index.html");
  if (!existsSync(p)) return c.text("Oberfläche nicht gebaut: npm run build", 503);
  c.header("cache-control", "no-cache");
  return c.html(await readFile(p, "utf8"));
};
app.get("/", index);
app.get("/index.html", index);
app.use("/*", serveStatic({ root: path.relative(process.cwd(), DIST) || "." }));
app.get("*", index);

catalog.seedCatalog(); // vor allem, was Farbnamen vergibt (Druckerabgleich, fillColorNames)
spools.fillColorNames();
checkMaintenance(); // merkt sich, was beim Start schon fällig ist; stündlich wegen Intervallen in Tagen
setInterval(checkMaintenance, 3_600_000).unref();
checkLowSpools(); // merkt sich, welche Spulen beim Start schon fast leer sind
printerFromEnv();
syncPrinters();
void upgradeMeta();

const port = Number(process.env.PORT ?? 8795);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" }, () => console.log(`Druckwerk auf :${port}`));
// Große Uploads dürfen dauern
(server as unknown as { requestTimeout: number }).requestTimeout = 0;

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    stopAll();
    server.close();
    process.exit(0);
  });
