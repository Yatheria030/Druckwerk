// Rohdaten für scripts/esun-colors.py. Beide eSUN-Seiten stehen hinter Cloudflare, deshalb im Browser ausführen
// (Entwicklerkonsole, Seite muss offen sein); am Ende lädt der Browser die JSON-Datei herunter.
//   https://www.esun3d.com  → official.json: je Sorte die Farbtabelle (Name, Hex) und die Farbnamen der Vorschau
//                             (Mehrfarbige haben je Teilfarbe eine Zeile, die Vorschau nennt die ganze Farbe)
//   https://esun3dstore.com → shop.json: je Produkt die Farbauswahl des Shops (Namen ohne Hex)
(async () => {
  const parse = async (u) => new DOMParser().parseFromString(await (await fetch(u)).text(), "text/html");
  const links = (d, sel) => [...d.querySelectorAll(sel)].map((a) => a.getAttribute("href").replace(/^https?:\/\/[^/]+/, "").split("?")[0]);
  const out = {};
  let name;
  if (/(^|\.)esun3d\.com$/.test(location.host)) {
    name = "official.json";
    const all = new Set();
    for (let p = 1; p < 10; p++) {
      const n = all.size;
      links(await parse(`/filaments?p=${p}&product_list_limit=36`), "a.product-item-link").forEach((u) => all.add(u));
      if (all.size === n) break;
    }
    for (const u of all) {
      if (/refil|set-product|kg|250g/.test(u)) continue; // Nachfüllrollen, Sets und Großspulen wiederholen die Farben
      const d = await parse(u);
      const rows = [...d.querySelectorAll(".esun-available-colors-list__row")].map((r) =>
        [".esun-available-colors-list__name", ".esun-available-colors-list__hex"].map((s) => r.querySelector(s)?.textContent.trim().replace(/^#/, "")),
      );
      const names = [...d.querySelectorAll(".esun-available-colors__tooltip")].map((e) => e.textContent.trim());
      out[u.replace(/^\/|-product$/g, "")] = { title: d.querySelector("h1")?.textContent.trim().replace(/\s+/g, " "), rows, names };
    }
  } else {
    name = "shop.json";
    const all = new Set();
    for (let p = 1; p < 10; p++) {
      const n = all.size;
      links(await parse(`/collections/3d-filament?page=${p}`), '[class*=prod] a[href*="/products/"]').forEach((u) => all.add(u));
      if (all.size === n) break;
    }
    for (const u of all) {
      if (/rolls|-\d+kg|kg\d|kg-spool|espool|swatch|ebox|evacuum|anniversary|^\/products\/$/.test(u)) continue;
      const d = await parse(u);
      const li = d.querySelector('li.attr_show[name^="Color"]');
      const colors = li ? [...new Set([...li.querySelectorAll("[value]")].map((e) => e.getAttribute("data-title") || e.getAttribute("value")))].filter(Boolean) : [];
      if (colors.length) out[u.replace("/products/", "")] = { title: d.querySelector("h1")?.textContent.trim().replace(/^eSUN |\s+1\.7.*$/g, ""), colors };
    }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)])), download: name });
  a.click();
  console.log(name, Object.keys(out).length, "Seiten");
})();
