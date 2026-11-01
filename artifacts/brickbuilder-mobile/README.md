# BrickBuilder Mobile

Eigenständige, lokale Bau-App als installierbare PWA. Die erste Version
konzentriert sich auf die mobile Konstruktion mit drei parametrisierbaren
Steinformen; sie ist kein Klon von BrickLink Studio und verwendet keine
proprietären Studio-Ressourcen.

## Phase 1: verfügbar

- Responsive Oberfläche für Hoch- und Querformat mit Touch-Werkzeugleiste,
  Steinauswahl, lokaler Suche und Farbauswahl.
- Interaktive Three.js-Szene mit Grundfläche, Raster, Snapping auf halbe
  Baueinheiten und prozeduralen 2×4-, 2×2- und 1×2-Steinen.
- Platzieren, Auswählen, Ziehen, Drehen, Löschen sowie Undo/Redo.
- Ein-Finger-Kameradrehung; Zwei-Finger-Gesten für Zoom, Drehung und Verschieben.
- InstancedMesh-Gruppierung nach Typ und Farbe im WebGL2-Modus.
- 2D-Canvas-Projektionsfallback, falls der Browser keinen WebGL2-Kontext bereitstellt.
- Lokale Projekte in IndexedDB, automatische Speicherung, Wiederherstellung und
  Projektwechsel.
- Manifest und generierter Service Worker; die gebündelte App wird für die
  Nutzung nach dem ersten Laden vorgemerkt. Ein Modellanalyse-Worker hält
  Kennzahlen und Überlappungsanalyse aus dem UI-Thread heraus.
- Keine Konten, Server, externen Schriftarten oder kostenpflichtigen Dienste.

## Prüfung

Im Workspace erfolgreich ausgeführt:

```sh
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
PORT=23048 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run build
```

Die Tests decken Raster/Snapping, Drehungen, Undo/Redo und IndexedDB-Grundlagen
ab. Der Produktionsbuild erzeugt `manifest.webmanifest` und `sw.js`; die
Three.js-Engine wird separat und verzögert geladen. Der eigentliche
Three.js-Chunk ist rund 536 kB unkomprimiert (132 kB gzip), was bei späteren
Leistungstests auf Android berücksichtigt werden sollte.

Die Vorschau wurde bei 402×874 und 844×402 Pixeln geprüft. Die
Vorschau-Umgebung stellt keinen WebGL2-Kontext bereit und zeigt daher den
Canvas-Fallback. Ein echtes Android-Smartphone und der WebGL2-Pfad wurden hier
nicht physisch geprüft. Ebenso steht ein tatsächlicher Flugmodus-Test im
installierten Browser noch aus; die Offline-Erzeugung und der Cache-Inhalt des
Produktionsbuilds wurden geprüft, nicht ein vollständiger Offline-Browserlauf.

## Modellimport und Dateiformate

Unter **Projektmenü → Datei importieren / exportieren** lässt sich eine lokale
IO-, LDR-, MPD- oder JSON-Datei auswählen. Nach der Prüfung zeigt eine Vorschau
Instanzenzahl, Teile, Farben und Hinweise. Erst **Neues Projekt aus Import
anlegen** speichert und öffnet ein neues Projekt; das vorherige Modell bleibt
erhalten. Ein Fehler beim Lesen oder Speichern ersetzt kein bestehendes Projekt.
Ein Hinweis über dem Modell öffnet den dauerhaft gespeicherten Importbericht.

Mit der bereitgestellten privaten Studio-Datei nachgewiesen: **429 Instanzen,
74 verschiedene externe Teile und acht effektive Farben**, Untermodelle und
vollständige affine Transformationen. Alle 74 Original-LDraw-Teilegeometrien
einschließlich ihrer rekursiven Abhängigkeiten sind renderbar. Diese Dateianalyse
und die Tests sind kein Versprechen allgemeiner Studio-Kompatibilität.

LDraw- und BrickLink-Farbnummern sowie Namen werden getrennt angezeigt.
Studio-IDs und nicht bestätigte BrickLink-Teilenummern werden nicht geraten.
Fehlende Geometrien werden mit Referenz und Anzahl im Bericht ausgewiesen,
unbekannte Farben mit Warnfarbe Magenta. Keine stillen Ersatzsteine.

Originalupload, Untermodellquelle, Zusatzdaten im IO-Archiv, verwendete
LDraw-Dateien, Credits und Lizenztexte werden im lokalen Projekt erhalten.
Nach erfolgreichem Import benötigt das Wiederöffnen keine Netzwerkverbindung.
Der zusätzliche Geometriesnapshot wird bei Bedarf beim Import geladen, nicht
beim App-Start. Das bestehende Paket-/Katalogsystem wird nicht verändert.
Importierte Instanzen sind schreibgeschützt; Baukastensteine bleiben bearbeitbar.

Der mobile Browserablauf wurde mit der echten Referenz geprüft: sichtbares
zusammengesetztes Auto, Speicherung, Neuladen, erneutes Öffnen ohne
Geometriedownload sowie unverändertes vorheriges Projekt bei Importfehlern.
Ein physischer Android-/Flugmodus-Test und ein Vergleich gegen Studio fehlen
weiterhin.

Getrennte Adapter:

| Format | Import | Export / tatsächlicher Teststand |
| --- | --- | --- |
| Internes JSON v1 | Strukturvalidierung; bestehende v1-Projekte bleiben gültig | Vollständige lokale Sicherung einschließlich Importdaten; Roundtrip getestet |
| LDR | Typ-1-Referenzen, volle Matrizen; fehlende Ressourcen als Hinweise | Aufgelöstes flaches Modell; Matrizen/Farben der echten Referenz im Roundtrip getestet |
| MPD | FILE-Untermodelle, Namen mit Leerzeichen, Farbvererbung | Unveränderte Quelle bei reinem Importmodell; sonst flacher main.ldr-Abschnitt |
| IO | Unverschlüsseltes ZIP32 und ältere Studio-ZIP32-Verschlüsselung mit dokumentiertem Standardschlüssel; gezieltes Lesen von model.ldr | Minimaler neuer ZIP-Container mit model.ldr und .info; nur im eigenen Importer getestet, keine Studio-Exportkompatibilität behauptet |

Containergrenzen: maximal 32 MiB Upload/angegebene entpackte Summe, 16 MiB je tatsächlich gelesenem ZIP-Eintrag,
128 Archiveinträge, 1.024 Untermodelle, 48 Hierarchieebenen, 10.000 Instanzen.
Mehrteilige, AES-/anders verschlüsselte und ZIP64-Archive werden abgelehnt.
ZIP-Struktur und Pfadgrenzen werden für alle Einträge geprüft; Größen und CRC
der tatsächlich gelesenen Inhalte nach dem Entpacken. Zusätzliche IO-Ressourcen
werden nicht entpackt, sondern im Originalarchiv erhalten. Keine Dateisystemextraktion.
Geometriedetails, Grenzen und Quellenprüfung:
[`docs/io-reference-analysis.md`](docs/io-reference-analysis.md) und
[`docs/import-geometry-licensing.md`](docs/import-geometry-licensing.md).
Die zweite, verschlüsselte IO-Referenz und ihre verbleibenden Grenzen:
[`docs/legacy-io-reference.md`](docs/legacy-io-reference.md).

## Noch nicht enthalten

- Beliebige LDraw-Teile aktiv platzieren oder importierte Instanzen bearbeiten.
- Vollständiger BrickLink-Teilenummernkatalog, Preise oder Verfügbarkeitsdaten.
- Allgemeine Studio-Kompatibilität, Texturen, Anleitungen, BFC-/Typ-5-Kanten,
  physikalisch korrekte Metallic-/Transparenzdarstellung.
- Mehrfachauswahl, Langzeitmessungen mit tausenden Steinen oder Cloud-Sync.
- Physischer Android-Abnahmetest.

Das interne JSON-Modell ist versioniert (`schemaVersion: 1`) und besitzt ein
Metadatenfeld für zukünftige Importer. LDraw- und BrickLink-Nummern sind nicht
mit den internen Stein-IDs gleichzusetzen. Die getrennte Formatarchitektur,
Lizenzgrenzen und spätere Prüfschritte sind in
[`docs/architecture.md`](docs/architecture.md) festgehalten.

## Lokale Teilebibliothek

Im Steine-Dialog unter **LDraw-Bibliothek** sind die Pakete **Steine** und
**Platten** einzeln ladbar (je sechs Teile samt Unterteilen und Primitiven).
Nach dem Download bleiben Originaldateien, Suchdaten, Urheber und Lizenztexte
in IndexedDB gespeichert. Name, Kategorie und LDraw-Nummer sind ohne Netzwerk
durchsuchbar. Pro Paket zeigt „Herkunft und Lizenz“ Quellen, Autoren, Änderungen
und nach Installation die lokal gespeicherten Rechtstexte.

Die Pakete sind unveränderte, geprüfte CC-BY-4.0-Dateien aus der offiziellen
LDraw-Bibliothek; Details: [`docs/parts-licensing.md`](docs/parts-licensing.md).
Es handelt sich um eine technische Lizenzprüfung, keine anwaltliche Beratung.
Netzwerkfehler, falsche Prüfsummen und Speicherfehler werden angezeigt;
unvollständige Downloads ersetzen keine Installation. Vorhandene Projekte
bleiben beim Datenbankupgrade erhalten.

Weitere automatisierte Tests prüfen Snapshot-Hashes, rekursive Vollständigkeit,
getrennte Paketinstallation, Offline-Suche nach Wiederöffnen, Abbruch und
Fehlerfälle, Transaktions-Rollback und Migration bestehender Projekte.

## Entwicklungsbefehle

```sh
# Replit injects PORT and BASE_PATH through the managed workflow.
# For a local checkout:
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile run dev
pnpm --filter @workspace/brickbuilder-mobile run typecheck
pnpm --filter @workspace/brickbuilder-mobile run test
```
