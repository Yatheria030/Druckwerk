import { ExternalLink } from "lucide-react";
import { ERROR_LEVEL, fmtCode, HMS_LEVEL, hmsLevel, wikiUrl, type HmsKind } from "../lib/hms.ts";

export type Tone = "bad" | "warn" | "info";
export const TONE_TAG: Record<Tone, string> = { bad: "bg-bad-soft text-bad", warn: "bg-accent-soft text-accent", info: "bg-fill text-ink2" };
export const TONE_TEXT: Record<Tone, string> = { bad: "text-bad", warn: "text-accent", info: "text-ink2" };

/** Stufe einer Meldung: HMS aus dem Code (Fatal/Fehler rot), Druckfehler danach, ob der Drucker abbricht oder pausiert */
export function levelOf(key: string, kind: HmsKind): { label: string; tone: Tone } {
  if (kind === "hms") {
    const l = hmsLevel(key);
    return { label: HMS_LEVEL[l] ?? "Meldung", tone: l <= 2 ? "bad" : l === 3 ? "warn" : "info" };
  }
  const l = key[4];
  return { label: ERROR_LEVEL[l] ?? "Druckfehler", tone: l === "4" ? "bad" : l === "8" ? "warn" : "info" };
}

/** Code als Link ins Bambu-Wiki */
export function WikiCode({ k, kind, className = "" }: { k: string; kind: HmsKind; className?: string }) {
  return (
    <a
      href={wikiUrl(k, kind)}
      target="_blank"
      rel="noreferrer noopener"
      title="Im Bambu-Wiki öffnen"
      className={`inline-flex items-center gap-1 font-semibold whitespace-nowrap tnum underline decoration-1 underline-offset-2 hover:text-accent ${className}`}
    >
      {fmtCode(k)}
      <ExternalLink size={12} className="shrink-0 opacity-60" />
    </a>
  );
}

export const NO_TEXT = "Kein Text von Bambu Lab, Details im Wiki";
