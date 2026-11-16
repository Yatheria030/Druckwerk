// Bambu-Konto nur für MakerWorld (Dateien laden). Anmeldung mit E-Mail und Passwort bzw. Code aus der Mail; gespeichert wird
// nur das Token samt Refresh-Token, nie das Passwort. Mit den Druckern spricht Druckwerk weiter nur im Heimnetz.
import { db } from "./db.ts";

const API = "https://api.bambulab.com/v1";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const KEY = "bambu_account";

type Stored = { token: string; refresh: string; expires: number; refresh_expires: number; email: string; name: string; avatar: string };
export type BambuAccount = { logged_in: boolean; expired: boolean; email: string; name: string; avatar: string; expires: number | null };

export class BambuError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const read = (): Stored | null => {
  const v = (db.prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined)?.value;
  try {
    return v ? (JSON.parse(v) as Stored) : null;
  } catch {
    return null;
  }
};
const write = (s: Stored | null) => {
  if (s) db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(s));
  else db.prepare("DELETE FROM settings WHERE key = ?").run(KEY);
};

async function call<T>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  let r: Response;
  try {
    r = await fetch(url, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        "user-agent": UA,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new BambuError(`Bambu nicht erreichbar: ${(e as Error).message}`, 502);
  }
  const text = await r.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: r.status === 403 ? "Bambu hat die Anfrage abgewiesen (Schutzseite)." : text.slice(0, 200) };
  }
  return { ok: r.ok, status: r.status, data: data as T };
}

type LoginReply = { accessToken?: string; refreshToken?: string; expiresIn?: number; refreshExpiresIn?: number; loginType?: string; tfaKey?: string; error?: string; message?: string };

/** Laufende Anmeldung zwischen „Anmelden“ und Code (nur im Speicher, nie mit Passwort) */
let pending: { email: string; kind: "code" | "tfa"; tfaKey?: string; at: number } | null = null;

const errText = (d: { error?: string; message?: string; code?: unknown }, fallback: string) => {
  const t = d.error || d.message || "";
  if (/password|incorrect|wrong/i.test(t)) return "E-Mail oder Passwort stimmt nicht.";
  if (/code/i.test(t) && /(invalid|expired|wrong|incorrect)/i.test(t)) return "Der Code stimmt nicht oder ist abgelaufen.";
  if (/too many|frequent|limit/i.test(t)) return "Zu viele Versuche, bitte später noch einmal.";
  return t && !/client error/i.test(t) ? `${fallback}: ${t}` : fallback;
};

async function finish(email: string, r: LoginReply): Promise<BambuAccount> {
  if (!r.accessToken) throw new BambuError("Bambu hat kein Token geschickt.", 502);
  const now = Date.now();
  const s: Stored = {
    token: r.accessToken,
    refresh: r.refreshToken ?? "",
    expires: now + (r.expiresIn ?? 90 * 86400) * 1000,
    refresh_expires: now + (r.refreshExpiresIn ?? r.expiresIn ?? 90 * 86400) * 1000,
    email,
    name: "",
    avatar: "",
  };
  const p = await call<{ name?: string; account?: string; avatar?: string }>("/user-service/my/profile", { token: s.token }).catch(() => null);
  if (p?.ok) {
    s.name = p.data.name ?? "";
    s.avatar = p.data.avatar ?? "";
  }
  write(s);
  pending = null;
  console.log("Bambu-Konto angemeldet (MakerWorld)");
  return account();
}

async function sendCode(email: string) {
  const r = await call<{ error?: string }>("/user-service/user/sendemail/code", { body: { email, type: "codeLogin" } });
  if (!r.ok) throw new BambuError(errText(r.data, "Bambu konnte keinen Code schicken"), 400);
}

/** Schritt 1: mit Passwort anmelden. Ohne Passwort oder wenn Bambu es verlangt, kommt ein Code per Mail. */
export async function login(email: string, password: string): Promise<{ step: "done"; account: BambuAccount } | { step: "code" | "tfa" }> {
  if (!password) {
    await sendCode(email);
    pending = { email, kind: "code", at: Date.now() };
    return { step: "code" };
  }
  const r = await call<LoginReply>("/user-service/user/login", { body: { account: email, password, apiError: "" } });
  if (r.data.accessToken) return { step: "done", account: await finish(email, r.data) };
  if (r.data.loginType === "verifyCode") {
    await sendCode(email);
    pending = { email, kind: "code", at: Date.now() };
    return { step: "code" };
  }
  if (r.data.loginType === "tfa" && r.data.tfaKey) {
    pending = { email, kind: "tfa", tfaKey: r.data.tfaKey, at: Date.now() };
    return { step: "tfa" };
  }
  throw new BambuError(errText(r.data, "Anmeldung abgelehnt"), r.status === 403 ? 502 : 400);
}

/** Schritt 2: Code aus der Mail bzw. der Authenticator-App */
export async function confirm(code: string): Promise<BambuAccount> {
  const p = pending;
  if (!p || Date.now() - p.at > 15 * 60_000) throw new BambuError("Die Anmeldung ist abgelaufen, bitte neu anmelden.", 409);
  if (p.kind === "code") {
    const r = await call<LoginReply>("/user-service/user/login", { body: { account: p.email, code } });
    if (!r.data.accessToken) throw new BambuError(errText(r.data, "Code abgelehnt"), 400);
    return finish(p.email, r.data);
  }
  // Zwei-Faktor: läuft über bambulab.com, das Token kommt als Cookie oder im JSON
  const res = await fetch("https://bambulab.com/api/sign-in/tfa", {
    method: "POST",
    headers: { "user-agent": UA, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ tfaKey: p.tfaKey, tfaCode: code }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e: Error) => {
    throw new BambuError(`Bambu nicht erreichbar: ${e.message}`, 502);
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("token="));
  const json = (await res.json().catch(() => ({}))) as LoginReply;
  const token = json.accessToken ?? cookie?.slice(6).split(";")[0];
  if (!token) throw new BambuError(errText(json, res.status === 403 ? "Bambu hat die Anfrage abgewiesen" : "Code abgelehnt"), 400);
  const refresh = json.refreshToken ?? res.headers.getSetCookie().find((c) => c.startsWith("refreshToken="))?.slice(13).split(";")[0];
  return finish(p.email, { ...json, accessToken: token, refreshToken: refresh });
}

export function logout() {
  write(null);
  pending = null;
}

export function account(): BambuAccount {
  const s = read();
  if (!s) return { logged_in: false, expired: false, email: "", name: "", avatar: "", expires: null };
  const expired = s.expires < Date.now() && (!s.refresh || s.refresh_expires < Date.now());
  return { logged_in: !expired, expired, email: s.email, name: s.name, avatar: s.avatar, expires: s.expires };
}

let refreshing: Promise<string | null> | null = null;
/** Gültiges Token, kurz vor Ablauf per Refresh-Token erneuert; null = nicht (mehr) angemeldet */
export async function token(): Promise<string | null> {
  const s = read();
  if (!s) return null;
  if (s.expires - Date.now() > 3 * 86400_000) return s.token;
  if (!s.refresh || s.refresh_expires < Date.now()) return s.expires > Date.now() ? s.token : null;
  refreshing ??= (async () => {
    try {
      const r = await call<LoginReply>("/user-service/user/refreshtoken", { body: { refreshToken: s.refresh } });
      if (!r.data.accessToken) return s.expires > Date.now() ? s.token : null;
      const now = Date.now();
      write({
        ...s,
        token: r.data.accessToken,
        refresh: r.data.refreshToken ?? s.refresh,
        expires: now + (r.data.expiresIn ?? 90 * 86400) * 1000,
        refresh_expires: r.data.refreshExpiresIn ? now + r.data.refreshExpiresIn * 1000 : s.refresh_expires,
      });
      return r.data.accessToken;
    } catch {
      return s.expires > Date.now() ? s.token : null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Token wurde abgewiesen (abgemeldet, Passwort geändert): als abgelaufen markieren, UI zeigt „Neu anmelden“ */
export function rejected() {
  const s = read();
  if (s) write({ ...s, expires: 0, refresh_expires: 0 });
}
