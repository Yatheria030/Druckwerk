#!/usr/bin/env python3
# Baut server/seed/sunlu.json (Seed für den Farbkatalog in der Datenbank): Linien und Farbnamen aus dem offiziellen Shop. Hex-Werte zuerst aus der offiziellen Farbtabelle
# der Produktseite (je Sorte eigene Codes), sonst SpoolmanDB. Im Verzeichnis <dir> vorher ablegen:
#   sunlu.json                  https://raw.githubusercontent.com/Donkie/SpoolmanDB/main/filaments/sunlu.json
#   shop-store.sunlu.com.json,  https://store.sunlu.com/products.json?limit=250&page=1
#   shop-p2.json, shop-p3.json  dasselbe mit page=2 und page=3
#   hex-en.json, hex-de.json    Farbtabellen von store.sunlu.com und de.store.sunlu.com (scripts/sunlu-hex-tables.py)
# Aufruf: python3 scripts/sunlu-colors.py <dir> server/seed/sunlu.json
# Ist Sunlu schon in der Datenbank, übernimmt der Server die Datei nicht erneut: Marke in der App löschen und Eintrag
# aus catalog_seeded entfernen, dann neu starten.
import json, re, sys
from collections import OrderedDict

d = sys.argv[1]
ps = []
for f in ["shop-store.sunlu.com.json", "shop-p2.json", "shop-p3.json"]:
    ps += json.load(open(f"{d}/{f}"))["products"]
sdb = json.load(open(f"{d}/sunlu.json"))["filaments"]

GENERIC = {"blue", "red", "yellow", "green", "purple", "pink", "orange", "gold", "skin", "coffee", "wood", "white", "grey", "black"}
FIX = {"oliver green": "Olive Green", "midnigh": "Midnight", "gray": "Grey", "vivid yellow": "Vivid Yellow", "coffee-brown": "Coffee Brown",
       "mint": "Mint Green", "dark gray": "Dark Grey", "natural color": "Natural", "roasted chestnut": "Roasted Chestnut Black",
       "midnight black": "Midnight", "ceramic": "Ceramic White", "oak": "Oak", "clear": "Transparent", "pink(sakura pink)": "Sakura Pink",
       "oliver green/dark green": "Olive Green", "magentapurple": "Lavender Purple", "maple wood": "Maple", "walnut wood": "Walnut",
       "cherry wood": "Cherry"}


def title(s):
    w = re.sub(r"[A-Za-z]+", lambda m: m.group(0) if m.group(0).isupper() and len(m.group(0)) > 1 else m.group(0).capitalize(), s)
    return w.replace("Cmyk", "CMYK")


def clean(raw, prefixes=()):
    s = raw.strip()
    s = re.sub(r"\s*\d+(\.\d+)?\s*kg(/roll)?\b", "", s, flags=re.I).strip()  # „Black 1KG“, „White 0.8kg/roll“
    s = re.sub(r"\s*\((Removable|≈).*$", "", s)
    s = re.sub(r"\s*\d+(\.\d+)?\s*KG\b", "", s)
    for p in prefixes:
        s = re.sub(r"^" + p, "", s, flags=re.I).strip()
    s = s.replace(" Filament", "")
    alias = None
    m = re.match(r"^(.*?)\s*\((.*?)\)\s*(.*)$", s)
    if m:
        a, b, rest = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
        if rest:  # „White (Glow Green)“ bleibt wie es ist
            s = f"{a} ({b}) {rest}".strip()
        elif re.match(r"glow", b, re.I):
            s = f"{a} ({b})"
        else:
            s, alias = (b, a) if a.lower() in GENERIC and len(b.split()) > 1 or a.lower() == "skin" else (a, b)
    s = FIX.get(s.lower(), s)
    if alias:
        alias = FIX.get(alias.lower(), alias)
    return title(s), alias


# SpoolmanDB: Linie → {farbname: hex}
SYN = {"roastedchestnutblack": "roastedchestnut", "midnightblack": "midnight", "coffee": "coffeebrown", "ashenconcrete": "ashen"}


def key(n):
    k = re.sub(r"[^a-z0-9]", "", n.lower().replace("grey", "gray").replace("oliver", "olive"))
    return SYN.get(k, k)


SDB = {}
for f in sdb:
    lk = (f["material"], f["name"].replace("{color_name}", "").replace(" - ", " ").strip())
    for c in f["colors"]:
        hx = c.get("hex") or (c.get("multi_color_hexes") or [None])[0]
        if hx:
            SDB.setdefault(lk, {})[key(c["name"])] = hx.upper()[:6]
ANY = {}
for lk, cs in SDB.items():
    for k, hx in cs.items():
        ANY.setdefault(k, hx)


def sdb_line(material, sdbname):
    return SDB.get((material, sdbname), {})


# Linien: (material, sorte, spoolmandb-linie(n)) – Reihenfolge = Anzeige
LINES = OrderedDict()


def line(material, name, sdb=()):
    k = (material, name)
    if k not in LINES:
        LINES[k] = {"material": material, "name": name, "sdb": list(sdb), "colors": OrderedDict()}
    return LINES[k]


def add(l, raw, prefixes=()):
    n, alias = clean(raw, prefixes)
    if not n or re.search(r"\*\d|^\d+ Rolls?", n):
        return
    k = key(n)
    if k not in l["colors"]:
        l["colors"][k] = {"name": n, "alias": alias}
    elif alias and not l["colors"][k]["alias"]:
        l["colors"][k]["alias"] = alias


# Reihenfolge festlegen
for m, n, s in [
    ("PLA", "Basic", [("PLA", "")]), ("PLA", "Matte", [("PLA", "Matte")]), ("PLA", "Meta", [("PLA", "Meta")]),
    ("PLA", "High Speed", [("PLA", "High Speed")]), ("PLA", "High Speed Matte", [("PLA", "High Speed Matte")]),
    ("PLA", "Lite", [("PLA", "Lite")]), ("PLA", "Transparent", [("PLA", "Transparent")]), ("PLA", "Fluorescent", []),
    ("PLA", "Pastel", []), ("PLA", "Vibrant", []), ("PLA", "Glow", [("PLA", "")]), ("PLA", "Marble", [("PLA", "High Speed  Marble")]),
    ("PLA", "Galaxy", []), ("PLA", "Twinkling", []), ("PLA", "Metallic", []), ("PLA", "Wood", [("WOOD", "")]),
    ("PLA", "Anti-String", [("PLA", "Anti-string")]), ("PLA", "Lightweight", [("PLA", "Lightweight")]),
    ("PLA", "Matte Dual-Color", []), ("PLA", "Rainbow", []), ("PLA-CF", "Basic", [("PLA-CF", "")]),
    ("PLA+", "Basic", [("PLA+", "")]), ("PLA+", "2.0", [("PLA+", "2.0")]), ("PLA+", "High Speed", []), ("PLA+", "High Speed 2.0", []),
    ("PLA+", "Silk", [("PLA+", "Silk")]), ("PLA+", "Silk 2.0", [("PLA+", "Silk 2.0")]), ("PLA+", "Silk Multi-Color", []),
    ("PLA+", "Silk Rainbow", []),
    ("PETG", "Basic", [("PETG", "")]), ("PETG", "2.0", [("PETG", "2.0")]), ("PETG", "High Speed Matte", [("PETG", "High Speed Matte PETG")]),
    ("PETG", "Glow", []), ("PETG", "Rainbow", []), ("PETG-CF", "Basic", [("PETG-CF", "")]),
    ("ABS", "Basic", [("ABS", "")]), ("ABS", "Easy", []), ("ABS-FR", "Basic", [("ABS", "FR")]), ("ABS-GF", "Basic", [("ABS-GF", "")]),
    ("ASA", "Basic", [("ASA", "")]), ("TPU", "95A", [("TPU-95A", "")]), ("TPU", "90A", [("TPU-90A", "")]), ("TPU", "Silk", [("TPU", "Silk")]),
    ("PC", "Basic", [("PC", "")]), ("PC-ABS", "Basic", [("PC+ABS", "")]), ("PA", "Easy", [("PA", "Easy")]),
    ("PA6-CF", "Basic", [("PA6-CF", "")]), ("PA6-GF", "Basic", [("PA6-GF", "")]), ("PA12-CF", "Basic", [("PA12-CF", "")]),
    ("PP", "Basic", []), ("PP", "2.0", [("PP", "2.0")]), ("PEEK", "Basic", [("PEEK", "")]), ("PVB", "Basic", []),
]:
    line(m, n, s)


def opt(v, *names):
    for i, o in enumerate(v["_opts"]):
        if any(re.match(n, o, re.I) for n in names):
            return v[f"option{i + 1}"]
    return None


skip = re.compile(r"Dryer|Connector|Cabinet|Bundle|Gift|Collection|Clearance|Special|Large Spool|3KG|5KG|250g|Resin|Heater", re.I)
for p in ps:
    t = p["title"]
    if skip.search(t):
        continue
    names = [o["name"].strip() for o in p["options"]]
    for v in p["variants"]:
        v["_opts"] = names
        col = opt(v, r"^Color$", r"^Material/Color", r"^Color/Type", r"^Size/Color")
        mat = opt(v, r"^Material$", r"^Material type", r"^Item$", r"^ITEM$")
        T = t.upper()
        if t.startswith("[Refill"):
            mp = {"PLA Refill": ("PLA", "Basic"), "PETG Refill": ("PETG", "Basic"), "PLA+ Refill": ("PLA+", "Basic"),
                  "PLA+ 2.0 Refill": ("PLA+", "2.0"), "Matte PLA Refill": ("PLA", "Matte")}
            if mat in mp:
                add(LINES[mp[mat]], col)
        elif t.startswith("SUNLU PLA 3D Printer"):
            sub = {"PLA": "Basic", "PLA Fluorescent": "Fluorescent", "PLA Transparent": "Transparent", "PLA Pastel": "Pastel", "PLA Vibrant": "Vibrant"}[mat]
            add(LINES[("PLA", sub)], col, ("PLA ", "Fluorescent "))
        elif "MATTE PLA DUAL" in T:
            add(LINES[("PLA", "Matte Dual-Color")], col)
        elif "HIGH SPEED MATTE PLA" in T or (t.startswith("SUNLU Matte PLA") and mat == "High Speed Matte PLA"):
            add(LINES[("PLA", "High Speed Matte")], col, ("Matte ",))
        elif t.startswith("SUNLU Matte PLA"):
            add(LINES[("PLA", "Matte")], col, ("Matte ",))
        elif "MACARON" in T:
            add(LINES[("PLA", "Meta")], col, ("Meta ",))
        elif "PLA MARBLE" in T:
            add(LINES[("PLA", "Marble")], re.sub(r"\s*Marble$", "", col))
        elif "HIGH SPEED PLA+ 2.0" in T:
            add(LINES[("PLA+", "High Speed 2.0")], col)
        elif "HIGH SPEED PLA+" in T:
            add(LINES[("PLA+", "High Speed")], col)
        elif "HIGH SPEED PLA" in T:
            add(LINES[("PLA", "High Speed")], col)
        elif "HIGH SPEED MATTE PETG" in T:
            add(LINES[("PETG", "High Speed Matte")], col)
        elif "PETG GLOW" in T:
            add(LINES[("PETG", "Glow")], col)
        elif "GLOW IN THE DARK" in T:
            add(LINES[("PLA", "Glow")], col)
        elif "PETG 2.0" in T:
            add(LINES[("PETG", "2.0")], col)
        elif "PETG-CF" in T:
            add(LINES[("PETG-CF", "Basic")], col)
        elif t.startswith("SUNLU PETG"):
            add(LINES[("PETG", "Basic")], col, ("PETG ",))
        elif "SILK PLA+ 2.0" in T:
            add(LINES[("PLA+", "Silk 2.0")], col)
        elif "MULTI-COLOR SILK" in T:
            add(LINES[("PLA+", "Silk Multi-Color")], col.replace(" | ", " "))
        elif "SILK PLA PLUS" in T:
            add(LINES[("PLA+", "Silk")], col, ("Silk ",))
        elif "RAINBOW" in T:
            sub = {"PLA Rainbow": ("PLA", "Rainbow"), "SILK Rainbow": ("PLA+", "Silk Rainbow"), "PETG Rainbow": ("PETG", "Rainbow")}[mat]
            add(LINES[sub], col)
        elif "PLA+ 2.0" in T:
            add(LINES[("PLA+", "2.0")], col, (r"PLA\+ 2\.0 \| ",))
        elif "PLA+(PLA PLUS)" in T:
            add(LINES[("PLA+", "Basic")], col, (r"PLA\+ ",))
        elif "GALAXY" in T:
            add(LINES[("PLA", "Galaxy")], col)
        elif "TWINKLING" in T:
            add(LINES[("PLA", "Twinkling")], col, ("Twinkling ",))
        elif "METALLIC" in T:
            add(LINES[("PLA", "Metallic")], col)
        elif "WOOD PLA" in T:
            add(LINES[("PLA", "Wood")], re.sub(r"\s*Wood\b", "", col) or "Wood")
        elif "LIGHTWEIGHT" in T:
            add(LINES[("PLA", "Lightweight")], col)
        elif "ANTI" in T or "APLA" in T:
            add(LINES[("PLA", "Anti-String")], col, ("Anti-string PLA / ",))
        elif "PLA-CF" in T:
            add(LINES[("PLA-CF", "Basic")], col)
        elif "TPU-SILK" in T:
            add(LINES[("TPU", "Silk")], col)
        elif re.search(r"\bTPU\b", T):
            add(LINES[("TPU", "90A" if "90" in (mat or "") else "95A")], col)
        elif "E ABS" in T or "EASY ABS" in T:
            add(LINES[("ABS", "Easy")], col)
        elif "ABS-FR" in T:
            add(LINES[("ABS-FR", "Basic")], col, (r"ABS-FR \| ",))
        elif "ABS-GF" in T:
            add(LINES[("ABS-GF", "Basic")], col, (r"ABS-GF10 \| ",))
        elif "PC-ABS" in T:
            add(LINES[("PC-ABS", "Basic")], col, (r"PC-ABS \| ",))
        elif t.startswith("SUNLU ABS"):
            add(LINES[("ABS", "Basic")], col)
        elif t.startswith("SUNLU ASA"):
            add(LINES[("ASA", "Basic")], col)
        elif "SUNLU PC (" in T:
            add(LINES[("PC", "Basic")], col, (r"PC \| ",))
        elif "EASY NYLON" in T:
            add(LINES[("PA", "Easy")], col, (r"Easy Nylon\(PA\) \| ",))
        elif "PA6-CF" in T:
            add(LINES[("PA6-CF", "Basic")], col, (r"PA6-CF20 \| ",))
        elif "PA6-GF" in T:
            add(LINES[("PA6-GF", "Basic")], col, (r"PA6-GF25 \| ",))
        elif "PA12-CF" in T:
            add(LINES[("PA12-CF", "Basic")], col, (r"PA12-CF20 \| ",))
        elif "PP 2.0" in T:
            add(LINES[("PP", "2.0")], col, (r"PP 2\.0 \| ",))
        elif "SUNLU PP" in T:
            add(LINES[("PP", "Basic")], col, (r"PP \| ",))
        elif "PEEK" in T:
            add(LINES[("PEEK", "Basic")], col, (r"PEEK \| ",))
        elif "PVB" in T:
            add(LINES[("PVB", "Basic")], col)
        else:
            print("NICHT ZUGEORDNET:", t, file=sys.stderr)
            break

# Farben, die nur SpoolmanDB kennt (ältere oder andere Regionen), ergänzen
for l in LINES.values():
    for sm, sn in l["sdb"]:
        for f in sdb:
            if f["material"] == sm and f["name"].replace("{color_name}", "").replace(" - ", " ").strip() == sn:
                for c in f["colors"]:
                    aliases = {key(x["alias"]) for x in l["colors"].values() if x["alias"]}
                    if ("glow" in c["name"].lower()) == (l["name"] == "Glow") and key(clean(c["name"])[0]) not in aliases:
                        add(l, c["name"])

# Offizielle Farbtabellen der Produktseiten (je Seite eine Sorte; Großspulen, Bundles und Kollektionen zeigen oft fremde Tabellen
# und bleiben außen vor). PLA, PLA+, PLA+ 2.0, PETG und PETG 2.0 teilen sich bei Sunlu dieselbe Grundtabelle.
TABLES = {
    ("PLA", "Basic"): ["de:uber-3kg-bundelverkaufe-1-75mm-sunlu-pla-pla-plus-farben-3d-drucker-filament-1kg-rolle",
                       "en:over-6kg-of-pla-pla-meta-3d-filaments-1kg-2-2lbs-fit-most-of-fdm-3d-printer"],
    ("PLA+", "Basic"): ["de:ueber-6kg-buendelverkaeufe-pla-und-pla-plus-pla-matt-filament-1kg-rolle"],
    ("PLA+", "2.0"): ["de:pla-2-0-verbessertes-pla-pla-plus-3d-drucker-filament-1kg"],
    ("PETG", "Basic"): ["de:petg-1-75mm-3d-drucker-filament-1kg-2-2lbs"],
    ("PETG", "2.0"): ["de:petg-v2-3d-drucker-filament-1kg"],
    ("PLA", "Meta"): ["de:sunlu-pla-meta-1-75mm-filament-1kg-2-2lbs-passt-meist-auf-fdm-3d-drucker"],
    ("PLA", "Matte"): ["de:pla-matt-filament-glatte-matte-oberflaeche-ordentlich-gewickelt-1-75mm-3d-drucker-filament-1kg"],
    ("PLA", "High Speed"): ["de:1-75mm-sunlu-hochgeschwindigkeit-pla-3d-drucker-filament-1kg"],
    ("PLA", "High Speed Matte"): ["de:moq-6kg-high-speed-matte-pla-3d-printer-filament-1kg"],
    ("PLA+", "High Speed"): ["de:2025-neue-ankunft-moq-3-rolle-high-speed-pla-hohe-geschwindigkeit-pla-3d-drucker-filament-1kg"],
    ("PLA+", "High Speed 2.0"): ["de:moq-3-rolle-high-speed-pla-2-0-verbessertes-pla-pla-plus-3d-drucker-filament-1kg"],
    ("PLA+", "Silk"): ["de:seide-3d-drucker-filament-1kg-2-2lbs"],
    ("PLA+", "Silk 2.0"): ["de:silk-pla-v2-filament-1kg-mehr-glanz-staerkere-schichthaftung"],
    ("PETG", "High Speed Matte"): ["de:hochgeschwindigkeits-matt-petg-3d-drucker-filament-1kg"],
    ("PLA", "Wood"): ["de:optimiertes-holz-pla-3d-drucker-filament-1kg-optimiert-und-verbessert"],
    ("PLA", "Metallic"): ["de:sunlu-pla-metallic-3d-filament-1kg"],
    ("PLA", "Lightweight"): ["de:sunlu-pla-lightweight-lwpla-3d-printer-filament-800g"],
    ("PLA", "Glow"): ["en:over-3kg-bundle-sale-1-75mm-sunlu-glow-in-the-darkluminous-3d-printer-filament-1kg"],
    ("ABS", "Basic"): ["de:abs-1-75mm-3d-drucker-filament-1kg-2-2lbs"],
    ("ASA", "Basic"): ["de:sunlu-asa-filament-1-75mm"],
    ("TPU", "95A"): ["de:moq-3kg-tpu-3d-printer-filament-1kg"],
    ("TPU", "90A"): ["de:moq-3kg-tpu-3d-printer-filament-1kg"],
    ("TPU", "Silk"): ["en:1-75mm-sunlu-tpu-silk-3d-printer-filament-1kg-roll"],
}
HEX = {"de": json.load(open(f"{d}/hex-de.json")), "en": json.load(open(f"{d}/hex-en.json"))}


def table(ref):
    st, h = ref.split(":", 1)
    hits = [v for k, v in HEX[st].items() if k.startswith(h[:60])]
    if not hits or not hits[0]["rows"]:
        sys.exit(f"Farbtabelle fehlt: {ref}")
    return hits[0]["rows"]


OFF = {}  # Linie → {schlüssel: hex}
for lk, refs in TABLES.items():
    l, off = LINES[lk], OFF.setdefault(lk, {})
    for ref in refs:
        for raw, hx in table(ref):
            raw = re.sub(r"[\u200b\ufeff]", "", raw).strip()
            raw = re.sub(r"^Glow In The Dark (\w+) \(\w+ to (\w+)\)$", r"\1 (Glow \2)", raw, flags=re.I)
            n, alias = clean(raw)
            hx = hx.lstrip("#").upper()[:6]
            names = {k: c for k, c in l["colors"].items()}
            plain = {key(re.sub(r"\s*\(.*\)$", "", c["name"])): k for k, c in l["colors"].items()}
            aliases = {key(c["alias"]): k for k, c in l["colors"].items() if c["alias"]}
            kn, ka = key(n), key(alias) if alias else None
            hit = next((x for x in [kn if kn in names else None, aliases.get(kn), ka if ka in names else None, aliases.get(ka), plain.get(kn)] if x), None)
            if not hit:
                add(l, raw)
                hit = key(clean(raw)[0])
            off.setdefault(hit, hx)

# Hex: offizielle Tabelle der Linie, SpoolmanDB der Linie, dann Grundfarbe gleichen Namens (offiziell, sonst SpoolmanDB) aus PLA+ 2.0/PLA+/PETG
BASE = [("PLA+", "2.0"), ("PLA+", ""), ("PETG", "2.0"), ("PETG", ""), ("PLA", "High Speed"), ("PLA", "Matte")]
out, missing = [], []
for l in LINES.values():
    cols = []
    own = {}
    for sm, sn in l["sdb"]:
        own.update(sdb_line(sm, sn))
    for k, c in l["colors"].items():
        ks = [k] + ([key(c["alias"])] if c["alias"] else [])
        hx = OFF.get((l["material"], l["name"]), {}).get(k) or next((own[x] for x in ks if x in own), None)
        multi = "+" in c["name"] or re.search(r"rainbow|galaxy|starlit|stardust|star brown|marble|cmyk", c["name"] + l["name"], re.I)
        if not hx and not multi and not l["name"] in ("Fluorescent", "Transparent", "Glow", "Metallic", "Silk", "Silk 2.0", "Twinkling"):
            for b in BASE:
                hx = OFF.get((b[0], b[1] or "Basic"), {}).get(k) or sdb_line(*b).get(k)  # andere Linie: nur gleicher Name, nicht Zweitname
                if hx:
                    break
        if not hx and not multi and l["name"] in ("Transparent",):
            hx = next((ANY[x] for x in [key("Transparent " + c["name"])] + ks if x in ANY), None)
        if not hx:
            missing.append(f'{l["material"]} {l["name"]}: {c["name"]}')
        cols.append([c["name"], hx])
    if cols:
        m, n = l["material"], l["name"]
        label = m if n == "Basic" else f"{m} {n}"
        base = {"PLA+": "PLA", "ABS-FR": "ABS", "PC-ABS": "PC"}.get(m, m)
        out.append([base, label, cols])

print(f"{len(out)} Linien, {sum(len(c) for _, _, c in out)} Farben, {len(missing)} ohne Hex", file=sys.stderr)
for m in missing:
    print("  ?", m, file=sys.stderr)

seed = {
    "brand": "Sunlu",
    "match": "sunlu",
    "url": "https://store.sunlu.com",
    "source": "Shop store.sunlu.com (Sorten, Namen), Farbtabelle der Produktseiten de.store.sunlu.com (Hex), sonst SpoolmanDB (MIT); null = unbekannt",
    "lines": [{"material": m, "name": n, "profile_id": None, "colors": [{"name": c[0], "hex": c[1], "code": None} for c in cols]} for m, n, cols in out],
}
with open(sys.argv[2], "w") as f:
    json.dump(seed, f, ensure_ascii=False, indent=1)
    f.write("\n")
