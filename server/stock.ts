// Mindestbestände (Tabelle stock_rules); Bestand und Einkaufsliste rechnet shared/stock.ts aus den Spulen
import type { StockRule, StockRuleInput } from "../shared/stock.ts";
import { db, nowIso } from "./db.ts";

export const listRules = () => db.prepare("SELECT * FROM stock_rules ORDER BY brand COLLATE NOCASE, line COLLATE NOCASE, color_name COLLATE NOCASE").all() as StockRule[];
export const getRule = (id: number) => db.prepare("SELECT * FROM stock_rules WHERE id = ?").get(id) as StockRule | undefined;

export function addRule(r: StockRuleInput): number {
  return Number(
    db.prepare("INSERT INTO stock_rules (brand, line, material, color, color_name, min_g, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(r.brand, r.line, r.material, r.color, r.color_name, r.min_g, r.url, nowIso()).lastInsertRowid,
  );
}

export function updateRule(id: number, r: Partial<StockRuleInput>) {
  const keys = (["brand", "line", "material", "color", "color_name", "min_g", "url"] as const).filter((k) => r[k] !== undefined);
  if (!keys.length) return;
  db.prepare(`UPDATE stock_rules SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => r[k]!), id);
}

export const deleteRule = (id: number) => db.prepare("DELETE FROM stock_rules WHERE id = ?").run(id).changes > 0;
