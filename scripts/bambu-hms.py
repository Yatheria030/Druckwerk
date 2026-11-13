#!/usr/bin/env python3
"""Fehlertexte der Bambu-Drucker (HMS und Druckfehler, alle Modelle) nach server/hms.json.

Quelle ist dieselbe Liste, die Bambu Studio und Handy laden (e.bambulab.com/query.php). Deutsch, leere Texte aus der
englischen Liste. Nur bei Bedarf von Hand ausführen, die App selbst fragt Bambu nie.
"""
import json
import pathlib
import urllib.request

URL = "https://e.bambulab.com/query.php?lang={}"
OUT = pathlib.Path(__file__).resolve().parent.parent / "server" / "hms.json"


def load(lang):
    req = urllib.request.Request(URL.format(lang), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    if d.get("result") != 0:
        raise SystemExit(f"Antwort {d.get('result')} für {lang}")
    return d


de, en = load("de"), load("en")


def table(kind):
    out = {}
    for lang, d in (("en", en), ("de", de)):  # Deutsch überschreibt Englisch, leere Texte nicht
        for e in d["data"][kind][lang]:
            text = " ".join((e.get("intro") or "").split())
            if text:
                out[e["ecode"].upper()] = text
    return dict(sorted(out.items()))


data = {"ver": de["ver"], "hms": table("device_hms"), "error": table("device_error")}
OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
print(f"{OUT}: {len(data['hms'])} HMS, {len(data['error'])} Druckfehler, Stand {data['ver']}")
