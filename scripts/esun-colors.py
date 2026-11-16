#!/usr/bin/env python3
# Baut server/seed/esun.json (Seed für den Farbkatalog in der Datenbank). Sorten und Hex aus der Farbtabelle der Herstellerseite
# www.esun3d.com, dazu Farben, die nur der offizielle Shop esun3dstore.com führt (Hex dann aus derselben eSUN-Farbe einer anderen
# Sorte, sonst SpoolmanDB, sonst unbekannt). Im Verzeichnis <dir> vorher ablegen:
#   official.json, shop.json    scripts/esun-scrape.js im Browser auf www.esun3d.com bzw. esun3dstore.com (Cloudflare)
#   esun.json                   https://raw.githubusercontent.com/Donkie/SpoolmanDB/main/filaments/esun.json
# Aufruf: python3 scripts/esun-colors.py <dir> server/seed/esun.json
# Ist eSUN schon in der Datenbank, übernimmt der Server die Datei nicht erneut: Marke in der App löschen und Eintrag
# aus catalog_seeded entfernen, dann neu starten.
import json, os, re, sys

# Einzeln recherchierte Hex-Werte (scripts/hex-recherche.json, mit Quelle); Farben ohne belegten Hex nimmt der Katalog nicht auf
EXTRA = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "hex-recherche.json")))

d = sys.argv[1]
OFF = json.load(open(f"{d}/official.json"))
SHOP = json.load(open(f"{d}/shop.json"))
SDB = json.load(open(f"{d}/esun.json"))["filaments"]

# Sorten in Anzeigereihenfolge: (Material, Sorte, Seite auf esun3d.com, Shop-Produkte, Bambu-Profil). Material = Grundmaterial
# wie bei Sunlu (PLA+ zählt zu PLA). Nur Bambu Studio kennt ein eigenes eSUN-Profil (GFL03 eSUN PLA+), sonst wählt autoProfile.
LINES = [
    ("PLA", "PLA Basic", "pla-basic", ["epla"], None),
    ("PLA", "PLA+", "pla-pro", ["pla-pro", "pla-refilament"], "GFL03"),
    ("PLA", "PLA+ HS", "eplahs", ["epla-pro-hs"], None),
    ("PLA", "PLA HS", "epla-hs", [], None),
    ("PLA", "PLA HF", "pla-hf", ["pla-hf"], None),
    ("PLA", "PLA Lite", "epla-lite", ["epla-lite"], None),
    ("PLA", "PLA Matte", "epla-matte", ["epla-matte"], None),
    ("PLA", "PLA Matte Dual", "epla-matte-dual", [], None),
    ("PLA", "PLA Matte Rainbow", "epla-matte-rainbow-2", [], None),
    ("PLA", "PLA Silk", "esilk-pla", ["epla-silk", "epla-silk-metal"], None),
    ("PLA", "PLA Silk Rainbow", "epla-silk-rainbow", ["epla-silk-rainbow"], None),
    ("PLA", "PLA Silk Magic", "esilk-pla-magic", ["epla-silk-magic"], None),
    ("PLA", "PLA Silk Mystic", "esilk-pla-mystic", [], None),
    ("PLA", "PLA Silk Candy", "epla-silk-candy", ["epla-silk-candy"], None),
    ("PLA", "PLA Metal", "epla-metal", ["epla-metal"], None),
    ("PLA", "PLA Magic", "epla-magic", ["epla-magic"], None),
    ("PLA", "PLA Twinkling", "etwinkling", [], None),
    ("PLA", "PLA Stars", "estars-pla", [], None),
    ("PLA", "PLA Chameleon", None, ["epla-chameleon"], None),
    ("PLA", "PLA Marble", "emarble", [], None),
    ("PLA", "PLA Rock", "pla-rock", ["pla-rock"], None),
    ("PLA", "PLA Wood", "wood", ["pla-wood"], None),
    ("PLA", "PLA Coffee", "pla-coffee", [], None),
    ("PLA", "PLA Clear", "pla-clear", [], None),
    ("PLA", "PLA Clear Rainbow", "pla-clear-rainbow", [], None),
    ("PLA", "PLA Luminous", "epla-luminous", ["epla-luminous"], None),
    ("PLA", "PLA UV Color Change", "pla-uv-cc", ["pla-uv-color-change"], None),
    ("PLA", "PLA+ CMYK", "cmyk", ["pla-cmyk"], None),
    ("PLA", "PLA ST", "epla-st", ["epla-st"], None),
    ("PLA", "PLA LW", None, ["epla-lw"], None),
    ("PLA", "PLA Revive", "pla-revive", [], None),
    ("PLA-CF", "PLA-CF", "epla-cf", ["epla-cf"], None),
    ("PETG", "PETG", "petg", ["petg"], None),
    ("PETG", "PETG Basic", "epetg-lite", ["petg-basic"], None),
    ("PETG", "PETG+", "petg-pro", [], None),
    ("PETG", "PETG+ HS", "epetg-hs", ["epetg-hs"], None),
    ("PETG", "PETG Matte", "petg-matte", ["petg-matte"], None),
    ("PETG", "PETG Luminous", "pet-luminous", ["petg-luminous"], None),
    ("PETG", "PETG UV Color Change", "petg-uv-color-change", [], None),
    ("PETG", "PETG-ESD", "petg-esd", [], None),
    ("PETG-CF", "PETG-CF", "epetg-cf", ["petg-cf"], None),
    ("PET", "PET", None, ["pet"], None),
    ("PET", "PET-FR", "pet-fr", [], None),
    ("PET-CF", "PET-CF", "pet-cf", [], None),
    ("ABS", "ABS", "abs", [], None),
    ("ABS", "ABS+", "abs-pro", ["abs-pro"], None),
    ("ABS", "ABS+ HS", "eabshs", ["eabs-pro-hs"], None),
    ("ABS", "ABS-HT", "eabs-ht", [], None),
    ("ABS", "ABS-FR", "eabs-max", [], None),
    ("ABS", "ABS-ESD", "abs-esd", [], None),
    ("ABS-CF", "ABS-CF", "eabs-cf", ["abs-cf"], None),
    ("ABS-GF", "ABS-GF", "eabs-gf", [], None),
    ("ASA", "ASA+", "asa-pro", ["easa"], None),
    ("ASA", "ASA-LW", "asa-lw", [], None),
    ("TPU", "TPU 95A", "etpu-95a", ["tpu-95a"], None),
    ("TPU", "TPU 95A Rainbow", "tpu-95a-rainbow", [], None),
    ("TPU", "TPU 87A", "eflex-tpu-87a", [], None),
    ("TPU", "TPU 64D", "tpu64d", [], None),
    ("TPU", "TPU LW", "etpu-lw", ["tpu-lw"], None),
    ("TPE", "TPE 83A", "elastic-tpe-83a", ["tpe-83a"], None),
    ("PEBA", "PEBA 90A", "peba", ["peba-90a"], None),
    ("PEBA", "PEBA 85A", "peba-85a", ["peba-85a"], None),
    ("PEBA", "PEBA LW", "peba-lw", ["peba-lw"], None),
    ("PA", "PA", "epa", ["epa"], None),
    ("PA", "PA12", "epa12", [], None),
    ("PA-CF", "PA-CF", "epa-cf", [], None),
    ("PA12-CF", "PA12-CF", "epa12cf", [], None),
    ("PC", "PC-HT", "pc-ht", [], None),
    ("PC", "PC-ESD", "pc-esd", [], None),
    ("HIPS", "HIPS", "hips", [], None),
    ("PVA", "PVA", "pva", [], None),
    ("PEEK", "PEEK Industrial", "epeek-industrial", [], None),
]

# Schreibweisen des Shops auf die der Herstellerseite bringen (Tippfehler, andere Wörter für dieselbe Farbe)
FIX = {"deep black": "Black", "morning glory": "Morning Glow", "periwinkle blue": "Very Peri", "blackish green": "Dark Green",
       "deep blue": "Dark Blue"}
WORD = {"gray": "Grey", "sliver": "Silver", "bule": "Blue", "brone": "Bronze"}
KEEP = {"RGB", "CMYK", "UV"}


def title(s):
    return " ".join(w if w.upper() in KEEP and w.isupper() else "-".join(p.capitalize() for p in w.split("-")) for w in s.split())


def clean(raw, line):
    s = re.sub(r"\s*\+\s*", " ", raw.strip())  # „Red+Gold“ → „Red Gold“
    s = re.sub(r"^Translucentlight ", "Translucent Light ", s, flags=re.I)
    s = re.sub(r"^Transparent ", "Translucent ", s, flags=re.I)
    if "Silk" in line:
        s = re.sub(r"^Silk ", "", s, flags=re.I)
    s = re.sub(r"^Solid ", "", s, flags=re.I)
    s = FIX.get(s.lower(), " ".join(WORD.get(w.lower(), w) for w in s.split()))
    return title(s)


MULTI = {"PLA Matte Dual", "PLA Matte Rainbow", "PLA Silk Magic", "PLA Silk Mystic", "PLA Silk Candy", "PLA Rock", "PLA Clear Rainbow"}


def key(name, line=""):
    w = re.sub(r"[^a-z0-9 ]", " ", name.lower()).split()
    return " ".join(sorted(w)) if line in MULTI else " ".join(w)  # Mehrfarbige ohne Reihenfolge: „Red Black“ = „Black Red“


def official(slug):
    """Farben einer Seite: [(name, hex)]. Mehrfarbige haben je Teilfarbe eine Zeile, die Vorschau nennt die ganze Farbe; Hex der ersten Teilfarbe"""
    o = OFF[slug]
    rows, names = o["rows"], o["names"]
    if len(rows) == len(names):
        return [(title(n), h) for n, h in rows]
    out, i = [], 0
    for n in names:
        rest, first = n.upper().replace("-", " ").split(), None
        while i < len(rows) and rest:
            part = rows[i][0].upper().replace("-", " ").split()
            if rest[: len(part)] == part:
                rest = rest[len(part):]
            elif part == n.upper().split():  # Teilfarben mit dem ganzen Namen („BLACK CORAL PINK“ zweimal)
                pass
            else:
                break
            first = first or rows[i][1]
            i += 1
            while i < len(rows) and rows[i][0].upper() == n.upper() and part == n.upper().split():
                i += 1
        out.append((title(n), first))  # ohne Tabellenzeile (z. B. Lavendel bei PETG) bleibt Hex leer
    return out


# eSUN nutzt je Farbname einen Hex über alle einfarbigen Sorten (BLACK = 272729 überall): Grundlage für Shop-Farben ohne Tabelle
PALETTE = {}
for slug, o in OFF.items():
    if len(o["rows"]) == len(o["names"]):
        for n, h in o["rows"]:
            PALETTE.setdefault(key(n), h)

# SpoolmanDB: (Grundmaterial, Farbe) → Hex
SDBHEX = {}
for f in SDB:
    m = {"PLA+": "PLA", "ABS+": "ABS", "TPU-95A": "TPU"}.get(f["material"], f["material"])
    for c in f["colors"]:
        if c.get("hex"):
            SDBHEX.setdefault((m, key(c["name"])), c["hex"].upper()[:6])

SKIP = {"eSpool+", "CMYK Bundle"}
out, missing, fromshop = [], [], set()
for mat, name, slug, shops, profile in LINES:
    cols = {}
    for n, h in official(slug) if slug else []:
        cols.setdefault(key(n, name), [n, h])
    for s in shops:
        for raw in SHOP[s]["colors"]:
            if raw in SKIP:
                continue
            n = clean(raw, name)
            k = key(n, name)
            if k in cols:
                continue
            multi = name in MULTI or "+" in raw
            hx = None if multi else PALETTE.get(key(n)) or SDBHEX.get((mat, key(n)))
            cols[k] = [n, hx]
            fromshop.add((name, n))
    if not cols:
        sys.exit(f"Sorte ohne Farben: {name}")
    for n, h in cols.values():
        if not h:
            missing.append(f"{name}: {n}")
    out.append({"material": mat, "name": name, "profile_id": profile, "colors": [{"name": n, "hex": h, "code": None} for n, h in cols.values()]})

# Die Shop-Produkte PLA-Matte und PLA-Silk Magic führen auch Farben anderer Sorten: dorthin, wo der Name schon steht, sonst nach Art
# (zwei Grundfarben = Matte Dual, Regenbogen = Matte Rainbow, drei Farben = Silk Mystic)
BASE = {"black", "white", "red", "blue", "green", "yellow", "purple", "pink", "gold", "silver", "copper", "orange"}
byname = {l["name"]: l for l in out}
for src, dests, rule in [
    ("PLA Matte", ["PLA Matte Dual", "PLA Matte Rainbow"],
     lambda w: "PLA Matte Rainbow" if w in (["fruit", "candy"], ["rainbow"]) else "PLA Matte Dual" if len(w) == 2 and set(w) <= BASE else None),
    ("PLA Silk Magic", ["PLA Silk Mystic"], lambda w: "PLA Silk Mystic" if len(w) == 3 else None),
]:
    keep = []
    for c in byname[src]["colors"]:
        hit = next((dl for dl in dests if any(key(x["name"], dl) == key(c["name"], dl) for x in byname[dl]["colors"])), None)
        if not hit and (src, c["name"]) in fromshop and (hit := rule(c["name"].lower().split())):
            byname[hit]["colors"].append(c)
            if c["hex"] is None:
                missing[missing.index(f"{src}: {c['name']}")] = f"{hit}: {c['name']}"
            continue
        if not hit:
            keep.append(c)
        elif f"{src}: {c['name']}" in missing:
            missing.remove(f"{src}: {c['name']}")
    byname[src]["colors"] = keep

ex = EXTRA.get("eSUN", {})
for l in out:
    for c in l["colors"]:
        c["hex"] = c["hex"] or (ex.get(f"{l['name']}|{c['name']}") or {}).get("hex")
    l["colors"] = [c for c in l["colors"] if c["hex"]]
missing = [m for m in missing if not ex.get(m.replace(": ", "|", 1))]
out = [l for l in out if l["colors"]]
print(f"{len(out)} Sorten, {sum(len(l['colors']) for l in out)} Farben, {len(missing)} ohne Hex", file=sys.stderr)
for m in missing:
    print("  ?", m, file=sys.stderr)

seed = {
    "brand": "eSUN",
    "match": "esun",
    "url": "https://esun3dstore.com",
    "source": "Herstellerseite esun3d.com (Sorten, Farbtabelle mit Hex), Shop esun3dstore.com (weitere Farben), sonst SpoolmanDB (MIT), einzeln recherchierte in scripts/hex-recherche.json; Farben ohne belegten Hex fehlen",
    "lines": out,
}
with open(sys.argv[2], "w") as f:
    json.dump(seed, f, ensure_ascii=False, indent=1)
    f.write("\n")
