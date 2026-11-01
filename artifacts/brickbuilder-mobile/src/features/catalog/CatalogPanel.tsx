import { useEffect, useState } from "react";
import { catalogManifest, ensureCatalog, searchFullCatalog, useCatalog, type CatalogSearchResult } from "./client";

export default function CatalogPanel() {
  const catalog = useCatalog();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"parts" | "colors">("parts");
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || catalog.status !== "ready") return;
    let active = true;
    const timer = setTimeout(() => {
      setError("");
      void searchFullCatalog(query, kind).then(rows => { if (active) setResults(rows); })
        .catch(reason => { if (active) setError(String(reason)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, kind, open, catalog.status]);
  const c = catalog.index?.coverage;
  return (
    <details className="fmt-details" onToggle={event => setOpen(event.currentTarget.open)} data-testid="catalog-panel">
      <summary style={{ minHeight: 44 }}>Vollständiger Zuordnungskatalog · {catalog.status === "ready" ? "offline verfügbar" : catalog.status === "loading" ? "wird geprüft …" : "nicht geladen"}</summary>
      <p>Rebrickable · Stand {catalogManifest.version} · {Math.round(catalogManifest.bytes / 1024)} KB komprimiert</p>
      <p>Gesamter veröffentlichter Quellenbestand, keine zugesicherte Entsprechung jedes existierenden LEGO-Teils. Katalogdaten sind keine Geometriebibliothek.</p>
      {catalog.status === "error" && <p role="alert">{catalog.error} Die bisherigen geprüften Zuordnungen bleiben nutzbar.</p>}
      {catalog.status !== "ready" && <button type="button" className="plib-btn" disabled={catalog.status === "loading"} onClick={() => void ensureCatalog().catch(() => undefined)}>Katalog laden / erneut prüfen</button>}
      {c && <>
        <p>{c.parts.toLocaleString("de-DE")} Rebrickable-Teile · {c.colors} Farben<br />
          {c.partRows.toLocaleString("de-DE")} Teile- und {c.colorRows} Farbzuordnungszeilen, alle externen Systeme erhalten.</p>
        <p>LDraw-Importreferenzen → BrickLink-Export: {c.ldrawParts.toLocaleString("de-DE")} Teile-IDs:
          {" "}{c.confirmedParts.toLocaleString("de-DE")} eindeutig · {c.ambiguousParts} mehrdeutig · {c.unknownParts} ohne Ziel-ID.<br />
          {c.ldrawColors} Farb-IDs: {c.confirmedColors} eindeutig · {c.ambiguousColors} mehrdeutig · {c.unknownColors} ohne Ziel-ID.</p>
        <p>Die übrigen Rebrickable-Einträge besitzen keine verwendbare LDraw-Importzuordnung in dieser Quelle. Zusätzliche LDraw-Nachweise können weitere Zuordnungen oder Konflikte ergeben. Ähnliche Nummern werden niemals gleichgesetzt.</p>
        <label style={{ display: "block" }}>Gesamten Katalog durchsuchen <input style={{ minHeight: 44, width: "100%" }} value={query} onChange={event => setQuery(event.target.value)} placeholder="Name oder ID, z. B. 3001" data-testid="catalog-search" /></label>
        <select style={{ minHeight: 44 }} value={kind} onChange={event => setKind(event.target.value as typeof kind)} aria-label="Katalogart"><option value="parts">Alle Teile</option><option value="colors">Alle Farben</option></select>
        {error && <p role="alert">{error}</p>}
        <ul>{results.map(row => <li key={row.id} style={{ overflowWrap: "anywhere" }}>
          <strong>Rebrickable {row.id} · {row.name}</strong>
          <small>{row.mappings.length ? row.mappings.map(mapping =>
            `${mapping[1]} ${mapping[2]} (Export ${mapping.at(-2) === "True" ? "ja" : "nein"}, Import ${mapping.at(-1) === "True" ? "ja" : "nein"})`).join(" · ") : "Keine externen Zuordnungen in der Quelle"}</small>
        </li>)}</ul>
        <p>Maximal 60 Treffer; Suche präzisieren. LD = LDraw, BL = BrickLink, BO = BrickOwl, LE = LEGO. IDs aus Rebrickable werden nicht als LDraw-/BrickLink-IDs ausgegeben.</p>
      </>}
      <p><a href="https://rebrickable.com/downloads/" target="_blank" rel="noreferrer">Quelldateien</a> · <a href={catalogManifest.termsUrl} target="_blank" rel="noreferrer">Nutzungsbedingungen</a></p>
      <details><summary>Prüfsummen und Herkunft</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 10 }}>{JSON.stringify(catalogManifest, null, 2)}</pre></details>
      <p>{catalogManifest.attribution}</p>
    </details>
  );
}
