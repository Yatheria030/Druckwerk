#!/usr/bin/env python3
# Liest die offizielle Farbtabelle (Abschnitt „color-hex-table“: Color / Hex Code) jeder Sunlu-Produktseite.
# Aufruf: python3 scripts/sunlu-hex-tables.py <shop.json>... <basis-url> <out.json>
#   z. B. shop-store.sunlu.com.json shop-p2.json shop-p3.json https://store.sunlu.com hex-en.json
#         shop-de.json (https://de.store.sunlu.com/products.json?limit=250) https://de.store.sunlu.com hex-de.json
import html, json, re, sys, time, urllib.request

*shops, base, out = sys.argv[1:]
ps = [p for f in shops for p in json.load(open(f))["products"]]
res = {}
for p in ps:
    url = f"{base}/products/{p['handle']}"
    try:
        h = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read().decode("utf-8", "ignore")
    except Exception as e:
        print("FEHLER", url, e, file=sys.stderr)
        continue
    rows = []
    for sec in re.findall(r'<section class="color-hex-table".*?</section>', h, re.S):
        for name, hx in re.findall(r"<tr>\s*<td>(.*?)</td>\s*<td>\s*(#?[0-9a-fA-F]{3,8})\s*</td>", sec, re.S):
            rows.append([html.unescape(re.sub(r"<.*?>", "", name)).strip(), hx.strip()])
    res[p["handle"]] = {"title": p["title"], "rows": rows}
    time.sleep(0.7)
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(sum(1 for v in res.values() if v["rows"]), "Seiten mit Farbtabelle", file=sys.stderr)
