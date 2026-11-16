import { ExternalLink } from "lucide-react";
import { clockFixed, ERROR_LEVEL, fmtAt, fmtCode, HMS_LEVEL, hmsLevel, wikiUrl, zoneLabel, type HmsKind } from "../lib/hms.ts";

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

/** Code als Link ins Bambu-Wiki; ohne Text von Bambu nur der Code, das Wiki hat dann keine Seite dazu */
export function WikiCode({ k, kind, link = true, className = "" }: { k: string; kind: HmsKind; link?: boolean; className?: string }) {
  if (!link) return <span className={`font-semibold whitespace-nowrap tnum ${className}`}>{fmtCode(k)}</span>;
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

const FIX_TITLE = (offset: number) => `Automatisch korrigiert: Die Uhr des Druckers steht auf ${zoneLabel(offset)}, Druckwerk rechnet in deine Zeit um`;

/** Zeit einer Meldung in deiner Zeit; umgerechnete Zeiten tragen eine ¹ (Fußnote `ClockNote`) */
export function AtTime({ at, offset, className = "" }: { at: string; offset: number | null; className?: string }) {
  const fixed = clockFixed(offset, at);
  return (
    <span className={`text-ink3 tnum whitespace-nowrap ${className}`} title={fixed ? FIX_TITLE(offset!) : undefined}>
      {fmtAt(at)}
      {fixed && <sup className="ml-px font-bold text-accent">1</sup>}
    </span>
  );
}

/** Fußnote zu `AtTime`, nur wenn mindestens eine Zeit umgerechnet wurde */
export function ClockNote({ ats, offset, className = "" }: { ats: (string | null)[]; offset: number | null; className?: string }) {
  if (!ats.some((a) => a && clockFixed(offset, a))) return null;
  return (
    <p className={`text-[11px] leading-snug text-ink3 ${className}`}>
      <sup className="mr-0.5 font-bold text-accent">1</sup>
      {FIX_TITLE(offset!)}. Das passiert, wenn die Zeitzone am Drucker nicht stimmt, etwa im LAN-Modus ohne Kopplung mit Bambu Handy.
    </p>
  );
}
