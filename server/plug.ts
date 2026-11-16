// Messende Steckdosen im LAN (Shelly Gen1/Gen2+, Tasmota): Zählerstand in Wh und aktuelle Leistung, ohne Cloud.
// Format in printers.plug: "shelly:<host>" oder "tasmota:<host>", Host mit optionalem Port.

export type PlugReading = { wh: number; w: number | null; at: number };

export const PLUG_RE = /^(shelly|tasmota):([a-zA-Z0-9.-]+(?::\d{1,5})?)$/;

async function get(url: string, ms: number): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Zählerstand und Leistung lesen; wirft bei Fehler mit verständlicher Meldung */
export async function readPlug(plug: string, ms = 4000): Promise<PlugReading> {
  const m = plug.match(PLUG_RE);
  if (!m) throw new Error("Steckdose: Format shelly:<IP> oder tasmota:<IP>");
  const [, kind, host] = m;
  try {
    if (kind === "tasmota") {
      const e = (await get(`http://${host}/cm?cmnd=Status%2010`, ms))?.StatusSNS?.ENERGY;
      const total = num(e?.Total);
      if (total == null) throw new Error("kein Energiezähler");
      return { wh: total * 1000, w: num(e?.Power), at: Date.now() };
    }
    // Shelly Gen2+ (Plus/Pro/Gen3): erster Kanal mit aenergy, sonst Gen1 (/status, Zähler in Wattminuten)
    try {
      const st = await get(`http://${host}/rpc/Shelly.GetStatus`, ms);
      for (const [k, v] of Object.entries(st ?? {}) as [string, any][]) {
        if (!/^(switch|pm1|em1):\d+$/.test(k)) continue;
        const total = num(v?.aenergy?.total);
        if (total != null) return { wh: total, w: num(v?.apower) ?? num(v?.act_power), at: Date.now() };
      }
    } catch (e) {
      if ((e as Error).name === "TimeoutError") throw e;
    }
    const meter = (await get(`http://${host}/status`, ms))?.meters?.[0];
    const total = num(meter?.total);
    if (total == null) throw new Error("kein Energiezähler");
    return { wh: total / 60, w: num(meter?.power), at: Date.now() };
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "keine Antwort" : (e as Error).message;
    throw new Error(`Steckdose ${host}: ${msg}`);
  }
}
