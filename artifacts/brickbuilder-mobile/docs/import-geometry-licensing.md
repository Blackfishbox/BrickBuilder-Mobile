# Geometriesnapshot für den Modellimport

Der zusätzliche Snapshot `public/parts/import-geometry-2026-10-31.bin`
enthält ausschließlich 74 offizielle LDraw-Hauptteile und deren rekursive
Abhängigkeiten, insgesamt 321 Dateien. Er ist unabhängig von den bereits
installierbaren Katalogpaketen und verändert deren Schnittstellen nicht.
Keine eingebetteten Studio-Dateien werden daraus übernommen.

Quelle: <https://library.ldraw.org/library/updates/complete.zip>
(offizieller Bestand, abgerufen 2026-10-31). Originaldatei-URLs, Autoren und
Lizenzangaben sind pro Datei im Snapshot enthalten, zusammen mit
`CAreadme.txt` und `CAlicense4.txt`.

Jede Datei wurde auf einen expliziten CC-BY-4.0-, dualen
CC-BY-2.0-und-CC-BY-4.0- oder CC0-Header und LDraw-Org-Header geprüft.
Bei dualen Headern wird die angebotene CC-BY-4.0-Lizenz verwendet.
Sämtliche Originalheader, Credits und History bleiben unverändert erhalten.
Änderungen durch BrickBuilder: Auswahl, gzip-Paketierung und Suchmetadaten,
keine Änderung der Original-LDraw-Dateiinhalte.

SHA-256 des komprimierten Snapshots:
`3611c261dc046428a019a0625bea3d7156d73de2244d9fe92413908e06dbaf6f`.
Größe: 98.923 Bytes. Die Anwendung prüft Hash und Bytezahl beim Download.
Die Endung `.bin` ist beabsichtigt: gzip ist das interne Paketformat, nicht
HTTP-Content-Encoding. Automatische HTTP-Dekompression würde die Prüfsumme
der über `fetch` gelesenen Bytes verändern.
Der Snapshot wird bewusst erzeugt, nie automatisch beim App-Build aktualisiert.
Das explizite Wartungsskript unterstützt ein lokal heruntergeladenes offizielles
Archiv über `LDRAW_ARCHIVE`, um viele einzelne Requests zu vermeiden.

Geometrien, Autoren und Rechtstexte bleiben nach Import lokal im Projekt.
JSON-Sicherungen erhalten sie ebenfalls. LDR/MPD/minimaler IO-Export referenzieren
die Bibliotheksdateien und enthalten keine eingebetteten Geometriekopien.
Die Nutzerdatei selbst wird ausschließlich als private Referenz gelesen und
nicht in den öffentlichen Snapshot oder Build aufgenommen.

Farbnamen und RGB-Werte sind ein expliziter Ausschnitt aus LDConfig.ldr.
Die getrennten BrickLink-Farbnummern sind im Farbresolver mit Herkunftslink
und Prüfstand dokumentiert. Es gibt keine implizite Nummerngleichsetzung.

Dies dokumentiert eine technische Herkunfts-/Lizenzprüfung, keine Rechtsberatung.
