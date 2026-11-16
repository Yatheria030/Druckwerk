import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraOff, Check, Cpu, Gauge, EyeOff, HardDrive, SlidersHorizontal, ListX, Move, Pause, Play, Square, Video } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { cameraOf, PRINTER_MODELS, type Printer, type PrinterLive } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { QueueCard } from "../ui/Queue.tsx";
import { PageHeader, useLive } from "../App.tsx";
import { errorKey, hmsKey, noText, useHms } from "../lib/hms.ts";
import { href } from "../lib/router.ts";
import { Button, Card, LoadError, useToast } from "../ui/controls.tsx";
import { DeviceDialog, FanDialog, MoveDialog, OptionsDialog, SkipDialog, StorageDialog, TempDialog, useControl } from "../ui/PrinterControls.tsx";
import { finishAt, fmtRemaining, stateColor, StateDot, stateLabel } from "../ui/printer.tsx";
import { AmsPanel } from "../ui/Ams.tsx";
import { PrinterFigure } from "../ui/PrinterFigure.tsx";
import { PrinterTabs } from "../ui/PrinterTabs.tsx";
import { MaintDue } from "./MaintenancePage.tsx";
import { AtTime, ClockNote, levelOf, TONE_TEXT, WikiCode } from "../ui/hms.tsx";

const SPEED = ["", "Leise", "Normal", "Sport", "Rasend"];
/** Bedienknöpfe als gleich breite Kacheln, Symbol über der Beschriftung */
const TILE = "h-auto! w-full flex-col gap-1! px-1.5! py-2.5 text-xs!";
/** Spalten ohne einzelne Kachel in der letzten Reihe: bis 5 in einer Reihe, sonst auf zwei Reihen verteilt; ab xl alle in einer */
const tileCols = (n: number) => ({ "--m": n <= 5 ? n : Math.ceil(n / 2), "--n": n }) as CSSProperties;
/** P2S und H2 haben statt SD-Karte einen USB-Anschluss */
const STORAGE = (model: string) => (/^(P2|H2)/.test(model) ? "USB-Stick" : "SD-Karte");

export function PrinterPage() {
  const printers = useQuery({ queryKey: ["printers"], queryFn: api.printers });
  const live = useLive(true);

  return (
    <>
      <PageHeader title="Drucker" />
      <PrinterTabs view="printer" />
      <div className="mx-auto max-w-6xl 2xl:max-w-[88rem] space-y-5 px-4 sm:px-6">
        {printers.isError ? (
          <LoadError error={printers.error} retry={() => printers.refetch()} />
        ) : printers.isPending ? (
          <div className="skeleton h-80 rounded-2xl" />
        ) : !printers.data.length ? (
          <Card className="p-8 text-center">
            <div className="text-lg font-bold">Noch kein Drucker</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink2">Bambu-Drucker im Heimnetz über IP, Seriennummer und Zugangscode verbinden.</p>
            <a href={href({ page: "settings" })} className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent">
              Drucker einrichten
            </a>
          </Card>
        ) : (
          <>
            {printers.data.map((p) => (
              <PrinterCard key={p.id} p={p} l={live.data?.find((x) => x.id === p.id)} />
            ))}
            <QueueCard live={live.data ?? []} />
            <MaintDue />
          </>
        )}
      </div>
    </>
  );
}

function PrinterCard({ p, l }: { p: Printer; l?: PrinterLive }) {
  const [cam, setCam] = useState(true);
  const [camErr, setCamErr] = useState(false);
  const [dlg, setDlg] = useState<"nozzle" | "bed" | "fans" | "skip" | "storage" | "options" | "move" | "device" | null>(null);
  const ctl = useControl(p.id);
  const hasCam = cameraOf(p.model) !== "none";
  const running = !!l && ["RUNNING", "PREPARE", "PAUSE"].includes(l.state);
  const current = useQuery({ queryKey: ["prints"], queryFn: api.prints, enabled: !!l?.current_print_id, refetchInterval: 15_000 });
  const job = current.data?.find((x) => x.id === l?.current_print_id);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sep px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {l && <StateDot live={l} />}
          <div className="min-w-0">
            <div className="truncate font-bold">{p.name}</div>
            <div className="text-xs text-ink3">
              {PRINTER_MODELS.find((m) => m.id === p.model)?.label ?? p.model} · {p.host}
              {l?.wifi ? ` · WLAN ${l.wifi}` : ""}
              {l?.power_w != null ? ` · ${Math.round(l.power_w)} W` : l?.plug_error ? " · Steckdose nicht erreichbar" : ""}
              {l?.connected && l.sdcard === false ? ` · ${STORAGE(p.model)} fehlt` : ""}
            </div>
          </div>
        </div>
        <div className="text-sm font-bold" style={{ color: l ? stateColor(l.state) : undefined }}>
          {l ? stateLabel(l.state) : "…"}
          {l?.stage && l.state !== "IDLE" ? <span className="ml-1.5 font-medium text-ink2">· {l.stage}</span> : null}
        </div>
      </div>

      {l?.error && !l.connected && <div className="bg-bad-soft px-4 py-2.5 text-sm text-bad">{l.error}</div>}

      {/* Mobil: Kamera, Status, Zeichnung, Bedienung; ab md links Kamera/Status/Bedienung, rechts die Zeichnung als Bühne */}
      <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:grid-rows-[auto_auto_1fr]">
        <div className="relative aspect-video bg-black md:col-start-1 md:row-start-1">
          {hasCam && cam && l?.connected && l.liveview !== false && !camErr ? (
            <img src={`/api/printers/${p.id}/camera`} alt="Kamera" className="absolute inset-0 size-full object-contain" onError={() => setCamErr(true)} />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-sm text-white/60">
              <div className="text-center">
                <CameraOff size={28} className="mx-auto mb-2" />
                {!hasCam ? "Keine Kamera" : !l?.connected ? "Drucker offline" : l.liveview === false ? "LAN-Liveview am Drucker aus" : camErr ? "Kamera nicht erreichbar" : "Kamera aus"}
                {l?.connected && l.liveview === false && <div className="mt-1 max-w-64 px-4 text-xs text-white/45">Am Drucker in den Einstellungen <span className="whitespace-nowrap">„LAN-Liveview“</span> einschalten</div>}
                {camErr && (
                  <div>
                    <button className="mt-2 text-xs font-semibold text-white underline" onClick={() => setCamErr(false)}>
                      Erneut versuchen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {hasCam && (
            <button onClick={() => (setCam(!cam), setCamErr(false))} className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/50 text-white" aria-label="Kamera an/aus">
              {cam ? <CameraOff size={15} /> : <Video size={15} />}
            </button>
          )}
        </div>

        <div className="px-4 pt-4 md:col-start-1 md:row-start-2">
          {running && l ? (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0 truncate font-bold">
                  {job?.model_id ? (
                    <a href={href({ page: "model", id: job.model_id })} className="hover:text-accent">
                      {job.model_name}
                    </a>
                  ) : (
                    l.job
                  )}
                </div>
                <div className="shrink-0 whitespace-nowrap text-2xl font-extrabold tnum">{Math.round(l.percent ?? 0)} %</div>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-fill2">
                <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${l.percent ?? 0}%`, background: stateColor(l.state) }} />
              </div>
              <div className="mt-2 flex flex-wrap justify-between gap-x-4 text-xs text-ink2 tnum">
                <span>
                  Schicht {l.layer ?? "–"} / {l.total_layers ?? "–"}
                </span>
                <span>
                  noch {fmtRemaining(l.remaining_min)}
                  {finishAt(l.remaining_min) ? ` · fertig um ${finishAt(l.remaining_min)}` : ""}
                </span>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="font-bold">{!l?.connected ? "Nicht verbunden" : "Kein Druck aktiv"}</div>
              {l?.connected && l.job && (l.state === "FINISH" || l.state === "FAILED") && (
                <div className="mt-0.5 truncate text-sm text-ink3">
                  Zuletzt: <span className="font-semibold text-ink2">{l.job}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center px-3 pt-4 pb-1 md:col-start-2 md:row-span-3 md:row-start-1 md:border-l md:border-sep md:bg-card2 md:px-5 md:py-6">
          <PrinterFigure
            l={l}
            onTemp={setDlg}
            onFans={() => setDlg("fans")}
            onLight={() => ctl.mutate({ action: l?.light ? "light_off" : "light_on" })}
          />
        </div>

        <div className="space-y-4 p-4 md:col-start-1 md:row-start-3">
          {(!!l?.hms.length || !!l?.print_error) && <Alerts l={l} printerId={p.id} />}

          <div
            className="grid grid-cols-[repeat(var(--m),minmax(0,1fr))] gap-2 xl:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
            style={tileCols(2 + (running ? 2 : 0) + (l?.connected ? 2 : 0) + (l?.options.length ? 1 : 0) + (l?.connected && l.sdcard !== false ? 1 : 0))}
          >
            {l?.state === "PAUSE" ? (
              <Button kind="primary" className={TILE} busy={ctl.isPending} onClick={() => ctl.mutate({ action: "resume" })}>
                <Play size={18} /> Fortsetzen
              </Button>
            ) : (
              <Button className={TILE} disabled={l?.state !== "RUNNING"} busy={ctl.isPending} onClick={() => ctl.mutate({ action: "pause" })}>
                <Pause size={18} /> Pause
              </Button>
            )}
            <Button kind="danger" className={TILE} disabled={!running} onClick={() => confirm("Druck wirklich abbrechen?") && ctl.mutate({ action: "stop" })}>
              <Square size={17} /> Abbrechen
            </Button>
            {running && (
              <Button className={TILE} onClick={() => setDlg("skip")}>
                <ListX size={18} />
                <span>
                  Objekte{!!l?.skipped.length && <span className="ml-1 text-ink3 tnum">−{l.skipped.length}</span>}
                </span>
              </Button>
            )}
            {l?.connected && (
              <Button className={TILE} onClick={() => setDlg("move")}>
                <Move size={18} /> Bewegen
              </Button>
            )}
            {l?.connected && (
              <Button className={TILE} onClick={() => setDlg("device")}>
                <Cpu size={18} /> Gerät
              </Button>
            )}
            {!!l?.options.length && (
              <Button className={TILE} onClick={() => setDlg("options")}>
                <SlidersHorizontal size={18} /> Optionen
              </Button>
            )}
            {l?.connected && l.sdcard !== false && (
              <Button className={TILE} onClick={() => setDlg("storage")}>
                <HardDrive size={18} /> Dateien
              </Button>
            )}
            {running && (
              <label className={`${TILE} relative inline-flex cursor-pointer items-center justify-center rounded-lg bg-card font-semibold shadow-seg hover:bg-fill`}>
                <Gauge size={18} />
                {SPEED[l?.speed ?? 2]}
                <select
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={l?.speed ?? 2}
                  onChange={(e) => ctl.mutate({ action: "speed", value: Number(e.target.value) })}
                  aria-label="Geschwindigkeit"
                >
                  {[1, 2, 3, 4].map((s) => (
                    <option key={s} value={s}>
                      {SPEED[s]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </div>
      {l && (l.ams.length > 0 || l.external) && (
        <div className="border-t border-sep p-2.5 sm:p-4">
          <AmsPanel l={l} printerId={p.id} />
        </div>
      )}
      {l && (dlg === "nozzle" || dlg === "bed") && <TempDialog printerId={p.id} kind={dlg} l={l} onClose={() => setDlg(null)} />}
      {l && dlg === "fans" && <FanDialog printerId={p.id} l={l} onClose={() => setDlg(null)} />}
      {l && dlg === "options" && <OptionsDialog printerId={p.id} l={l} onClose={() => setDlg(null)} />}
      {l && dlg === "device" && <DeviceDialog printerId={p.id} l={l} onClose={() => setDlg(null)} />}
      {l && dlg === "move" && <MoveDialog printerId={p.id} l={l} onClose={() => setDlg(null)} />}
      {dlg === "skip" && <SkipDialog printerId={p.id} onClose={() => setDlg(null)} />}
      {dlg === "storage" && <StorageDialog printerId={p.id} model={p.model} onClose={() => setDlg(null)} />}
    </Card>
  );
}

/** HMS-Meldungen und Druckfehler mit Text von Bambu; der Code führt ins Wiki */
function Alerts({ l, printerId }: { l: PrinterLive; printerId: number }) {
  const hms = useHms();
  const qc = useQueryClient();
  const toast = useToast();
  const dismiss = useMutation({
    mutationFn: (i: { kind: "error" | "hms"; code: string }) => api.dismissAlert(printerId, i.kind, i.code),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["live"] }),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
  const items = [
    ...l.hms.map((h) => ({ key: hmsKey(h.code), code: h.code, kind: "hms" as const, at: h.at })),
    ...(l.print_error ? [{ key: errorKey(l.print_error), code: String(l.print_error), kind: "error" as const, at: null }] : []),
  ];
  const serious = items.some((i) => levelOf(i.key, i.kind).tone === "bad");
  return (
    <div className={`space-y-2.5 rounded-lg p-2.5 text-xs ${serious ? "bg-bad-soft" : "bg-fill"}`}>
      {items.map((i) => {
        const lv = levelOf(i.key, i.kind);
        const text = hms.data?.[i.kind][i.key];
        return (
          <div key={i.kind + i.key}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={`font-bold ${TONE_TEXT[lv.tone]}`}>
                {i.kind === "error" ? `Druckfehler · ${lv.label}` : lv.label}
              </span>
              <WikiCode k={i.key} kind={i.kind} link={!hms.data || !!text} className="text-ink2" />
              {i.at && <AtTime at={i.at} offset={l.clock_offset} />}
              <button
                onClick={() => dismiss.mutate({ kind: i.kind, code: i.code })}
                disabled={dismiss.isPending}
                className="ml-auto inline-flex items-center gap-1 rounded-md p-1 font-semibold text-ink2 hover:bg-hover hover:text-ink sm:px-1.5 sm:py-0.5"
                title={i.kind === "error" ? "Fehler am Drucker quittieren" : "Ausblenden, bis der Drucker die Meldung nicht mehr meldet"}
              >
                {i.kind === "error" ? <Check size={13} /> : <EyeOff size={13} />}
                <span className="max-sm:sr-only">{i.kind === "error" ? "Quittieren" : "Ausblenden"}</span>
              </button>
            </div>
            {hms.data && <p className="mt-0.5 text-[13px] leading-snug text-ink">{text || noText(i.key)}</p>}
          </div>
        );
      })}
      <ClockNote ats={items.map((i) => i.at)} offset={l.clock_offset} />
      <a href={href({ page: "printer", view: "fehlercodes" })} className="inline-block font-semibold text-ink3 hover:text-accent">
        Alle Fehlercodes
      </a>
    </div>
  );
}
