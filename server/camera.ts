// Kamera der Bambu-Drucker.
// A1/P1: TLS auf Port 6000, 80-Byte-Anmeldung, danach Bilder als 16-Byte-Kopf (Länge LE) + JPEG.
// X1/H2/P2: RTSPS auf Port 322, braucht ffmpeg im Container (wird nur genutzt, wenn vorhanden).
import { spawn } from "node:child_process";
import tls from "node:tls";
import { cameraOf } from "../shared/types.ts";
import type { PrinterRow } from "./store.ts";

type Listener = (jpg: Buffer) => void;

class TcpCamera {
  sock: tls.TLSSocket | null = null;
  buf = Buffer.alloc(0);
  listeners = new Set<Listener>();
  /** Wird bei einem Verbindungsfehler gerufen, damit offene Ströme enden und die Oberfläche es anzeigen kann */
  ends = new Set<() => void>();
  last: Buffer | null = null;
  idle: NodeJS.Timeout | null = null;
  error: string | null = null;

  constructor(public row: PrinterRow) {}

  open() {
    if (this.sock) return;
    const auth = Buffer.alloc(80);
    auth.writeUInt32LE(0x40, 0);
    auth.writeUInt32LE(0x3000, 4);
    auth.write("bblp", 16, "ascii");
    auth.write(this.row.access_code, 48, "ascii");
    this.sock = tls.connect({ host: this.row.host, port: 6000, rejectUnauthorized: false, timeout: 10_000 }, () => this.sock?.write(auth));
    this.sock.on("data", (d: Buffer) => this.onData(d));
    this.sock.on("timeout", () => this.close("Kamera antwortet nicht"));
    this.sock.on("error", (e) => this.close(e.message));
    this.sock.on("close", () => this.close());
  }

  onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 16) {
      const len = this.buf.readUInt32LE(0);
      if (len <= 0 || len > 5_000_000) {
        this.buf = Buffer.alloc(0);
        return;
      }
      if (this.buf.length < 16 + len) return;
      const jpg = this.buf.subarray(16, 16 + len);
      this.buf = this.buf.subarray(16 + len);
      if (jpg[0] === 0xff && jpg[1] === 0xd8) {
        this.last = Buffer.from(jpg);
        this.error = null;
        for (const l of this.listeners) l(this.last);
      }
    }
  }

  close(err?: string) {
    if (err) this.error = err;
    this.sock?.destroy();
    this.sock = null;
    this.buf = Buffer.alloc(0);
    if (err) for (const e of this.ends) e();
  }

  subscribe(l: Listener) {
    if (this.idle) clearTimeout(this.idle);
    this.listeners.add(l);
    this.open();
    return () => {
      this.listeners.delete(l);
      if (!this.listeners.size) this.idle = setTimeout(() => !this.listeners.size && this.close(), 5000);
    };
  }
}

class RtspCamera extends TcpCamera {
  proc: ReturnType<typeof spawn> | null = null;

  override open() {
    if (this.proc) return;
    const url = `rtsps://bblp:${encodeURIComponent(this.row.access_code)}@${this.row.host}:322/streaming/live/1`;
    const p = spawn("ffmpeg", ["-loglevel", "error", "-rtsp_transport", "tcp", "-i", url, "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "6", "-r", "4", "-"]);
    this.proc = p;
    p.on("error", () => this.close("ffmpeg fehlt im Container: Kamera für X1/H2/P2 nicht verfügbar"));
    // Beendet sich ffmpeg von selbst (Port 322 zu, LAN-Liveview aus), enden auch die Ströme
    p.on("exit", () => this.proc === p && this.close("Kamera nicht erreichbar"));
    p.stdout.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      for (;;) {
        const s = this.buf.indexOf(Buffer.from([0xff, 0xd8]));
        const e = this.buf.indexOf(Buffer.from([0xff, 0xd9]), s + 2);
        if (s < 0 || e < 0) break;
        this.last = Buffer.from(this.buf.subarray(s, e + 2));
        this.buf = this.buf.subarray(e + 2);
        for (const l of this.listeners) l(this.last);
      }
    });
  }

  override close(err?: string) {
    if (err) this.error = err;
    const p = this.proc;
    this.proc = null;
    p?.kill();
    this.buf = Buffer.alloc(0);
    if (err) for (const e of this.ends) e();
  }
}

const cams = new Map<number, TcpCamera>();

export function camera(row: PrinterRow): TcpCamera | null {
  const kind = cameraOf(row.model);
  if (kind === "none" || !row.access_code) return null;
  let c = cams.get(row.id);
  if (c && (c.row.host !== row.host || c.row.access_code !== row.access_code || c.row.model !== row.model)) {
    c.close();
    c = undefined;
  }
  if (!c) {
    c = kind === "tcp" ? new TcpCamera(row) : new RtspCamera(row);
    cams.set(row.id, c);
  }
  return c;
}

/** Ein einzelnes Bild (Schnappschuss, Foto am Druckende) */
export function grabFrame(row: PrinterRow, timeoutMs = 10_000): Promise<Buffer | null> {
  const c = camera(row);
  if (!c) return Promise.resolve(null);
  return new Promise((res) => {
    let un = () => {};
    const t = setTimeout(() => (un(), res(c.last)), timeoutMs);
    // Das erste Bild nach dem Verbinden ist oft noch dunkel: das zweite nehmen
    let seen = 0;
    un = c.subscribe((jpg) => {
      if (++seen < 2) return;
      clearTimeout(t);
      un();
      res(jpg);
    });
  });
}
