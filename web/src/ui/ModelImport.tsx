// Modell per Link: Printables mit Dateien und Bildern, MakerWorld mit Angaben, Bildern und (mit Bambu-Konto) der 3MF des Standardprofils,
// andere Seiten mit Angaben und Bildern über den API-Key
import { useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { go } from "../lib/router.ts";
import { Button, Dialog, Field, useToast } from "./controls.tsx";

export function ModelImportDialog({ collection, onClose }: { collection?: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);

  const run = async () => {
    setBusy(true);
    setError("");
    setStatus("Verbinde …");
    ac.current = new AbortController();
    try {
      const r = await api.importModel(url.trim(), setStatus, ac.current.signal);
      if (collection && !r.existed) await api.setModelCollections(r.id, [collection]);
      await Promise.all(["models", "tags", "collections"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast(r.existed ? "Schon in der Bibliothek" : r.files ? `Modell mit ${r.files === 1 ? "1 Datei" : `${r.files} Dateien`} übernommen` : "Modell angelegt");
      if (r.note && !r.existed) toast(r.note, r.files ? "fehler" : undefined);
      onClose();
      go({ page: "model", id: r.id });
    } catch (e) {
      if (!ac.current?.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <Dialog title="Modell per Link" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Field
          label="Link zum Modell"
          hint="Printables: Angaben, alle Dateien und Bilder. MakerWorld: Angaben, Bilder und mit Bambu-Konto (Einstellungen → MakerWorld) die 3MF des Standardprofils. Andere Seiten: Angaben und Bilder mit API-Key (Einstellungen → Link-Import)."
        >
          <input
            className="field"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.printables.com/model/…"
            required
            autoFocus
            disabled={busy}
          />
        </Field>
        {status && <div className="text-sm text-ink2">{status}</div>}
        {error && <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</div>}
        <div className="flex justify-end">
          <Button kind="primary" busy={busy} disabled={!/^https?:\/\/\S+\.\S+/.test(url.trim())}>
            <Link2 size={16} /> Übernehmen
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
