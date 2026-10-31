# BrickBuilder Mobile — Architektur und Phase 1

## Produktgrenze

BrickBuilder Mobile ist eine eigenständige, offline-orientierte PWA. Die erste
Ausbaustufe ist ein lokaler 3D-Editor mit drei einfachen Steintypen. Es gibt
keinen Server, kein Konto und keine kostenpflichtige Laufzeitabhängigkeit.
Geometrien in Phase 1 sind prozedural erzeugt; sie sind kein Ersatz für die
LDraw-Bibliothek.

## Komponentenarchitektur

```text
React UI
  └─ EditorShell / mobile controls
      ├─ useBuilder (Dokument, Auswahl, Werkzeuge, Verlauf, Autosave)
      ├─ BuilderCanvas (Three.js, Raycasting, Kamera, Touch-Eingaben)
      │   └─ InstancedMesh-Gruppen nach Steintyp und Farbe
      └─ Parts drawer / palette (Baukasten und paketweise LDraw-Bibliothek)

Domain
  ├─ versioniertes BuilderDocument
  ├─ Brick- und BrickType-Modelle
  ├─ Raster-/Snap-Funktionen
  └─ History (Undo/Redo)

Persistenz & Offline
  ├─ Dexie / IndexedDB: Projekte, aktives Projekt, Wiederherstellung, Teilepakete
  ├─ Debounced Autosave nach lokalen Änderungen
  └─ Service Worker: Vite-App-Shell, statische Assets, Navigation-Fallback

Worker
  └─ Modellanalyse und räumliche Kennzahlen aus dem Editor-Hauptthread auslagern

Erweiterungspunkte (spätere Phasen)
  ├─ parts/: installierte LDraw-Originaldateien für spätere Geometrie-/Formatadapter
  ├─ catalog/bricklink: getrennte BrickLink-IDs, Farben, Preise und Verfügbarkeit
  └─ formats/{internal,ldr,mpd,io}: unabhängige Importer/Exporter und Roundtrips
```

## Vorgeschlagene Ordnerstruktur

```text
src/
  app/                 # PWA-Registrierung und Anwendungsrahmen
  components/mobile/   # Touch-optimierte Bedienelemente
  features/editor/     # Dokumentmodell, Befehle, Verlauf, React-Hook
  features/engine/     # Three.js-Szene, Kamera, Raycasting, Worker
  features/parts/      # lokaler Phase-1-Teilekatalog und Filter
  features/projects/   # Projektübersicht und Wiederherstellungsablauf
  storage/             # IndexedDB-Schema und Repository
  formats/internal/    # internes JSON, Versionierung und Migration
  formats/ldr/         # später: LDR-Import/-Export getrennt
  formats/mpd/         # später: MPD-Import/-Export getrennt
  formats/io/          # später: isolierter IO-Adapter, unbekannte Metadaten
  workers/             # aufwendige Modell- und Katalogberechnungen
  test/                # Test-Setup und Beispielmodelle
public/
  icons/               # lokale PWA-Symbole
```

Die Verzeichnisse für spätere LDraw-/BrickLink-/Dateiformat-Arbeit sind
Erweiterungspunkte, keine Behauptung, dass diese Funktionen bereits existieren.

## Datenmodell (internes JSON v1)

- `BuilderDocument`: `schemaVersion`, `id`, `name`, `createdAt`, `updatedAt`,
  `bricks[]`, `metadata`.
- `Brick`: stabile ID, interner Steintyp, Farbe, Position `(x,y,z)` in
  Baueinheiten und Y-Rotation in Vierteldrehungen.
- `BrickType`: interne IDs `brick-2x4`, `brick-2x2`, `brick-1x2`. Diese IDs
  werden getrennt von LDraw- und BrickLink-Teilenummern gehalten.
- `metadata`: versionsfähiges Objekt, das später unbekannte Import-Metadaten
  aufnehmen kann.
- Die Phase-1-Farben sind lokale Hex-Farben; sie sind noch keine offizielle
  LDraw-/BrickLink-Farbzuordnung.

Horizontal liegen Noppen auf einem 1-Baueinheit-Raster; das Zentrum eines
Steins kann durch unterschiedliche Grundflächen auf halbe Einheiten fallen.
Y wird auf die Steinhöhe eingerastet. Intern werden Einheiten verwendet, nicht
Screenspace-Pixel. Die Engine ist für visuelle Rasterplatzierung ausgelegt;
mechanische Verbindungen werden erst mit echten Teilegeometrien ergänzt.

## Implementierungsplan

1. [x] Mobiles Editor-Gerüst und responsive Hoch-/Querformat-Ansicht.
2. [x] Three.js-Grundplatte, Raster, parametrisierte Steine, Kamera und Raycasting.
3. [x] Platzieren, Auswählen, Verschieben, Drehen, Löschen und einfache Snaps.
4. [x] Undo/Redo, lokale Projekte, Autosave und Wiederherstellung über IndexedDB.
5. [x] PWA-Manifest, Service Worker und App-Shell-Cache für Offline-Aufruf.
6. [x] Vitest für Snap-, History-, Dokument- und Speicherlogik.
7. [ ] LDraw-Pakete, BrickLink-Katalogdaten, Import/Export und größere
       Performance-Läufe separat implementieren und prüfen.

## Offline-Strategie

Der Build enthält alle Editor-Bestandteile lokal. Der Service Worker cached
App-Shell und gebündelte Assets; es werden für die Kernbedienung keine
Remote-Schriftarten, Katalog-APIs oder Bild-CDNs benötigt. Projekte und
Wiederherstellungspunkte liegen lokal in IndexedDB. Autosave läuft nach einer
kurzen Verzögerung und ein explizites Speichern ist zusätzlich verfügbar.
Installierte PWA und bereits geladene Version funktionieren ohne Netzwerk;
neue Teilepakete benötigen eine Netzwerkverbindung. Sie werden nicht vorab vom
Service Worker geladen, sondern nur auf ausdrücklichen Paketdownload in
IndexedDB gespeichert.

### Lokale LDraw-Bibliothek

`features/parts/` enthält einen gebündelten Paketkatalog und einen atomaren
Installer. Zwei kleine, einzeln ladbare Snapshots (Steine und Platten) enthalten
je sechs Teile, sämtliche rekursiven Unterteile/Primitive und Lizenztexte.
SHA-256, Bytezahl, Paketversion, Lizenzheader und Abhängigkeiten werden vor dem
Schreiben geprüft. IndexedDB-Schema v2 ergänzt die Tabellen, ohne bestehende
Projekte umzuschreiben. Fehler lassen vorhandene Pakete unverändert.
Suche nach Name, LDraw-Nummer und Kategorie liest ausschließlich lokale Daten.
Indexdaten, Originaldateien und Rechtstexte sind nach Browserneustart verfügbar.
Browserdatenlöschung oder Speicherverdrängung kann lokale Daten dennoch löschen.

Interne Katalog-ID (`ldraw-bricks:3001`), LDraw-ID (`3001`), interner
Editor-Steintyp (`brick-2x4`) und optionales späteres `brickLinkId` sind
getrennte Felder. Es gibt keine implizite Gleichsetzung mit BrickLink.
Nur die drei bereits unterstützten Formen sind aus der Bibliothek im Editor
auswählbar; alle übrigen Einträge sind als „Nur Katalog“ gekennzeichnet.
Das Laden/Rendern originaler LDraw-Geometrie ist ein eigener Ausbau, kein
stillschweigender Ersatz durch unpassende prozedurale Formen.

Quellenprüfung, Urheber und Lizenzpflichten stehen in
[`parts-licensing.md`](parts-licensing.md).

## IO-Kompatibilität und Risiken

IO wird als separater Adapter geplant und darf nicht mit LDR/MPD oder dem
internen Format vermischt werden. Vor einer Kompatibilitätsaussage braucht es
selbst erstellte, lizenzrechtlich unbedenkliche IO-Testdateien. Der Adapter muss
Containerstruktur, Submodelle und unbekannte Metadaten explizit modellieren;
Import und Export bekommen getrennte Tests einschließlich Roundtrip. Diese
Arbeit ist nicht Bestandteil der ersten Phase.

Wesentliche Risiken: WebGL-Leistung und Speicher auf älteren Android-Geräten,
Speicherquoten/Browser-Eviction in IndexedDB, Touch-Gesten-Kollisionen mit
Browsernavigation sowie die deutlich höhere Komplexität echter LDraw-Geometrien
und IO-Dateien. Ein Desktop-Preview kann reale Android-Hardware nicht ersetzen;
die Smartphone-Abnahme bleibt ein eigener Gerätetest.

## Stand Phase 1

Die Basisversion und die lokale LDraw-Paketbibliothek sind implementiert.
Funktionen, Prüfergebnisse und bekannte Grenzen stehen in `README.md`.
BrickLink-Daten und alle externen Modellformate bleiben außerhalb dieses
Ausbaus; es wird dafür keine Kompatibilität behauptet.
