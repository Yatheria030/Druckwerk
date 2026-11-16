// Modell per Link: Printables über die öffentliche API (Angaben, Dateien, Bilder, ohne Anmeldung), MakerWorld über
// `makerworld.ts` (Dateien mit Bambu-Konto), andere Seiten (Thingiverse …) über den Claude-Import nur mit Angaben und Bildern.
import { db } from "./db.ts";
import { FileError, saveUpload } from "./files.ts";
import { makerworldId, mwImport } from "./makerworld.ts";
import { hasImportKey, ScrapeError, scrapeModelMeta } from "./scrape.ts";
import * as store from "./store.ts";

export type ImportEvent = { t: "status"; text: string } | { t: "done"; id: number; existed: boolean; files: number; note: string };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_FILE = 500 * 1024 ** 2;

/** HTML-Beschreibung als schlichter Text */
export const htmlText = (html: string) =>
  html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

/** Gleiche Quelle schon in der Bibliothek? (ohne Sprachpfad, Query und Slug-Unterschiede) */
const canon = (u: string) => {
  const p = printablesId(u);
  if (p) return `printables:${p}`;
  const mw = makerworldId(u);
  if (mw) return `makerworld:${mw}`;
  return u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
};
const printablesId = (u: string) => u.match(/printables\.com\/(?:[a-z]{2}\/)?model\/(\d+)/i)?.[1] ?? null;

function existing(url: string): number | null {
  const want = canon(url);
  const rows = db.prepare("SELECT id, source_url FROM models WHERE source_url != ''").all() as { id: number; source_url: string }[];
  return rows.find((r) => canon(r.source_url) === want)?.id ?? null;
}

/** Datei per HTTP in das Modell laden (ZIPs werden wie beim Upload ausgepackt) */
async function download(modelId: number, url: string, name: string, signal?: AbortSignal): Promise<number[]> {
  const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.any([AbortSignal.timeout(10 * 60_000), ...(signal ? [signal] : [])]) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  if (Number(r.headers.get("content-length")) > MAX_FILE) throw new Error("größer als 500 MB");
  return saveUpload(modelId, name, r.body as ReadableStream<Uint8Array>);
}

const imageName = (url: string, i: number) => {
  const ext = url.match(/\.(jpe?g|png|webp|gif)(?:$|[?#])/i)?.[1]?.toLowerCase() ?? "jpg";
  return `bild-${i + 1}.${ext}`;
};

// ---------- Printables ----------

type PrintablesFile = { id: string; name: string; fileSize: number | null };
type PrintablesPrint = {
  id: string;
  name: string;
  summary: string | null;
  description: string | null;
  license: { name: string; abbreviation: string | null } | null;
  user: { publicUsername: string } | null;
  tags: { name: string }[];
  images: { filePath: string }[];
  stls: PrintablesFile[];
  otherFiles: PrintablesFile[];
};

const GQL = "https://api.printables.com/graphql/";
async function gql<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const r = await fetch(GQL, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
  });
  if (!r.ok) throw new ScrapeError(`Printables antwortet mit HTTP ${r.status}.`, 502);
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (!j.data) throw new ScrapeError(`Printables: ${j.errors?.[0]?.message ?? "keine Daten"}`, 502);
  return j.data;
}

async function fromPrintables(id: string, emit: (e: ImportEvent) => void, signal?: AbortSignal) {
  emit({ t: "status", text: "Lese das Modell bei Printables …" });
  const { print: p } = await gql<{ print: PrintablesPrint | null }>(
    `query($id: ID!) { print(id: $id) { id name summary description license { name abbreviation } user { publicUsername }
      tags { name } images { filePath } stls { id name fileSize } otherFiles { id name fileSize } } }`,
    { id },
    signal,
  );
  if (!p) throw new ScrapeError("Das Modell gibt es bei Printables nicht (oder es ist privat).", 404);
  const desc = [p.summary?.trim(), p.description ? htmlText(p.description) : ""].filter(Boolean).join("\n\n").slice(0, 8000);
  const modelId = store.createModel({
    name: p.name.trim().slice(0, 200) || `Printables ${id}`,
    description: desc,
    tags: [...new Set(p.tags.map((t) => t.name.trim().toLowerCase()).filter(Boolean))].slice(0, 12),
    source_url: `https://www.printables.com/model/${p.id}`,
    creator: p.user?.publicUsername ?? "",
    license: p.license?.abbreviation || p.license?.name || "",
  });

  const failed: string[] = [];
  let files = 0;
  const lists: [PrintablesFile[], "stl" | "other"][] = [
    [p.stls, "stl"],
    [p.otherFiles, "other"],
  ];
  const all = lists.flatMap(([l, type]) => l.map((f) => ({ ...f, type })));
  for (const [i, f] of all.entries()) {
    if ((f.fileSize ?? 0) > MAX_FILE) {
      failed.push(`${f.name} (zu groß)`);
      continue;
    }
    emit({ t: "status", text: `Lade ${f.name} (${i + 1} von ${all.length}) …` });
    try {
      const { getDownloadLink: d } = await gql<{ getDownloadLink: { ok: boolean; output: { link: string } | null; errors: { messages: string[] }[] | null } }>(
        `mutation($id: ID!, $printId: ID!) { getDownloadLink(id: $id, printId: $printId, fileType: ${f.type}, source: model_detail) {
          ok errors { messages } output { link } } }`,
        { id: f.id, printId: p.id },
        signal,
      );
      if (!d.ok || !d.output) throw new Error(d.errors?.[0]?.messages?.[0] ?? "kein Link");
      files += (await download(modelId, d.output.link, f.name, signal)).length;
    } catch (e) {
      failed.push(`${f.name} (${e instanceof FileError ? e.message : (e as Error).message})`);
    }
  }

  let cover: number | null = null;
  const imgs = p.images.slice(0, 4);
  for (const [i, img] of imgs.entries()) {
    emit({ t: "status", text: `Lade Bild ${i + 1} von ${imgs.length} …` });
    try {
      const [fid] = await download(modelId, `https://media.printables.com/${img.filePath.replace(/^\/+/, "")}`, imageName(img.filePath, i), signal);
      cover ??= fid ?? null;
    } catch {
      /* Bild fehlt: egal */
    }
  }
  if (cover) store.updateModel(modelId, { cover_file_id: cover });
  const note = failed.length ? `Nicht geladen: ${failed.join(", ")}` : "";
  return { id: modelId, files, note };
}

// ---------- andere Seiten ----------

async function fromPage(url: string, emit: (e: ImportEvent) => void, signal?: AbortSignal) {
  if (!hasImportKey()) throw new ScrapeError("Für diese Seite braucht der Import einen API-Key (Einstellungen → Import). Direkt ohne Key gehen Printables und MakerWorld.", 400);
  emit({ t: "status", text: "Lese die Seite, das dauert bis zu einer Minute …" });
  const m = await scrapeModelMeta(url, signal);
  if (!m.name) throw new ScrapeError("Auf der Seite war kein Modell zu erkennen.", 422);
  const modelId = store.createModel({ name: m.name, description: m.description, tags: m.tags, source_url: url, creator: m.creator, license: m.license });
  let cover: number | null = null;
  for (const [i, img] of m.images.entries()) {
    emit({ t: "status", text: `Lade Bild ${i + 1} von ${m.images.length} …` });
    try {
      const [fid] = await download(modelId, img, imageName(img, i), signal);
      cover ??= fid ?? null;
    } catch {
      /* Bild gesperrt oder weg */
    }
  }
  if (cover) store.updateModel(modelId, { cover_file_id: cover });
  return { id: modelId, files: 0, note: "Dateien von der Seite laden und hier ins Modell ziehen." };
}

export async function importModel(url: string, emit: (e: ImportEvent) => void, signal?: AbortSignal): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new ScrapeError("Der Link ist ungültig.", 400);
  const known = existing(url);
  if (known) return emit({ t: "done", id: known, existed: true, files: 0, note: "Das Modell ist schon in der Bibliothek." });
  const mw = makerworldId(url);
  if (mw) return mwImport(mw, null, emit, signal);
  const pid = printablesId(url);
  const r = pid ? await fromPrintables(pid, emit, signal) : await fromPage(url, emit, signal);
  emit({ t: "done", id: r.id, existed: false, files: r.files, note: r.note });
}

// ---------- Printables durchsuchen (Tab in der Bibliothek) ----------

export const PRINTABLES_ORDER = ["best_match", "popular", "latest", "rating", "makes_count"] as const;
const media = (p: string | null | undefined) => (p ? `https://media.printables.com/${p.replace(/^\/+/, "")}` : null);
/** Verkleinertes Bild wie auf printables.com: <ordner>/thumbs/inside/<größe>/<endung>/<name>.webp (320x240, 640x480, 1280x960) */
const thumb = (p: string | null | undefined, size: "320x240" | "640x480" | "1280x960") => {
  const m = p?.replace(/^\/+/, "").match(/^(.*)\/([^/]+)\.([a-z0-9]+)$/i);
  return m ? `https://media.printables.com/${m[1]}/thumbs/inside/${size}/${m[3]!.toLowerCase()}/${m[2]}.webp` : media(p);
};

/** Printables-IDs, die schon als Modell in der Bibliothek liegen (ID → Modell) */
function importedPrintables(): Map<string, number> {
  const rows = db.prepare("SELECT id, source_url FROM models WHERE source_url LIKE '%printables.com%'").all() as { id: number; source_url: string }[];
  return new Map(rows.flatMap((r) => (printablesId(r.source_url) ? [[printablesId(r.source_url)!, r.id] as const] : [])));
}

type SearchItem = {
  id: string;
  name: string;
  image: { filePath: string } | null;
  likesCount: number;
  downloadCount: number;
  makesCount: number;
  user: { publicUsername: string } | null;
  premium: boolean;
  price: number | null;
  datePublished: string | null;
  category: { name: string } | null;
};

export async function printablesSearch(query: string, order: (typeof PRINTABLES_ORDER)[number], offset: number, signal?: AbortSignal) {
  const { searchPrints2: r } = await gql<{ searchPrints2: { totalCount: number; items: SearchItem[] } }>(
    `query($q: String!, $o: SearchChoicesEnum, $n: Int, $off: Int) { searchPrints2(query: $q, ordering: $o, limit: $n, offset: $off) { totalCount
      items { id name image { filePath } likesCount downloadCount makesCount user { publicUsername } premium price datePublished category { name } } } }`,
    { q: query, o: order, n: 24, off: offset },
    signal,
  );
  const have = importedPrintables();
  return {
    total: r.totalCount,
    items: r.items.map((p) => ({
      id: p.id,
      name: p.name,
      image: thumb(p.image?.filePath, "640x480"),
      likes: p.likesCount,
      downloads: p.downloadCount,
      makes: p.makesCount,
      creator: p.user?.publicUsername ?? "",
      paid: p.premium || (p.price ?? 0) > 0,
      published: p.datePublished,
      category: p.category?.name ?? "",
      model_id: have.get(p.id) ?? null,
    })),
  };
}

type DetailFile = { id: string; name: string; fileSize: number | null; filePreviewPath?: string | null };
export async function printablesDetail(id: string, signal?: AbortSignal) {
  const { print: p } = await gql<{
    print:
      | (SearchItem & {
          summary: string | null;
          description: string | null;
          license: { name: string; abbreviation: string | null } | null;
          tags: { name: string }[];
          images: { filePath: string }[];
          stls: DetailFile[];
          gcodes: DetailFile[];
          otherFiles: DetailFile[];
        })
      | null;
  }>(
    `query($id: ID!) { print(id: $id) { id name summary description likesCount downloadCount makesCount premium price datePublished
      user { publicUsername } category { name } license { name abbreviation } tags { name } images { filePath }
      stls { id name fileSize filePreviewPath } gcodes { id name fileSize } otherFiles { id name fileSize } } }`,
    { id },
    signal,
  );
  if (!p) throw new ScrapeError("Das Modell gibt es bei Printables nicht (oder es ist privat).", 404);
  const files = (l: DetailFile[], type: "stl" | "gcode" | "other") =>
    l.map((f) => ({ id: f.id, name: f.name, size: f.fileSize, type, preview: thumb(f.filePreviewPath, "320x240") }));
  return {
    id: p.id,
    name: p.name,
    url: `https://www.printables.com/model/${p.id}`,
    summary: p.summary?.trim() ?? "",
    description: p.description ? htmlText(p.description).slice(0, 8000) : "",
    creator: p.user?.publicUsername ?? "",
    license: p.license?.abbreviation || p.license?.name || "",
    category: p.category?.name ?? "",
    tags: p.tags.map((t) => t.name),
    images: p.images.slice(0, 20).map((i) => ({ large: thumb(i.filePath, "1280x960")!, small: thumb(i.filePath, "320x240")! })),
    likes: p.likesCount,
    downloads: p.downloadCount,
    makes: p.makesCount,
    paid: p.premium || (p.price ?? 0) > 0,
    published: p.datePublished,
    files: [...files(p.stls, "stl"), ...files(p.gcodes, "gcode"), ...files(p.otherFiles, "other")],
    model_id: importedPrintables().get(p.id) ?? null,
  };
}

/** Frischer, kurz gültiger Download-Link einer Datei (für „In Orca öffnen“ und „Herunterladen“) */
export async function printablesLink(printId: string, fileId: string, type: "stl" | "gcode" | "other", signal?: AbortSignal) {
  const { getDownloadLink: d } = await gql<{ getDownloadLink: { ok: boolean; output: { link: string } | null; errors: { messages: string[] }[] | null } }>(
    `mutation($id: ID!, $printId: ID!) { getDownloadLink(id: $id, printId: $printId, fileType: ${type}, source: model_detail) { ok errors { messages } output { link } } }`,
    { id: fileId, printId },
    signal,
  );
  if (!d.ok || !d.output) throw new ScrapeError(`Printables gibt die Datei nicht heraus: ${d.errors?.[0]?.messages?.[0] ?? "kein Link"}`, 502);
  return d.output.link;
}
