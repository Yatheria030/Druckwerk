// Druckoptionen und KI-Erkennung wie in Bambu Studio („Druckoptionen“). Was der Drucker kann, steht in den Bits von `fun`
// bzw. `fun2` (Hex) oder im Objekt `xcam`; den Ist-Stand melden `cfg` (Hex, Druckoptionen), `xcam.cfg` (Zahl, Kamera-Erkennung),
// `xcam.*` (ältere Firmware) und `home_flag` (AMS). Geschaltet wird per `xcam_control_set` (Kamera-Module), `print_option` (Druck)
// und `set_against_continued_heating_mode`. Den Zeitraffer wählt man je Druck beim Start (`ipcam_timelapse` lehnt der P2S ab).
import type { PrintOption } from "../shared/types.ts";

type Raw = Record<string, any>;
export type OptionInput = { on: boolean; level?: string; choice?: number };
type Hold = OptionInput & { until: number };

const bits = (hex: unknown, bit: number, len = 1): number | null => {
  if (typeof hex !== "string" || !/^[0-9a-f]+$/i.test(hex)) return null;
  return Number((BigInt(`0x${hex}`) >> BigInt(bit)) & ((1n << BigInt(len)) - 1n));
};
const ibits = (v: unknown, bit: number, len = 1): number | null => (Number.isFinite(Number(v)) && v !== null && v !== "" ? (Number(v) >>> bit) & ((1 << len) - 1) : null);

const AI_LEVELS = ["never_halt", "low", "medium", "high"];
const DETECT_LEVELS = ["low", "medium", "high"];

type Def = {
  key: string;
  group: PrintOption["group"];
  label: string;
  help: string;
  supported: (r: Raw, fun: (b: number) => boolean, fun2: (b: number) => boolean) => boolean;
  read: (r: Raw) => { on: boolean; level?: string | null; choice?: number } | null;
  levels?: string[];
  choices?: { value: number; label: string }[];
  command: (o: OptionInput, cur: (key: string) => boolean) => Raw;
};

const xcam = (module: string, o: OptionInput) => ({
  xcam: { command: "xcam_control_set", module_name: module, control: o.on, enable: o.on, print_halt: true, ...(o.level ? { halt_print_sensitivity: o.level } : {}) },
});
const detector = (key: string, module: string, funBit: number, bit: number, label: string, help: string): Def => ({
  key,
  group: "ki",
  label,
  help,
  supported: (r, fun) => fun(funBit) && r.xcam?.cfg != null,
  read: (r) => {
    const on = ibits(r.xcam?.cfg, bit);
    const lvl = ibits(r.xcam?.cfg, bit + 1, 2);
    return on == null ? null : { on: on === 1, level: DETECT_LEVELS[lvl ?? 1] ?? "medium" };
  },
  levels: DETECT_LEVELS,
  command: (o) => xcam(module, o),
});
const xcamSwitch = (key: string, module: string, fun2Bit: number, bit: number, label: string, help: string): Def => ({
  key,
  group: "ki",
  label,
  help,
  supported: (r, _f, fun2) => fun2(fun2Bit) && r.xcam?.cfg != null,
  read: (r) => {
    const on = ibits(r.xcam?.cfg, bit);
    return on == null ? null : { on: on === 1 };
  },
  command: (o) => xcam(module, o),
});
const printOption = (o: Raw) => ({ print: { command: "print_option", ...o } });

// AMS-Einstellungen: ams_user_setting schickt immer alle drei Werte (ams_id -1 = alle Einheiten), wie Bambu Studio
const AMS_KEYS = { ams_insert_read: "tray_read_option", ams_startup_read: "startup_read_option", ams_remain: "calibrate_remain_flag" } as const;
const amsSetting = (key: keyof typeof AMS_KEYS, label: string, help: string, read: (r: Raw) => boolean | null): Def => ({
  key,
  group: "ams",
  label,
  help,
  supported: (r) => Array.isArray(r.ams?.ams) && r.ams.ams.length > 0 && read(r) != null,
  read: (r) => {
    const v = read(r);
    return v == null ? null : { on: v };
  },
  command: (o, cur) => ({
    print: {
      command: "ams_user_setting",
      ams_id: -1,
      ...Object.fromEntries(Object.entries(AMS_KEYS).map(([k, field]) => [field, k === key ? o.on : cur(k)])),
    },
  }),
});
const flag = (v: unknown) => (typeof v === "boolean" ? v : v === 0 || v === 1 ? v === 1 : null);

const DEFS: Def[] = [
  {
    key: "ai_monitor",
    group: "ki",
    label: "KI-Überwachung",
    help: "Die Kamera achtet während des Drucks auf Fehler. Die Empfindlichkeit legt fest, wann der Drucker anhält; „Nur melden“ hält nie an.",
    // Mit xcam.cfg (neuere Firmware) gibt es die Erkennungen einzeln, Bambu Studio blendet die Sammel-Überwachung dann aus
    supported: (r) => r.xcam?.cfg == null && (r.xcam?.printing_monitor !== undefined || r.xcam?.spaghetti_detector !== undefined),
    read: (r) => {
      const on = bits(r.cfg, 15);
      const lvl = bits(r.cfg, 13, 2);
      if (on != null) return { on: on === 1, level: AI_LEVELS[lvl ?? 2] ?? "medium" };
      const x = r.xcam ?? {};
      const v = x.printing_monitor ?? x.spaghetti_detector;
      if (v === undefined) return null;
      return { on: !!v, level: typeof x.halt_print_sensitivity === "string" ? x.halt_print_sensitivity : x.print_halt ? "medium" : "never_halt" };
    },
    levels: AI_LEVELS,
    command: (o) => xcam("printing_monitor", o),
  },
  detector("spaghetti", "spaghetti_detector", 42, 7, "Spaghetti-Erkennung", "Erkennt lose Fäden, wenn sich ein Teil gelöst hat."),
  detector("pileup", "pileup_detector", 43, 10, "Abfallschacht verstopft", "Erkennt Filamentreste, die sich am Abfallschacht stauen."),
  detector("clump", "clump_detector", 44, 13, "Klumpen an der Düse", "Erkennt Filament, das sich an der Düse sammelt."),
  detector("airprint", "airprint_detector", 45, 16, "Druck in die Luft", "Erkennt, wenn die Düse kein Filament mehr fördert."),
  {
    key: "first_layer",
    group: "ki",
    label: "Erste Schicht prüfen",
    help: "Prüft die erste Schicht per Lidar bzw. Kamera.",
    supported: (r) => typeof r.xcam?.first_layer_inspector === "boolean",
    read: (r) => (typeof r.xcam?.first_layer_inspector === "boolean" ? { on: r.xcam.first_layer_inspector } : null),
    command: (o) => xcam("first_layer_inspector", o),
  },
  {
    key: "plate_marker",
    group: "ki",
    label: "Druckplatte erkennen",
    help: "Prüft vor dem Druck, ob die passende Druckplatte aufliegt.",
    supported: (r) => typeof r.xcam?.buildplate_marker_detector === "boolean",
    read: (r) => (typeof r.xcam?.buildplate_marker_detector === "boolean" ? { on: r.xcam.buildplate_marker_detector } : null),
    command: (o) => xcam("buildplate_marker_detector", o),
  },
  xcamSwitch("plate_align", "plate_offset_switch", 2, 20, "Druckplatte ausgerichtet", "Prüft, ob die Druckplatte richtig sitzt."),
  xcamSwitch("foreign_object", "fod_check", 13, 21, "Fremdkörper auf der Platte", "Prüft vor dem Druck, ob etwas auf der Druckplatte liegt."),
  xcamSwitch("model_moved", "model_movement_check", 14, 22, "Verrutschtes Modell", "Erkennt, wenn sich ein Teil auf der Platte verschoben hat."),
  {
    key: "auto_recovery",
    group: "druck",
    label: "Schrittverlust beheben",
    help: "Fährt nach verlorenen Motorschritten neu an die Position und druckt weiter.",
    supported: (r) => r.support_auto_recovery_step_loss !== false && bits(r.cfg, 16) != null,
    read: (r) => (bits(r.cfg, 16) == null ? null : { on: bits(r.cfg, 16) === 1 }),
    command: (o) => printOption({ option: o.on ? 1 : 0, auto_recovery: o.on }),
  },
  amsSetting("ams_insert_read", "Chip beim Einlegen lesen", "Liest den RFID-Chip, sobald eine Spule ins AMS kommt.", (r) => flag(r.ams?.insert_flag)),
  amsSetting("ams_startup_read", "Chips beim Einschalten lesen", "Liest beim Start des Druckers alle Spulen ein; dabei drehen sie kurz.", (r) => flag(r.ams?.power_on_flag)),
  amsSetting("ams_remain", "Restmenge schätzen", "Schätzt bei Bambu-Spulen den Rest anhand der verbrauchten Länge.", (r) =>
    Number.isFinite(Number(r.home_flag)) && r.home_flag !== null && r.home_flag !== "" ? ibits(r.home_flag, 7) === 1 : null),
  {
    key: "auto_refill",
    group: "ams",
    label: "Spule automatisch wechseln",
    help: "Geht eine Spule leer, nimmt das AMS eine andere mit gleichem Filament.",
    supported: (r) => Array.isArray(r.ams?.ams) && r.ams.ams.length > 0 && (bits(r.cfg, 18) != null || Number.isFinite(Number(r.home_flag))),
    // Neuere Firmware meldet den Stand in cfg Bit 18, ältere in home_flag Bit 10
    read: (r) => {
      const v = bits(r.cfg, 18) ?? (Number.isFinite(Number(r.home_flag)) ? ibits(r.home_flag, 10) : null);
      return v == null ? null : { on: v === 1 };
    },
    command: (o) => printOption({ auto_switch_filament: o.on }),
  },
  {
    key: "tangle",
    group: "druck",
    label: "Verhedderung erkennen",
    help: "Hält an, wenn sich das Filament auf der Spule verheddert.",
    supported: (_r, fun) => fun(9),
    read: (r) => (bits(r.cfg, 23) == null ? null : { on: bits(r.cfg, 23) === 1 }),
    command: (o) => printOption({ filament_tangle_detect: o.on }),
  },
  {
    key: "nozzle_blob",
    group: "druck",
    label: "Düsenklumpen erkennen",
    help: "Erkennt über die Düse, wenn sich dort Filament sammelt.",
    supported: (_r, fun, fun2) => fun(13) && !fun2(15),
    read: (r) => (bits(r.cfg, 24) == null ? null : { on: bits(r.cfg, 24) === 1 }),
    command: (o) => printOption({ nozzle_blob_detect: o.on }),
  },
  {
    key: "nozzle_blob_v2",
    group: "druck",
    label: "Düsenklumpen erkennen",
    help: "Erkennt über die Düse, wenn sich dort Filament sammelt. „Automatisch“ entscheidet je nach Filament.",
    supported: (_r, _f, fun2) => fun2(15),
    read: (r) => {
      const v = bits(r.cfg, 43, 2);
      return v == null ? null : { on: v > 0, choice: v };
    },
    choices: [
      { value: 0, label: "Aus" },
      { value: 1, label: "An" },
      { value: 2, label: "Automatisch" },
    ],
    command: (o) => printOption({ nozzle_blob_detect_v2: o.choice ?? (o.on ? 1 : 0) }),
  },
  {
    key: "air_printing",
    group: "druck",
    label: "Leerlauf der Düse erkennen",
    help: "Erkennt ohne Kamera, wenn die Düse kein Filament mehr fördert.",
    supported: (_r, _f, fun2) => fun2(32),
    read: (r) => (bits(r.cfg, 41) == null ? null : { on: bits(r.cfg, 41) === 1 }),
    command: (o) => printOption({ air_printing_detection: o.on }),
  },
  {
    key: "idle_heating",
    group: "druck",
    label: "Heizen im Leerlauf begrenzen",
    help: "Schaltet Düse und Bett ab, wenn der Drucker lange ohne Druck heizt.",
    supported: (_r, fun) => fun(62),
    read: (r) => (bits(r.cfg, 32, 2) == null ? null : { on: bits(r.cfg, 32, 2) === 1 }),
    command: (o) => ({ print: { command: "set_against_continued_heating_mode", enable: o.on } }),
  },
  {
    key: "purify_air",
    group: "druck",
    label: "Luft nach dem Druck reinigen",
    help: "Lässt die Lüfter nach dem Druck weiterlaufen, damit Dämpfe gefiltert bzw. nach außen geleitet werden.",
    supported: (_r, _f, fun2) => fun2(4),
    read: (r) => {
      const v = bits(r.cfg, 36, 2);
      return v == null ? null : { on: v > 0, choice: v };
    },
    choices: [
      { value: 0, label: "Aus" },
      { value: 1, label: "Innen umwälzen" },
      { value: 2, label: "Nach außen" },
    ],
    command: (o) => printOption({ air_purification: o.choice ?? (o.on ? 1 : 0) }),
  },
  {
    key: "door",
    group: "druck",
    label: "Tür offen während des Drucks",
    help: "Was der Drucker tut, wenn jemand während eines Drucks die Tür öffnet.",
    supported: (r, fun) => fun(12) && bits(r.cfg, 20, 2) != null,
    read: (r) => {
      const v = bits(r.cfg, 20, 2);
      return v == null ? null : { on: v > 0, choice: v };
    },
    choices: [
      { value: 0, label: "Nichts" },
      { value: 1, label: "Melden" },
      { value: 2, label: "Anhalten" },
    ],
    command: (o) => ({ system: { command: "set_door_stat", config: o.choice ?? (o.on ? 1 : 0) } }),
  },
  {
    key: "sound",
    group: "druck",
    label: "Hinweistöne",
    help: "Der Drucker piept, wenn er etwas von dir braucht.",
    supported: (_r, fun) => fun(8),
    read: (r) => (bits(r.cfg, 22) == null ? null : { on: bits(r.cfg, 22) === 1 }),
    command: (o) => printOption({ sound_enable: o.on }),
  },
];

const funTest = (hex: unknown) => (b: number) => bits(hex, b) === 1;

/** Optionen, die der Drucker kennt, mit Ist-Stand; frisch geschaltete Werte gelten 8 s, bis der Bericht sie bestätigt */
export function readOptions(raw: Raw, holds: Map<string, Hold>): PrintOption[] {
  const fun = funTest(raw.fun);
  const fun2 = funTest(raw.fun2);
  const out: PrintOption[] = [];
  for (const d of DEFS) {
    if (!d.supported(raw, fun, fun2)) continue;
    const v = d.read(raw);
    if (!v) continue;
    const h = holds.get(d.key);
    const cur = h && h.until > Date.now() ? { ...v, ...h, level: h.level ?? v.level, choice: h.choice ?? v.choice } : v;
    out.push({
      key: d.key,
      group: d.group,
      label: d.label,
      help: d.help,
      on: cur.on,
      ...(d.levels ? { level: cur.level ?? null, levels: d.levels } : {}),
      ...(d.choices ? { choice: cur.choice ?? 0, choices: d.choices } : {}),
    });
  }
  return out;
}

/** Befehl für eine Option; null, wenn der Drucker sie nicht kennt */
export function optionCommand(raw: Raw, key: string, o: OptionInput, holds?: Map<string, Hold>): Raw | null {
  const d = DEFS.find((x) => x.key === key);
  if (!d || !d.supported(raw, funTest(raw.fun), funTest(raw.fun2))) return null;
  if (o.level != null && !d.levels?.includes(o.level)) return null;
  if (o.choice != null && !d.choices?.some((c) => c.value === o.choice)) return null;
  const input = d.choices ? { on: (o.choice ?? (o.on ? 1 : 0)) > 0, choice: o.choice ?? (o.on ? 1 : 0) } : o;
  // Stand der übrigen Optionen (gehaltene Änderungen zuerst), für Befehle, die mehrere Werte zusammen schicken
  const cur = (k: string) => {
    const h = holds?.get(k);
    if (h && h.until > Date.now()) return h.on;
    return DEFS.find((x) => x.key === k)?.read(raw)?.on ?? false;
  };
  return d.command(input, cur);
}

export type { Hold };
