# IO-Referenzanalyse

## Quelle und Grenzen

Die vom Nutzer bereitgestellte Datei liegt unter
`attached_assets/ford_mxCopy_Copy-1_1793477649199.io`.
SHA-256: `ef2c06d4ced5bb56b3ff3bc91fb18274dfc0e84133055bc4d93fd048585f0c14`.

Diese Analyse prüft die Archivstruktur und Modelldaten, nicht die fertige
Importfunktion oder die visuelle Übereinstimmung in BrickBuilder.
Sie belegt keine allgemeine IO-Kompatibilität.

## Container

Unverschlüsseltes ZIP-Archiv mit acht Einträgen und insgesamt 1.422.568
unkomprimierten Bytes:

- `model.ldr`
- `model.lxfml`
- `modelv2.ldr`
- `model2.ldr`
- `model.ins`
- `thumbnail.png`
- `errorPartList.err`
- `.info`

`.info` nennt Studio-Version `2.26.3_1`, Teilezahl 429 und
Teiledatenbank-Version 212.

## Modellreferenz

`model.ldr` enthält neun FILE-Abschnitte: ein Hauptmodell und acht Untermodelle.
Die Datei hat 402 rohe Typ-1-Referenzzeilen. Rekursives Auflösen der vom
Hauptmodell referenzierten Untermodelle ergibt:

- 429 Teileinstanzen
- 74 unterschiedliche externe Teilreferenzen
- acht effektive Farbcodes nach Vererbung von Farbe 16

Die ermittelte Instanzenzahl entspricht der Studio-Teilezahl aus `.info`.
Die 74 Teilreferenzen sind keine bestätigten BrickLink-IDs.

| Quellfarbcode in model.ldr | Instanzen |
| --- | ---: |
| 0 | 305 |
| 72 | 68 |
| 19 | 4 |
| 4 | 12 |
| 1 | 2 |
| 15 | 21 |
| 179 | 4 |
| 47 | 13 |

Diese Nummern nicht unverändert als BrickLink-Farbkennungen interpretieren.
Die Zuordnung braucht eine nachvollziehbare, getrennte Farbtabelle.

## Anforderungen an den Import

1. Untermodellreferenzen mit Namen einschließlich Leerzeichen auflösen,
   Zyklenerkennung und Begrenzungen für Tiefe und Instanzen vorsehen.
2. Vollständige affine Transformationsmatrizen erhalten. Neun rohe
   Referenzzeilen enthalten Matrixwerte außerhalb einfacher Achsenrotationen;
   das bisherige Modell aus Position und Y-Vierteldrehung reicht nicht aus.
3. Die Quelleinheiten getrennt von den internen Baueinheiten umrechnen.
4. Unaufgelöste Teile und Farben sichtbar melden und ihre Quelldaten erhalten.
   Keine stillen Ersatzsteine und kein Verwerfen unbekannter Teile.
5. Den bisherigen lokalen Projektbestand und Autosave vor Importfehlern
   schützen. Erst nach erfolgreicher Validierung ein neues Projekt anlegen.
6. ZIP-Einträge vor dem Lesen auf Größen, Pfade und unterstützte Kodierung
   prüfen. Keine Extraktion über das Projektdateisystem.

## Zusätzliche Einträge

`modelv2.ldr` enthält unter anderem Studio-spezifische Typ-11-Zeilen und ist
nicht wie normales LDraw mit Typ-1-Referenzen auszuwerten.

`model2.ldr` enthält 270 FILE-Abschnitte, darunter eingebettete
Teil-/Primitivdefinitionen, und andere Farbnummern als `model.ldr`.
Diese eingebetteten Ressourcen nicht in die allgemeine Teilebibliothek
übernehmen oder als neue, frei verteilbare LDraw-Ressourcen behandeln.
Für die Teilebibliothek ausschließlich gesondert lizenzierte Quellen verwenden.

`model.lxfml` enthält 422 Part-Elemente und ist daher ohne weitere
Formatkenntnis kein Ersatz für die rekursive Teilezählung aus `model.ldr`.
`model.ins` ist XML mit Instruction-Wurzel; `.info` ist JSON.
Zusatzdaten möglichst unverändert als Quelldaten erhalten, aber nicht als
bereits unterstützte Bearbeitungsfunktionen ausgeben.

## Nachweis im implementierten Adapter

Der automatisierte Referenztest liest die private Upload-Datei direkt; sie wird
nicht als öffentliche Fixture oder in den App-Build kopiert.

- 429 erhaltene Instanzen, 74 externe Referenzen, neun FILE-Abschnitte.
- Die oben aufgeführten acht effektiven Farbcodes und Häufigkeiten stimmen.
- Alle 429 Instanzen verwenden auflösbare Original-LDraw-Geometrien.
  Ein separater, hashgebundener Snapshot enthält 74 Hauptteile und insgesamt
  321 geprüfte Originaldateien (98.923 Bytes gzip).
- Die Geometrien stammen aus der offiziellen LDraw-Bibliothek, nicht aus
  `model2.ldr`. Unterteil- und Primitivreferenzen werden rekursiv aufgelöst.
- Vollständige 3×4-Matrizen inklusive Spiegelung, Skalierung und Scherung bleiben
  erhalten. Einheiten: 20 LDU = eine Noppe; Y wird für die Anzeige invertiert.
- JSON-Sicherung und lokales Wiederöffnen erhalten Originalarchiv, Untermodelle,
  Matrizen, Ressourcen, Lizenztexte und Hinweise ohne weiteren Download.
- Die acht LDraw-Farben haben ausdrücklich getrennte BrickLink-Farbzuordnungen;
  nicht bestätigte BrickLink- und Studio-Teilenummern bleiben leer.
- Beschädigte Archive, unsichere Pfade, Zyklen, ungültige Matrizen und simulierte
  Speicherfehler sind geprüft. Fehlgeschlagene Transaktionen ändern weder
  bestehende Projekte noch den aktiven Projektverweis.
- LDR-Export erhält die aufgelösten Matrizen/Farben, MPD die unveränderte
  Untermodellquelle, solange keine Baukastensteine ergänzt wurden. Minimaler
  IO-Export wird im eigenen Importer wieder eingelesen; dies ist **kein Nachweis
  des Öffnens in BrickLink Studio**.

## Visuelle und fachliche Grenzen

Im mobilen Browserablauf (402×874) wurde das zusammengesetzte Auto sichtbar
gerendert. Die Vorschau meldete 429/74/8 und ausschließlich die erwarteten
Hinweise zu unbestätigten BrickLink-Teilenummern und zur IO-Unterstützungsgrenze.
Nach Neuladen und erneutem Öffnen bei blockierter Geometrie-Downloadroute
blieb die Geometrie ohne erneuten Request verfügbar. Ein vorheriges Projekt
mit einem Stein blieb unverändert erhalten; beschädigter IO-Upload zeigte
einen Fehler, ohne es zu ersetzen.

Kein visueller Pixel-/Geometrievergleich gegen eine Studio-Referenzansicht:
eine solche Ansicht wurde nicht mitgeliefert. Keine Behauptung allgemeiner
IO-Kompatibilität oder physisch korrekter LEGO-Verbindungen.

Die Darstellung unterstützt LDraw-Typen 1–4 (Typ 1 rekursiv, Quads trianguliert).
Typ-5-Kanten sind nicht implementiert. BFC-Culling wird nicht rekonstruiert;
Flächen sind doppelseitig, Normale flach pro Dreieck. TEXMAP und Studio-Texturen,
Materialeffekte wie Metallic/Perlglanz, Anleitungen und proprietäre Zusatzdaten
sind keine unterstützten Bearbeitungsfunktionen. Transparenz wird angenähert.
Diese Einschränkungen ändern die erhaltenen Quelldaten nicht.

Importierte Instanzen sind als Modellansicht bewusst schreibgeschützt; die
bisherigen Baukastensteine können daneben weiterhin bearbeitet werden.
Eine rein visuelle Höhenkorrektur verhindert, dass das Modell unter der
Grundplatte verschwindet; Quellmatrizen werden dadurch nicht verändert.

Weiter offen bleiben:

- Bestätigung der sichtbaren Übereinstimmung mit Studio.
- Physischer Android-Abnahmetest einschließlich Flugmodus und Speicherverdrängung.
