import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraOff, Lightbulb, Pause, Play, Square, Video } from "lucide-react";
import { useState } from "react";
import { cameraOf, PRINTER_MODELS, type Printer, type PrinterLive } from "../../../shared/types.ts";
import { api } from "../api.ts";
import { PageHeader, useLive } from "../App.tsx";
import { errorKey, hmsKey, useHms } from "../lib/hms.ts";
import { href } from "../lib/router.ts";
import { Button, Card, Label, LoadError, useToast } from "../ui/controls.tsx";
import { finishAt, fmtRemaining, fmtTemp, stateColor, StateDot, stateLabel } from "../ui/printer.tsx";
import { AmsPanel } from "../ui/Ams.tsx";
import { PrinterTabs } from "../ui/PrinterTabs.tsx";
import { levelOf, NO_TEXT, TONE_TEXT, WikiCode } from "../ui/hms.tsx";

const SPEED = ["", "Leise", "Normal", "Sport", "Rasend"];

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
          printers.data.map((p) => <PrinterCard key={p.id} p={p} l={live.data?.find((x) => x.id === p.id)} />)
        )}
      </div>
    </>
  );
}

function PrinterCard({ p, l }: { p: Printer; l?: PrinterLive }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [cam, setCam] = useState(true);
  const [camErr, setCamErr] = useState(false);
  const ctl = useMutation({
    mutationFn: (a: { action: string; value?: number }) => api.control(p.id, a.action, a.value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["live"] }),
    onError: (e) => toast((e as Error).message, "fehler"),
  });
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
            </div>
          </div>
        </div>
        <div className="text-sm font-bold" style={{ color: l ? stateColor(l.state) : undefined }}>
          {l ? stateLabel(l.state) : "…"}
          {l?.stage && l.state !== "IDLE" ? <span className="ml-1.5 font-medium text-ink2">· {l.stage}</span> : null}
        </div>
      </div>

      {l?.error && !l.connected && <div className="bg-bad-soft px-4 py-2.5 text-sm text-bad">{l.error}</div>}

      <div className="grid gap-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="relative aspect-video bg-black">
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

        <div className="space-y-4 p-4">
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
                <div className="text-2xl font-extrabold tnum">{l.percent ?? 0} %</div>
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
            <div className="min-w-0 text-sm text-ink2">
              {!l?.connected ? "Nicht verbunden." : "Kein Druck aktiv."}
              {l?.connected && l.job && (l.state === "FINISH" || l.state === "FAILED") && (
                <div className="mt-0.5 truncate text-xs text-ink3">
                  Zuletzt: <span className="font-semibold text-ink2">{l.job}</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["Düse", fmtTemp(l?.nozzle ?? null, l?.nozzle_target)],
                ["Bett", fmtTemp(l?.bed ?? null, l?.bed_target)],
                ["Kammer", fmtTemp(l?.chamber ?? null)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-fill px-2.5 py-2">
                <Label>{k}</Label>
                <div className="mt-0.5 text-sm font-bold whitespace-nowrap tnum">{v}</div>
              </div>
            ))}
          </div>

          {(!!l?.hms.length || !!l?.print_error) && <Alerts l={l} />}

          <div className="flex flex-wrap gap-2">
            {l?.state === "PAUSE" ? (
              <Button kind="primary" busy={ctl.isPending} onClick={() => ctl.mutate({ action: "resume" })}>
                <Play size={15} /> Fortsetzen
              </Button>
            ) : (
              <Button disabled={l?.state !== "RUNNING"} busy={ctl.isPending} onClick={() => ctl.mutate({ action: "pause" })}>
                <Pause size={15} /> Pause
              </Button>
            )}
            <Button kind="danger" disabled={!running} onClick={() => confirm("Druck wirklich abbrechen?") && ctl.mutate({ action: "stop" })}>
              <Square size={14} /> Abbrechen
            </Button>
            <Button disabled={!l?.connected} onClick={() => ctl.mutate({ action: l?.light ? "light_off" : "light_on" })}>
              <Lightbulb size={15} className={l?.light ? "text-star" : ""} fill={l?.light ? "currentColor" : "none"} /> Licht
            </Button>
            {running && (
              <select
                className="h-9 rounded-lg bg-card px-2 text-sm font-semibold shadow-seg"
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
            )}
          </div>
        </div>
      </div>
      {l && (l.ams.length > 0 || l.external) && (
        <div className="border-t border-sep p-2.5 sm:p-4">
          <AmsPanel l={l} printerId={p.id} />
        </div>
      )}
    </Card>
  );
}

/** "2026-11-11 03:58" (Druckerzeit) → "11.11. 03:58" */
const fmtHmsTime = (at: string) => `${at.slice(8, 10)}.${at.slice(5, 7)}. ${at.slice(11, 16)}`;

/** HMS-Meldungen und Druckfehler mit Text von Bambu; der Code führt ins Wiki */
function Alerts({ l }: { l: PrinterLive }) {
  const hms = useHms();
  const items = [
    ...l.hms.map((h) => ({ key: hmsKey(h.code), kind: "hms" as const, at: h.at })),
    ...(l.print_error ? [{ key: errorKey(l.print_error), kind: "error" as const, at: null }] : []),
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
              <WikiCode k={i.key} kind={i.kind} className="text-ink2" />
              {i.at && <span className="text-ink3 tnum">{fmtHmsTime(i.at)}</span>}
            </div>
            {hms.data && <p className="mt-0.5 text-[13px] leading-snug text-ink">{text || NO_TEXT}</p>}
          </div>
        );
      })}
      <a href={href({ page: "printer", view: "fehlercodes" })} className="inline-block font-semibold text-ink3 hover:text-accent">
        Alle Fehlercodes
      </a>
    </div>
  );
}
