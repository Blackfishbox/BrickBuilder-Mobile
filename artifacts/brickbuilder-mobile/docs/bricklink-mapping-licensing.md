# BrickLink-Teilenummern: Nachweis und Lizenz

## Getrennter Datenbestand

`ldraw-explicit-bricklink`, Version `2026-10-31.1`, wird unabhängig von
App-Code und Geometrie versioniert. Die acht Datensätze sind eine bearbeitete
Auswahl aus ausdrücklich genannten `0 !KEYWORDS BrickLink …`-Zeilen der
offiziellen LDraw-Dateien, keine BrickLink-Katalogkopie oder Studio-Datenbank.
Extraktion, Namens-Leerraumnormalisierung und Variantenhinweise: BrickBuilder.
Namen sind **LDraw-Beschreibungen**, keine bestätigten BrickLink-Katalognamen.
Es werden keine Marktpreise oder Live-Verfügbarkeiten abgerufen.

Die Auswahl und abgeleiteten Beschreibungen stehen unter **CC BY 4.0**:
https://creativecommons.org/licenses/by/4.0/
Die Lizenz gilt für diesen Datenbestand, nicht automatisch für App-Code.
Die Autoren sind pro Datensatz erhalten. Die vollständigen Originaldateien
mit Historien sowie `CAreadme.txt` und `CAlicense4.txt` liegen im bereits
ausgelieferten, hashgebundenen Import-Geometriepaket. Der Importbericht
speichert Autoren, Quellen-URLs, unveränderte Belegzeilen, SHA-256 der
Originaldateien, Lizenz, Datenbestands-ID und Version direkt im Projekt.
Die URLs können sich künftig ändern; maßgeblich ist der geprüfte Snapshot.
Keine Bestätigung oder Empfehlung durch LDraw, BrickLink oder LEGO behauptet.

## Belegte Auswahl

| LDraw | BrickLink | LDraw-Beschreibung / Variante |
| --- | --- | --- |
| 3023a | 3023old | Plate 1 x 2 with Flat Pin |
| 3023b | 3023 | Plate 1 x 2 |
| 3069b | 3069 | Tile 1 x 2 with Groove |
| 3070b | 3070 | Tile 1 x 1 with Groove |
| 4032a | 4032 | Plate 2 x 2 Round with Axlehole |
| 60897 | 4085d | Plate 1 x 1 with Clip Vertical (Thick C-Clip) |
| 6141 | 4073 | Plate 1 x 1 Round |
| 73587p01 | 4592c02 | Hinge Control Stick Base with Black Control Stick |

Jeder Nachweis verlinkt auf
`https://library.ldraw.org/library/official/parts/<LDraw-ID>.dat`.
Die Hashes und Autoren werden automatisiert gegen den vorhandenen Snapshot
geprüft. Dieser erste Bestand belegt **8 der 74** unterschiedlichen
Referenzteile; die übrigen **66 bleiben unbestätigt**, auch wenn Nummern
zufällig gleich aussehen. Studio-IDs bleiben vollständig unbestätigt.

## Konflikte, Pakete und Wiederöffnen

Nur Groß-/Kleinschreibung und `.dat` werden normalisiert; Suffixe,
Baugruppen, Drucke und Pfade nicht zusammengelegt. Gleiche BrickLink-ID aus
mehreren Nachweisen ist keine Mehrdeutigkeit; unterschiedliche IDs für die
exakt gleiche LDraw-Referenz sind es. Alle Kandidaten bleiben sichtbar,
ohne erste Quelle oder Installationsreihenfolge zu bevorzugen.
Geometrieauflösung und Nummernzuordnung sind voneinander unabhängig.

Installierbare Bibliothekspakete können das optionale `mappings`-Feld der
bestehenden `LibraryPart`-Schnittstelle verwenden. Die Paketprüfung verlangt
den exakten Original-Keyword, Autor, Lizenz, URL und Quellenhash; unbelegte
alte `brickLinkId`-Felder werden nicht als Nachweis übernommen.
Dieser Bestand wird gebündelt und benötigt keinen eigenen Netzabruf.

JSON-Sicherung, Autosave und Wiederöffnen erhalten den verwendeten
Nachweisstand und Konflikte offline. Bestehende Projekte werden nicht
nachträglich mit neuen Zuordnungen umgeschrieben; ein erneuter Quellenimport
verwendet den aktuellen Bestand.
