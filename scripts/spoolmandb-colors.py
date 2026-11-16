#!/usr/bin/env python3
# Baut Seeds für den Farbkatalog aus SpoolmanDB (https://github.com/Donkie/SpoolmanDB, MIT) für Marken ohne eigene Hex-Quelle.
# Sorten aus den SpoolmanDB-Einträgen (gleiche Sorte über Gewichte/NFC/Nachfüllrolle zusammengelegt), Farben mit Hex.
# Vorher die Dateien filaments/<datei>.json nach <dir> laden, z. B.
#   for f in polymaker elegoo prusament extrudr dasfilament anycubic overture 3djake; do
#     curl -sLo <dir>/$f.json https://raw.githubusercontent.com/Donkie/SpoolmanDB/main/filaments/$f.json; done
# Aufruf: python3 scripts/spoolmandb-colors.py <dir> server/seed
# Ist eine Marke schon in der Datenbank, übernimmt der Server die Datei nicht erneut: Marke in der App löschen und Eintrag
# aus catalog_seeded entfernen, dann neu starten.
import json, os, re, sys

# Einzeln recherchierte Hex-Werte (scripts/hex-recherche.json, mit Quelle); Farben ohne belegten Hex nimmt der Katalog nicht auf
EXTRA = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "hex-recherche.json")))

d, outdir = sys.argv[1], sys.argv[2]

# Datei → Marke, Stichwort im Markennamen der Spule, Shop. Name der Seed-Datei = Stichwort
BRANDS = {
    "polymaker": ("Polymaker", "polymaker", "https://polymaker.com"),
    "elegoo": ("Elegoo", "elegoo", "https://eu.elegoo.com/collections/filaments"),
    "prusament": ("Prusament", "prusa", "https://www.prusa3d.com/category/prusament/"),
    "extrudr": ("Extrudr", "extrudr", "https://www.extrudr.com"),
    "dasfilament": ("Das Filament", "das filament", "https://www.dasfilament.de"),
    "anycubic": ("Anycubic", "anycubic", "https://store.anycubic.com/collections/filament"),
    "overture": ("Overture", "overture", "https://overture3d.com"),
    "3djake": ("3DJake", "3djake", "https://www.3djake.de"),
}

# Grundmaterial der Sorte (Gruppe im Katalog). Extrudr-Eigennamen: BioFusion, Flax und Pearl sind PLA-Mischungen, GreenTEC ein Copolyester
MATERIAL = {"PLA+": "PLA", "TPU-95A": "TPU", "WOOD": "PLA", "BIOFUSION": "PLA", "FLAX": "PLA", "PEARL": "PLA", "PCPBT": "PC-PBT",
            "PCPBT-CF": "PC-PBT-CF", "GREENTEC": "GreenTEC", "GREENTEC-CF": "GreenTEC-CF"}
# Sortenname ohne Material davor, wo der SpoolmanDB-Name schon ein Produktname ist
OWN = {"polymaker"}
# Einzelne Farben, die eigentlich eine eigene Sorte sind: (datei, farbe) → Sorte
COLOR_LINE = {("prusament", "Tungsten 75%"): "PETG Tungsten 75%", ("prusament", "Recycled"): None, ("prusament", "Recycled Black"): None}
RENAME = {
    ("prusament", "PLA", "rPLA"): "rPLA", ("prusament", "WOOD", ""): "Woodfill", ("prusament", "PEI", "1010"): "PEI 1010",
    ("prusament", "PC-CF", "PC Blend Carbon Fiber"): "PC Blend Carbon Fiber", ("prusament", "PC-CF", "Space Grade"): "PC-CF Space Grade",
    ("prusament", "TPU-95A", ""): "TPU 95A", ("prusament", "PC", "Blend"): "PC Blend", ("prusament", "PLA", "Blend"): "PLA Blend",
    ("extrudr", "BIOFUSION", ""): "BioFusion", ("extrudr", "FLAX", ""): "Flax", ("extrudr", "PEARL", ""): "Pearl", ("extrudr", "WOOD", ""): "Wood",
    ("extrudr", "GREENTEC", ""): "GreenTEC", ("extrudr", "GREENTEC", "Pro"): "GreenTEC Pro", ("extrudr", "GREENTEC-CF", "Pro"): "GreenTEC Pro CF",
    ("extrudr", "TPU", "FLEX Hard"): "Flex Hard", ("extrudr", "TPU-CF", "FLEX Hard"): "Flex Hard CF", ("extrudr", "TPU", "FLEX Medium"): "Flex Medium",
    ("extrudr", "TPU", "FLEX Medium-ESD"): "Flex Medium ESD", ("extrudr", "TPU", "FLEX Semisoft"): "Flex Semisoft",
    ("extrudr", "PETG", "X REC"): "PETG X REC", ("extrudr", "PLA", "NX2-MATT"): "PLA NX2 Matt", ("extrudr", "PETG", "MATT"): "PETG Matt",
    ("elegoo", "PETG", "RAPID PETG"): "Rapid PETG", ("elegoo", "PLA+", "RAPID PLA+"): "Rapid PLA+", ("elegoo", "PETG", "PETG PRO"): "PETG Pro",
    ("anycubic", "PLA", "Glow"): "PLA Glow", ("overture", "PLA", "Rock PLA"): "PLA Rock", ("overture", "PLA", "Silk PLA"): "PLA Silk",
    ("overture", "PLA", "Matte PLA"): "PLA Matte", ("overture", "TPU", "High Speed 95A"): "TPU High Speed 95A",
}


def raw_name(n):
    n = n.replace("{color_name}", " ").replace("™", "")
    n = re.sub(r"\(NFC\)|- Refill", "", n)
    n = re.sub(r"\s+-\s+", " ", n).replace(" -", " ")
    return re.sub(r"\s+", " ", n).strip(" -")


def label(f, material, n):
    if (f, material, n) in RENAME:
        return RENAME[(f, material, n)]
    if n == "DuraPro":
        return f"DuraPro {MATERIAL.get(material, material)}"
    if f in OWN:
        return n.replace("Polymaker ", "")
    if not n:
        return material
    if n.upper().startswith(material.upper()):
        return n
    return f"{material} {n}"


for f, (brand, match, url) in BRANDS.items():
    lines = {}
    for e in json.load(open(f"{d}/{f}.json"))["filaments"]:
        m = e["material"]
        name = label(f, m, raw_name(e["name"]))
        for c in e["colors"]:
            ln = COLOR_LINE.get((f, c["name"]), name) or ("rPLA" if m == "PLA" else "rPETG")
            l = lines.setdefault(ln, {"material": MATERIAL.get(m, m), "name": ln, "profile_id": None, "colors": {}})
            hx = (c.get("hex") or (c.get("multi_color_hexes") or [None])[0] or "").upper()[:6] or None
            l["colors"].setdefault(c["name"].strip().lower(), {"name": c["name"].strip(), "hex": hx, "code": None})
    ex = EXTRA.get(brand, {})
    for l in lines.values():
        for c in l["colors"].values():
            c["hex"] = c["hex"] or (ex.get(f"{l['name']}|{c['name']}") or {}).get("hex")
    out = [{**l, "colors": [c for c in l["colors"].values() if c["hex"]]} for l in lines.values()]
    out = [l for l in out if l["colors"]]
    order = ["PLA", "PETG", "ABS", "ASA", "TPU", "PC", "PA"]
    out.sort(key=lambda l: next((i for i, o in enumerate(order) if l["material"].startswith(o)), len(order)))
    seed = {"brand": brand, "match": match, "url": url, "source": "SpoolmanDB (MIT), github.com/Donkie/SpoolmanDB, einzeln recherchierte in scripts/hex-recherche.json; Farben ohne belegten Hex fehlen", "lines": out}
    fn = re.sub(r"[^a-z0-9]+", "-", match).strip("-")
    json.dump(seed, open(f"{outdir}/{fn}.json", "w"), ensure_ascii=False, indent=1)
    open(f"{outdir}/{fn}.json", "a").write("\n")
    print(f"{brand}: {len(out)} Sorten, {sum(len(l['colors']) for l in out)} Farben", file=sys.stderr)
    for l in out:
        print("   ", l["material"], "|", l["name"], "|", len(l["colors"]), file=sys.stderr)
