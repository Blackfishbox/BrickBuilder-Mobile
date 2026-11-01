import { XMLParser, XMLValidator } from "fast-xml-parser";
import { MAX_LIST_BYTES, MAX_QUANTITY, MAX_ROWS, inventorySchema, type Inventory, type InventoryRow } from "./types";

function csv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, endedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; endedQuote = true; }
      else cell += c;
    } else if (c === '"' && !cell && !endedQuote) quoted = true;
    else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell); cell = ""; endedQuote = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (rows.length > MAX_ROWS + 1) throw new Error("Höchstens 5000 Zeilen erlaubt.");
      }
    } else {
      if (c === '"' || endedQuote) throw new Error("Ungültige CSV-Anführungszeichen.");
      cell += c;
    }
  }
  if (quoted) throw new Error("Nicht geschlossenes CSV-Feld.");
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  if (rows.shift()?.join(",") !== "part_id,color_id,quantity") throw new Error("CSV-Kopf muss part_id,color_id,quantity sein.");
  return rows.map((cells, i) => {
    if (cells.length !== 3) throw new Error(`CSV-Zeile ${i + 2}: genau drei Felder erforderlich.`);
    return { ITEMID: cells[0], COLOR: cells[1], QTY: cells[2], ITEMTYPE: "P" };
  });
}

/** Strict bounded BrickLink XML or our documented CSV, never format guessing. */
export function parseInventory(text: string, name: string): Inventory {
  if (new TextEncoder().encode(text).length > MAX_LIST_BYTES) throw new Error("Teileliste ist größer als 2 MiB.");
  text = text.replace(/^\uFEFF/, "");
  let records: Record<string, string>[];
  if (/\.xml$/i.test(name)) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("DOCTYPE und externe Entitäten sind nicht erlaubt.");
    if (XMLValidator.validate(text) !== true) throw new Error("Ungültiges XML.");
    const parsed = new XMLParser({ parseTagValue: false, trimValues: true, ignoreAttributes: false }).parse(text);
    if (!parsed.INVENTORY || Object.keys(parsed).some(k => k !== "INVENTORY" && k !== "?xml")) throw new Error("BrickLink-XML benötigt INVENTORY als Wurzel.");
    const items = parsed.INVENTORY.ITEM;
    records = items ? (Array.isArray(items) ? items : [items]) : [];
    if (Object.keys(parsed.INVENTORY).some(k => k !== "ITEM")) throw new Error("Nicht unterstützter XML-Inhalt in INVENTORY.");
  } else if (/\.csv$/i.test(name)) records = csv(text);
  else throw new Error("Nur BrickLink-XML und die dokumentierte CSV-Vorlage werden unterstützt.");
  if (!records.length || records.length > MAX_ROWS) throw new Error("Die Liste muss 1 bis 5000 Zeilen enthalten.");
  const combined = new Map<string, InventoryRow>();
  records.forEach((record, index) => {
    if (!record || typeof record !== "object" || Object.values(record).some(v => typeof v !== "string")) throw new Error(`Zeile ${index + 1}: verschachtelte oder doppelte XML-Felder sind nicht erlaubt.`);
    const partId = record.ITEMID?.trim(), colorId = record.COLOR?.trim();
    const itemType = record.ITEMTYPE?.trim();
    const amount = record.QTY ?? record.MINQTY;
    if (record.QTY !== undefined && record.MINQTY !== undefined && record.QTY !== record.MINQTY) throw new Error(`Zeile ${index + 1}: widersprüchliche Mengen.`);
    if (!amount || !/^[1-9]\d*$/.test(amount) || Number(amount) > MAX_QUANTITY) throw new Error(`Zeile ${index + 1}: Menge muss eine ganze Zahl von 1 bis 100000 sein.`);
    const key = JSON.stringify([itemType, partId, colorId]);
    const existing = combined.get(key);
    if (existing) {
      existing.quantity += Number(amount);
      if (existing.quantity > MAX_QUANTITY) throw new Error(`Zeile ${index + 1}: zusammengefasste Menge über 100000.`);
      existing.sourceRows.push(index + 1); existing.metadata.push(record);
    } else combined.set(key, { id: `row-${index + 1}`, partId, colorId, itemType, quantity: Number(amount), sourceRows: [index + 1], metadata: [record] } as InventoryRow);
  });
  const result = inventorySchema.safeParse({ version: 1, id: crypto.randomUUID(), name, importedAt: new Date().toISOString(), rows: [...combined.values()] });
  if (!result.success) throw new Error("Ungültige Teilenummer, BrickLink-Farbe oder Artikelart. Erforderlich: ITEMID, COLOR, ITEMTYPE und QTY bzw. MINQTY.");
  return result.data;
}
