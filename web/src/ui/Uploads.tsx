import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Upload, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { clearUploads, importFiles, useUploads } from "../lib/upload.ts";

/** Fortschritt aller laufenden Uploads, unten rechts */
export function UploadPanel() {
  const items = useUploads();
  if (!items.length) return null;
  const done = items.every((i) => i.state !== "laeuft");
  return (
    <div className="anim-sheet fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 z-40 rounded-2xl bg-card p-3 shadow-pop sm:left-auto sm:w-80 md:bottom-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-sm font-bold">{done ? "Upload fertig" : "Wird hochgeladen …"}</div>
        {done && (
          <button onClick={clearUploads} className="grid size-7 place-items-center rounded-full text-ink3 hover:bg-hover" aria-label="Schließen">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
        {items.map((i) => (
          <div key={i.key} className="rounded-lg bg-fill px-2.5 py-2">
            <div className="flex items-center gap-2 text-xs">
              {i.state === "fertig" ? <CheckCircle2 size={14} className="text-good" /> : i.state === "fehler" ? <CircleAlert size={14} className="text-bad" /> : <Upload size={14} className="text-ink3" />}
              <span className="min-w-0 flex-1 truncate font-semibold">{i.name}</span>
              {i.state === "laeuft" && <span className="tnum text-ink3">{Math.round(i.progress * 100)} %</span>}
            </div>
            {i.state === "laeuft" && (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-fill2">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${i.progress * 100}%` }} />
              </div>
            )}
            {i.error && <div className="mt-1 text-xs text-bad">{i.error}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dateien irgendwo auf die Seite ziehen */
export function DropZone({ modelId, onDone, children, label }: { modelId?: number; onDone?: (ids: number[]) => void; children: ReactNode; label: string }) {
  const qc = useQueryClient();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (--depth.current <= 0) setOver(false);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void importFiles(qc, files, modelId).then((ids) => onDone?.(ids));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [qc, modelId, onDone]);
  return (
    <>
      {children}
      {over && (
        <div className="anim-fade pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[var(--c-overlay)] p-6">
          <div className="rounded-3xl border-2 border-dashed border-white/80 px-10 py-12 text-center text-white">
            <Upload size={36} className="mx-auto" />
            <div className="mt-3 text-lg font-bold">{label}</div>
            <div className="mt-1 text-sm opacity-80">STL, 3MF, OBJ, STEP, Bilder oder ZIP</div>
          </div>
        </div>
      )}
    </>
  );
}
