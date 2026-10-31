# LDraw-Pakete: Quellen- und Lizenzprüfung

Prüfstand: 31.10.2026. Dies ist eine dokumentierte technische Lizenzprüfung
anhand der Originalquellen, keine anwaltliche Rechtsberatung oder Garantie.
Es werden ausschließlich offizielle LDraw-Dateien mit explizitem
`CC BY 4.0`-Header verwendet. Keine Studio-/BrickLink-Ressourcen, keine
inoffiziellen Teile, keine Dateien mit unklaren oder gemischten Lizenzangaben.

## Pakete

| Paket | Snapshot | LDraw-Teilenummern | Lizenz |
| --- | --- | --- | --- |
| `ldraw-bricks` (Steine) | 2026-10-31 | 3001, 3002, 3003, 3004, 3005, 3006 | CC BY 4.0 |
| `ldraw-plates` (Platten) | 2026-10-31 | 3020, 3021, 3022, 3023, 3024, 3710 | CC BY 4.0 |

Quelle für jedes Paket: <https://library.ldraw.org/library/official/>.
Die Pakete enthalten die vollständige rekursive Abhängigkeitshülle der
ausgewählten Teile (Unterteile und Primitive). Gemeinsame Primitive sind
absichtlich je Paket enthalten, damit kein anderes Paket vorausgesetzt wird.

Autoren Steine: James Jessiman; Niels Karsdorp [nielsk]; Steffen [Steffen];
Owen Burgoyne [C3POwen]; Tore Eriksson [Tore_Eriksson]; Willy Tschager [Holly-Wood].

Autoren Platten: James Jessiman; Orion Pobursky [OrionP]; Massimo Maso [Sirio];
Tore Eriksson [Tore_Eriksson]; Steffen [Steffen].

Jede Datei trägt zusätzlich ihre konkrete Quell-URL, Autor, Lizenzkennung und
den unveränderten Originalinhalt inklusive `!HISTORY`-Credits. Alle
Originaldateien bleiben unverändert; lediglich Auswahl, JSON-Paketierung und
Suchmetadaten stammen von BrickBuilder. Keine Unterstützung/Empfehlung durch
LDraw.org, LEGO oder BrickLink wird behauptet. Markenrechte sind nicht Teil
der CC-Lizenz.

## Maßgebliche Quellen und Pflichten

- [Contributor Agreement](https://library.ldraw.org/documentation/licenses-and-legal/ldraworg-contributor-agreement):
  aktuelle Einreichungen stehen unter CC BY 4.0 oder optional CC0.
  Entscheidend ist trotzdem der individuelle Dateiheader, nicht allein diese Regel.
- [CAreadme.txt](https://library.ldraw.org/library/official/CAreadme.txt):
  verlangt Urheber, Werk-URL, Lizenzname, Lizenz-URL und Änderungskennzeichnung.
- [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):
  erlaubt Vervielfältigung und Weitergabe einschließlich kommerzieller Nutzung
  bei Einhaltung der Namensnennungsbedingungen, ohne zusätzliche Einschränkungen.
- [Vollständiger Lizenztext](https://library.ldraw.org/library/official/CAlicense4.txt).

`CAreadme.txt` und `CAlicense4.txt` werden in jedes Paket eingebettet und
zusammen mit den Dateien in IndexedDB gespeichert, sodass sie nach der
Installation auch offline lesbar sind. Die Oberfläche zeigt pro Paket
Autoren, Quellen-/Lizenzlinks und Änderungskennzeichnung.

## Aktualisierungsverfahren

`node artifacts/brickbuilder-mobile/scripts/build-parts-packages.mjs`
lädt ausschließlich offizielle Quellen und bricht bei unbekannten
Lizenzheadern oder fehlenden Abhängigkeiten ab. Das Skript läuft **nicht**
automatisch im App-Build. Vor einem neuen Snapshot Versionsdatum anpassen,
Lizenzangaben und Credits prüfen und Änderungen der generierten Pakete samt
`src/features/parts/catalog.json` gemeinsam übernehmen. Derzeit tragen alle
Dateien CC BY 4.0. Der Validator kennt auch CC0 für zukünftige, separat zu
prüfende Erweiterungen; dann müssen passende Rechtstexte ergänzt werden.

SHA-256 und Bytezahl im gebündelten Katalog fixieren den geprüften Snapshot.
Der Client akzeptiert nur genau diese Bytes, validiert Metadaten, Lizenzheader
und vollständige Abhängigkeiten und schreibt anschließend atomar in IndexedDB.
Netzwerk-, Prüfsummen- oder Quotenfehler lassen eine vorhandene Installation
unverändert. Ein fehlgeschlagenes Paket wird nicht als installiert markiert.
