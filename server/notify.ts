// Benachrichtigungen: ntfy (mit Foto als Anhang), Gotify (Markdown, Foto per Link) und Webhook (JSON, z. B. Home Assistant).
// Alle Kanäle sind lokal bzw. selbst gewählt; was eingetragen ist, bekommt jede Meldung. Fehler beim Senden landen nur im Log.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fmtDuration, fmtMoney } from "../shared/types.ts";
import { PHOTO_DIR } from "./db.ts";
import { overview } from "./maintenance.ts";
import { setting } from "./settings.ts";
import { listSpools } from "./spools.ts";
import { listQueue, nextFor } from "./queue.ts";
import * as store from "./store.ts";

export type NotifyEvent = {
  event: "print_finished" | "print_failed" | "print_canceled" | "hms" | "spool_low" | "humidity" | "maintenance" | "drying" | "queue" | "test";
  title: string;
  message: string;
  /** 1 (leise) bis 5 (dringend), wie ntfy */
  priority: number;
  tags: string[];
  /** Pfad in der App, z. B. #/verlauf */
  link?: string;
  printId?: number;
  photo?: boolean;
  data?: Record<string, unknown>;
};

export type ChannelResult = { channel: "ntfy" | "gotify" | "webhook"; ok: boolean; error?: string };

const str = (k: string) => setting<string | null>("notify", k);
const appUrl = () => str("app_url")?.replace(/\/+$/, "") ?? null;

/** Ist mindestens ein Kanal eingetragen? */
export const notifyConfigured = () => !!(str("ntfy_url") || (str("gotify_url") && str("gotify_token")) || str("webhook_url"));

async function send(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}${(await r.text().catch(() => "")).slice(0, 120).replace(/\s+/g, " ").replace(/^/, " ")}`);
}

export async function notify(e: NotifyEvent): Promise<ChannelResult[]> {
  const out: ChannelResult[] = [];
  const base = appUrl();
  const link = base && e.link ? `${base}/${e.link}` : null;
  const photoUrl = base && e.photo && e.printId ? `${base}/api/prints/${e.printId}/photo` : null;
  const jpg = e.photo && e.printId ? await readFile(path.join(PHOTO_DIR, `${e.printId}.jpg`)).catch(() => null) : null;
  const run = async (channel: ChannelResult["channel"], f: () => Promise<void>) => {
    try {
      await f();
      out.push({ channel, ok: true });
    } catch (err) {
      const msg = (err as Error).name === "TimeoutError" ? "keine Antwort in 15 s" : ((err as Error).cause as Error)?.message || (err as Error).message;
      console.warn(`Benachrichtigung über ${channel} fehlgeschlagen:`, msg);
      out.push({ channel, ok: false, error: msg });
    }
  };

  const ntfy = str("ntfy_url");
  if (ntfy) {
    await run("ntfy", async () => {
      // Titel und Text als Query-Parameter (Header vertragen keine Umlaute), Foto als Anhang im Body
      const q = new URLSearchParams({ title: e.title, message: e.message, priority: String(e.priority), tags: e.tags.join(",") });
      if (link) q.set("click", link);
      if (jpg) q.set("filename", `druck-${e.printId}.jpg`);
      const token = str("ntfy_token");
      await send(`${ntfy}?${q}`, {
        method: jpg ? "PUT" : "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: jpg ? new Uint8Array(jpg) : e.message,
      });
    });
  }

  const gotify = str("gotify_url");
  const gToken = str("gotify_token");
  if (gotify && gToken) {
    await run("gotify", () =>
      send(`${gotify.replace(/\/+$/, "")}/message`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-gotify-key": gToken },
        body: JSON.stringify({
          title: e.title,
          message: photoUrl ? `${e.message}\n\n![Foto](${photoUrl})` : e.message,
          priority: Math.min(10, e.priority * 2),
          extras: {
            "client::display": { contentType: "text/markdown" },
            ...(link ? { "client::notification": { click: { url: link } } } : {}),
          },
        }),
      }),
    );
  }

  const hook = str("webhook_url");
  if (hook) {
    await run("webhook", () =>
      send(hook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: "druckwerk", event: e.event, title: e.title, message: e.message, priority: e.priority, link, photo_url: jpg ? photoUrl : null, ...e.data }),
      }),
    );
  }
  return out;
}

/** Senden ohne Warten; Ergebnis nur im Log */
const fire = (e: NotifyEvent) => {
  if (notifyConfigured()) void notify(e);
};

// ---------- Anlässe ----------

let hmsText: { hms: Record<string, string>; error: Record<string, string> } | null = null;
async function texts() {
  return (hmsText ??= JSON.parse(await readFile(path.join(import.meta.dirname, "hms.json"), "utf8")));
}
/** Deutscher Text zu einem Druckfehler- bzw. Ablehnungscode (8 Hex), null = von Bambu nicht dokumentiert */
export async function errorText(code: number) {
  return (await texts()).error[code.toString(16).toUpperCase().padStart(8, "0")] ?? null;
}

/** Druck beendet (nach dem Foto aufrufen) */
export async function notifyPrint(printId: number, printerName: string) {
  const p = store.getPrint(printId);
  if (!p || p.status === "laeuft") return;
  const on = p.status === "fertig" ? setting<boolean>("notify", "on_finish") : setting<boolean>("notify", "on_fail");
  if (!on || !notifyConfigured()) return;
  const name = p.model_name || p.name || "Druck";
  const cur = setting<string>("filament", "currency");
  const cost = (p.cost_filament ?? 0) + (p.cost_energy ?? 0);
  const parts = [`${printerName}`, p.duration_s ? fmtDuration(p.duration_s) : "", cost > 0 ? `ca. ${fmtMoney(cost, cur)}` : ""].filter(Boolean);
  let message = parts.join(" · ");
  if (p.status !== "fertig") {
    message += ` · bei ${p.progress} %`;
    if (p.error_code) {
      const code = p.error_code.toString(16).toUpperCase().padStart(8, "0");
      const t = (await texts()).error[code];
      message += `\nFehler ${code}${t ? `: ${t}` : ""}`;
    }
  }
  fire({
    event: p.status === "fertig" ? "print_finished" : p.status === "fehler" ? "print_failed" : "print_canceled",
    title: p.status === "fertig" ? `Fertig: ${name}` : p.status === "fehler" ? `Fehlgeschlagen: ${name}` : `Abgebrochen: ${name}`,
    message,
    priority: p.status === "fehler" ? 4 : 3,
    tags: [p.status === "fertig" ? "white_check_mark" : p.status === "fehler" ? "x" : "stop_sign"],
    link: p.model_id ? `#/modell/${p.model_id}` : "#/verlauf",
    printId,
    photo: p.has_photo,
    data: { print_id: printId, printer: printerName, status: p.status, model_id: p.model_id, duration_s: p.duration_s, cost },
  });
}

/** Nach Druckende: nächster Eintrag der Warteschlange wartet auf ein geräumtes Bett */
export function notifyQueue(printerId: number, printerName: string) {
  if (!setting<boolean>("notify", "on_queue") || !notifyConfigured()) return;
  const q = nextFor(printerId);
  if (!q) return;
  const more = listQueue().length - 1;
  fire({
    event: "queue",
    title: `Nächster Druck: ${q.model_name}`,
    message: `${printerName} ist frei. Bett räumen und in Druckwerk starten (${q.file.name}, Platte ${q.plate}).${more > 0 ? ` Danach noch ${more}.` : ""}`,
    priority: 3,
    tags: ["arrow_forward"],
    link: "#/",
    data: { queue_id: q.id, printer: printerName, file_id: q.file.id, plate: q.plate },
  });
}

/** Neue HMS-Meldung (Stufe 1 Fatal, 2 Fehler) */
export async function notifyHms(printerName: string, code: string, severity: number) {
  if (severity > 2 || !setting<boolean>("notify", "on_hms") || !notifyConfigured()) return;
  const t = (await texts()).hms[code.replace(/_/g, "")];
  fire({
    event: "hms",
    title: `${printerName}: ${severity === 1 ? "schwerer Fehler" : "Fehler"}`,
    message: `${t ?? "Unbekannte Meldung"}\nHMS ${code}`,
    priority: severity === 1 ? 5 : 4,
    tags: ["warning"],
    link: "#/",
    data: { printer: printerName, code, severity },
  });
}

// Spule fast leer: einmal je Spule, bis sie wieder über der Schwelle liegt. Beim Start gelten schon leere als gemeldet.
let lowSeen: Set<number> | null = null;
export function checkLowSpools() {
  const limit = setting<number>("notify", "low_g") ?? 0;
  const spools = listSpools().filter((s) => !s.archived);
  const low = new Set(spools.filter((s) => limit > 0 && s.remaining_g < limit).map((s) => s.id));
  if (!lowSeen) {
    lowSeen = low;
    return;
  }
  for (const s of spools) {
    if (!low.has(s.id) || lowSeen.has(s.id)) continue;
    const title = [s.brand, s.color_name || s.name || s.material].filter(Boolean).join(" ");
    fire({
      event: "spool_low",
      title: `Spule fast leer: ${title}`,
      message: `Noch ${Math.max(0, Math.round(s.remaining_g))} g ${s.material}${s.location ? ` · ${s.location}` : ""}`,
      priority: 3,
      tags: ["hourglass"],
      link: `#/filament/${s.id}`,
      data: { spool_id: s.id, remaining_g: Math.round(s.remaining_g), material: s.material },
    });
  }
  lowSeen = low;
}

// AMS-Feuchte: einmal je Einheit, wieder scharf, wenn sie 5 % unter die Schwelle fällt. Erste Messung nach dem Start meldet nicht.
const humid = new Map<string, boolean>();
export function checkHumidity(printerId: number, printerName: string, units: { id: number; label: string; humidity: number | null }[]) {
  const max = setting<number | null>("notify", "humidity_max");
  for (const u of units) {
    if (u.humidity == null) continue;
    const key = `${printerId}:${u.id}`;
    const was = humid.get(key);
    const high = max != null && u.humidity > max;
    if (was === undefined) {
      humid.set(key, high);
      continue;
    }
    if (high && !was) {
      humid.set(key, true);
      fire({
        event: "humidity",
        title: `${u.label} zu feucht`,
        message: `${printerName}: ${u.humidity} % relative Feuchte (Grenze ${max} %). Trockenmittel tauschen oder trocknen.`,
        priority: 3,
        tags: ["droplet"],
        link: "#/",
        data: { printer: printerName, ams: u.label, humidity: u.humidity },
      });
    } else if (was && (max == null || u.humidity < max - 5)) humid.set(key, false);
  }
}

/** Automatische AMS-Trocknung gestartet bzw. nicht möglich */
export function notifyDrying(printerName: string, ams: string, message: string, ok: boolean) {
  if (!setting<boolean>("notify", "on_drying")) return;
  fire({
    event: "drying",
    title: ok ? `${ams} trocknet` : `${ams} kann nicht trocknen`,
    message: `${printerName}: ${message}`,
    priority: ok ? 2 : 3,
    tags: [ok ? "fire" : "warning"],
    link: "#/",
    data: { printer: printerName, ams, ok },
  });
}

// Wartung fällig: einmal je Punkt, bis er erledigt ist. Beim Start schon fällige gelten als gemeldet.
let maintSeen: Set<number> | null = null;
export function checkMaintenance() {
  const due = overview().flatMap((p) => p.tasks.filter((t) => t.due).map((t) => ({ p, t })));
  const ids = new Set(due.map((d) => d.t.id));
  if (maintSeen && setting<boolean>("notify", "on_maintenance")) {
    for (const { p, t } of due) {
      if (maintSeen.has(t.id)) continue;
      const by = [t.interval_h ? `${Math.round(t.hours_since)} von ${t.interval_h} h` : "", t.interval_d ? `${Math.floor(t.days_since)} von ${t.interval_d} Tagen` : ""];
      fire({
        event: "maintenance",
        title: `${p.name}: Wartung fällig`,
        message: `${t.name} (${by.filter(Boolean).join(", ")})`,
        priority: 3,
        tags: ["wrench"],
        link: "#/wartung",
        data: { printer: p.name, task_id: t.id, task: t.name, hours_since: Math.round(t.hours_since) },
      });
    }
  }
  maintSeen = ids;
}
