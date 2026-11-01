# Ältere verschlüsselte Studio-IO-Dateien

## Reproduzierter Fehler

Die private Nutzerdatei `attached_assets/40649-size_1793502923137.io`
ist ein ZIP32-Archiv mit 122 Einträgen, rund 4,6 MiB komprimiert und
22.599.896 Bytes angegebener entpackter Gesamtgröße.
Studio nennt darin Version `2.23.5_1`.

Die Einträge sind traditionell PKZIP-verschlüsselt. Der bisherige Reader
lehnte diese Variante ab. Außerdem überschreitet `model2.ldr` mit
17.776.068 Bytes das bisher für jeden Eintrag angewandte 16-MiB-Limit,
obwohl diese zusätzliche Studio-Geometrie nicht ausgewertet werden muss.

## Änderung

- Der IO-Adapter unterstützt zusätzlich die dokumentierte feste
  Studio-Formatverschlüsselung; keine Passwortsuche oder Benutzerzugangsdaten.
- Die verwendete Formatkonvention ist öffentlich dokumentiert:
  <https://wiki.ldraw.org/wiki/IO>.
- Alle ZIP-Namen, lokalen Köpfe, Bereiche und Gesamtgrößen werden geprüft.
- Nur `model.ldr` wird entschlüsselt und entpackt. Dessen tatsächliche Größe
  und CRC werden geprüft; Ausgabepuffer bleiben begrenzt.
- Alle weiteren Einträge verbleiben unverändert im Originalupload.
  Sie werden weder ausgeführt noch in die lizenzierte Teilebibliothek kopiert.
- Normale ZIP-Nutzung außerhalb des IO-Adapters akzeptiert weiterhin keine
  verschlüsselten Archive.

## Tatsächlicher Teststand

Der Import der privaten Datei wird lokal als Regressionstest ausgeführt,
sofern sie vorhanden ist. Dieser Test liest 8.590 aufgelöste Typ-1-
Teilinstanzen mit 517 unterschiedlichen externen Referenzen und prüft,
dass der Originalupload unverändert erhalten bleibt.

Die Studio-Metadaten nennen dagegen 8.586 Teile. Diese Zahl wird nicht
blind als Parsergebnis übernommen. Das Modell enthält außerdem vier
rein dreiecksbasiert beschriebene flexible Untermodelle. Der aktuelle Parser
erhält solche Geometriezeilen nur in der Quelle und meldet sie im Bericht;
er stellt sie nicht als Flächen dar.

Der gebündelte Geometriebestand deckt nur einen Teil der 517 Referenzen ab.
Installierte Teilepakete können den verfügbaren Bestand erweitern.
Fehlende Standardteile werden mit Referenz und Stückzahl als Benachrichtigung
angezeigt; unbestätigte Farbzuordnungen behalten ihre bisherigen Warnungen.
Eine vollständige oder visuell Studio-identische Darstellung dieser Datei
ist daher **nicht** nachgewiesen.

Zusätzlich testen selbst erstellte, unabhängig mit Info-ZIP verschlüsselte
Text-Fixtures gespeicherte und DEFLATE-komprimierte Einträge, einen falschen
Schlüssel, beschädigte Daten, Größenabweichungen und das Überspringen großer,
nicht benötigter Ressourcen. Diese Fixtures enthalten keine privaten Modelle.
Ein physischer Android-Test steht aus.
