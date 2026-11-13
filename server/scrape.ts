// Neue Filamentsorte per Link: Shopseite vorab laden, das Modell liest alle Angaben und wählt das passende Bambu-Studio-Profil.
// Key und Modell aus den Einstellungen (Bereich „import“), sonst ANTHROPIC_API_KEY bzw. SCRAPE_MODEL.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaTool, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { PROFILES, profileById } from "../shared/profiles.ts";
import type { SpoolDraft } from "../shared/types.ts";
import { setting, settingWithSource } from "./settings.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

export class ScrapeError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}


// ---------- Shopseite vorab ----------

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

async function fetchText(url: string, accept: string, timeoutMs = 15_000) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept, "accept-language": "de-DE,de;q=0.9,en;q=0.7" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? { text: (await r.text()).slice(0, 3_000_000), url: r.url || url } : null;
  } catch {
    return null;
  }
}

async function prefetch(url: string): Promise<string | null> {
  const page = await fetchText(url, "text/html,application/xhtml+xml");
  if (!page) return null;
  const html = page.text;
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const key = m[0].match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = m[0].match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && content && !meta[key] && /^(og:|product:|description|price)/.test(key)) meta[key] = decode(content).slice(0, 600);
  }
  const jsonld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!.trim().slice(0, 8000)).slice(0, 4);
  // Shopify: Varianten mit Preisen (compare_at_price = Normalpreis bei Angeboten)
  let shopify = "";
  const u = new URL(page.url);
  if (/\/products\/[^/]+\/?$/.test(u.pathname)) {
    const js = await fetchText(`${u.origin}${u.pathname.replace(/\/$/, "")}.js`, "application/json", 8000);
    try {
      const p = js ? (JSON.parse(js.text) as { title?: string; vendor?: string; variants?: { id?: number; title?: string; price?: number; compare_at_price?: number | null; available?: boolean }[] }) : null;
      if (p)
        shopify = JSON.stringify({
          title: p.title,
          vendor: p.vendor,
          variants: (p.variants ?? []).slice(0, 60).map((v) => ({ id: v.id, title: v.title, price_eur: v.price != null ? v.price / 100 : null, regular_eur: v.compare_at_price ? v.compare_at_price / 100 : null, available: v.available })),
        });
    } catch {
      /* keine Shopify-Seite */
    }
  }
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/td|\/th)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 16_000);
  return [
    `Vorab geladene Seite (${page.url}):`,
    `<title>${title}</title>`,
    `<meta>${JSON.stringify(meta)}</meta>`,
    shopify && `<shopify_product>${shopify}</shopify_product>`,
    jsonld.length ? `<json_ld>${jsonld.join("\n")}</json_ld>` : "",
    `<seitentext>${text}</seitentext>`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Modell ----------

const PROFILE_LIST = PROFILES.map((p) => `${p.id} ${p.name} (${p.type}, ${p.nozzle_min}–${p.nozzle_max} °C)`).join("\n");

const SYSTEM = `Du liest Produktseiten von 3D-Druck-Filament und trägst die Angaben über das Werkzeug save_filament in eine Filament-Bibliothek ein.
Gedruckt wird auf einem Bambu Lab P2S mit AMS. Bambu-Drucker laufen am besten mit den Bambu-Lab-Profilen, deshalb wählst du für jedes Filament,
auch von Sunlu, eSun, Elegoo, Polymaker und Co., das am besten passende Profil mit Hersteller „Bambu Lab“ aus der Liste:
matt → Bambu PLA Matte, PLA/PLA+/Basic → Bambu PLA Basic, Silk → Bambu PLA Silk+ (bzw. Silk), High Speed PLA → Bambu PLA Basic,
PETG → Bambu PETG HF (Basic, wenn es ausdrücklich kein Schnelldruck-PETG ist), Marmor/Holz/Glitzer/Glow → die passende Bambu-PLA-Sorte,
CF/GF-Varianten → die entsprechende Bambu-CF-Sorte, TPU 95A → Bambu TPU 95A HF, ABS → Bambu ABS, ASA → Bambu ASA.
Nur wenn kein Bambu-Profil sinnvoll passt (z. B. PP, PCTG, PE), nimm das Generic-Profil. Begründe die Wahl in einem Satz in profile_reason.

Regeln:
- Nur Angaben von der Seite (oder vom Hersteller), nichts erfinden. Unbekannt: null bzw. leerer String.
- brand: Hersteller (z. B. „Sunlu“, „eSun“). material: Grundmaterial in Großbuchstaben wie PLA, PETG, ABS, ASA, TPU, PLA-CF, PETG-CF.
  name: die Sorte ohne Hersteller, z. B. „PLA Matte“, „PLA+ 2.0“, „Silk PLA“.
- Farbe: Wählt der Link eine Variante (z. B. ?variant=…), nimm deren Farbe. color_hex ist dein bester Hex-Wert für die Farbe (#RRGGBB).
  colors: alle Farben, die die Seite anbietet, mit Hex-Schätzung (höchstens 40), damit der Nutzer wählen kann.
- net_g: Filamentgewicht in Gramm (1 kg = 1000). tare_g: Gewicht der leeren Spule, nur wenn angegeben.
- price: Normalpreis in Euro für die gewählte (sonst die günstigste 1-kg-) Variante. price_sale: der reduzierte Preis, nur wenn gerade ein Angebot läuft
  (durchgestrichener Preis, compare_at_price o. ä.), sonst null.
- nozzle_min/nozzle_max und bed_temp (eine Zahl, Mitte der Angabe) in °C laut Hersteller; dry_temp in °C und dry_hours laut Trocknungsempfehlung.
- note: kurze deutsche Stichpunkte zu weiteren Angaben (Durchmesser, Toleranz, Dichte, Druckgeschwindigkeit, Lüfter, Besonderheiten), höchstens 6 Zeilen.
- Lädt die Seite nicht oder fehlen Angaben, rufe sie mit web_fetch ab oder suche das Datenblatt des Herstellers.

Profile (ID Name):
${PROFILE_LIST}`;

const SAVE: BetaTool = {
  name: "save_filament",
  description: "Trägt die gelesenen Angaben des Filaments ein.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      brand: { type: "string" },
      material: { type: "string" },
      name: { type: "string" },
      color_name: { type: "string" },
      color_hex: { type: "string" },
      colors: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, hex: { type: "string" } }, required: ["name", "hex"] } },
      net_g: { anyOf: [{ type: "number" }, { type: "null" }] },
      tare_g: { anyOf: [{ type: "number" }, { type: "null" }] },
      price: { anyOf: [{ type: "number" }, { type: "null" }] },
      price_sale: { anyOf: [{ type: "number" }, { type: "null" }] },
      nozzle_min: { anyOf: [{ type: "number" }, { type: "null" }] },
      nozzle_max: { anyOf: [{ type: "number" }, { type: "null" }] },
      bed_temp: { anyOf: [{ type: "number" }, { type: "null" }] },
      dry_temp: { anyOf: [{ type: "number" }, { type: "null" }] },
      dry_hours: { anyOf: [{ type: "number" }, { type: "null" }] },
      profile_id: { type: "string" },
      profile_reason: { type: "string" },
      note: { type: "string" },
    },
    required: [
      "brand", "material", "name", "color_name", "color_hex", "colors", "net_g", "tare_g", "price", "price_sale",
      "nozzle_min", "nozzle_max", "bed_temp", "dry_temp", "dry_hours", "profile_id", "profile_reason", "note",
    ],
  },
};

const TOOLS: BetaToolUnion[] = [
  { type: "web_search_20260209", name: "web_search", max_uses: 4 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5, max_content_tokens: 30_000 },
  SAVE,
];

const str = (max: number) => z.string().transform((v) => v.trim().slice(0, max));
const num = (min: number, max: number, round = 1) =>
  z.number().nullable().transform((v) => (v != null && v >= min && v <= max ? Math.round(v * round) / round : null));
const hex = z.string().transform((v) => (/^#?[0-9a-f]{6}$/i.test(v.trim()) ? `#${v.trim().replace("#", "").toUpperCase()}` : ""));
const toolInput = z.object({
  brand: str(80),
  material: str(40),
  name: str(80),
  color_name: str(60),
  color_hex: hex,
  colors: z.array(z.object({ name: str(60), hex })).transform((a) => a.filter((c) => c.name).slice(0, 40)),
  net_g: num(1, 50_000),
  tare_g: num(1, 5000),
  price: num(0.01, 10_000, 100),
  price_sale: num(0.01, 10_000, 100),
  nozzle_min: num(100, 500),
  nozzle_max: num(100, 500),
  bed_temp: num(0, 150),
  dry_temp: num(20, 150),
  dry_hours: num(0.5, 96, 10),
  profile_id: str(16),
  profile_reason: str(400),
  note: str(1500),
});

function apiError(e: unknown): ScrapeError {
  if (e instanceof ScrapeError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new ScrapeError("Der API-Key wird nicht akzeptiert. Bitte in den Einstellungen prüfen.", 401);
  if (e instanceof Anthropic.PermissionDeniedError) return new ScrapeError("Der API-Key hat keine Berechtigung für dieses Modell oder die Websuche.", 403);
  if (e instanceof Anthropic.RateLimitError) return new ScrapeError("Rate-Limit erreicht. Bitte in einer Minute erneut versuchen.", 429);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new ScrapeError("Zeitüberschreitung bei der Anthropic-API.", 504);
  if (e instanceof Anthropic.APIConnectionError) return new ScrapeError("Keine Verbindung zur Anthropic-API.", 502);
  if (e instanceof Anthropic.APIError) return new ScrapeError(`Anthropic-API: ${e.message}`, 502);
  return new ScrapeError(e instanceof Error ? e.message : String(e), 500);
}

export async function scrapeFilament(url: string, signal?: AbortSignal): Promise<SpoolDraft> {
  const key = settingWithSource("import", "api_key").value as string | null;
  if (!key) throw new ScrapeError("Kein API-Key für den Link-Import: in den Einstellungen eintragen.", 400);
  const model = setting<string>("import", "model");
  if (!/^https?:\/\//i.test(url)) throw new ScrapeError("Der Link ist ungültig.", 400);
  const pre = await prefetch(url);
  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: `Link: ${url}\n${pre ?? "Die Seite ließ sich vorab nicht laden. Rufe sie mit web_fetch ab oder suche das Produkt."}`,
    },
  ];
  const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 5 * 60_000 });
  try {
    for (let round = 0; round < 8; round++) {
      const res = await client.beta.messages
        .stream(
          {
            model,
            max_tokens: 16_000,
            system: SYSTEM,
            tools: TOOLS,
            output_config: { effort: "medium" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            messages,
          },
          { signal },
        )
        .finalMessage();
      if (res.stop_reason === "refusal") throw new ScrapeError("Das Modell hat die Anfrage abgelehnt. Bitte von Hand erfassen.", 422);
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      const call = res.content.find((b) => b.type === "tool_use" && b.name === "save_filament");
      if (call && call.type === "tool_use") {
        const t = toolInput.parse(call.input);
        const profile = profileById(t.profile_id);
        const [lo, hi] = [t.nozzle_min, t.nozzle_max];
        return {
          brand: t.brand,
          material: t.material.toUpperCase() || profile?.type || "PLA",
          name: t.name,
          color_name: t.color_name,
          color: t.color_hex || null,
          colors: t.colors.filter((c) => c.hex),
          net_g: t.net_g ? Math.round(t.net_g) : null,
          tare_g: t.tare_g ? Math.round(t.tare_g) : null,
          price: t.price,
          price_sale: t.price != null && t.price_sale != null && t.price_sale < t.price ? t.price_sale : null,
          nozzle_min: lo != null && hi != null && lo > hi ? hi : lo,
          nozzle_max: lo != null && hi != null && lo > hi ? lo : hi,
          bed_temp: t.bed_temp,
          dry_temp: t.dry_temp,
          dry_hours: t.dry_hours,
          profile_id: profile?.id ?? null,
          profile_reason: profile ? t.profile_reason : "",
          note: t.note,
          url,
        };
      }
      // Ohne Werkzeugaufruf beendet: einmal daran erinnern
      messages.push({ role: "assistant", content: res.content }, { role: "user", content: "Bitte trage die Angaben jetzt mit save_filament ein." });
    }
    throw new ScrapeError("Das Modell hat keine Angaben geliefert. Bitte erneut versuchen.", 502);
  } catch (e) {
    throw apiError(e);
  }
}
