# Benachrichtigungen bei fehlenden Teilen

Bei IO-, LDR-, MPD- und internen JSON-Importen werden erkennbare Teilreferenzen
mit fehlender oder ungültiger Geometrie als direkt sichtbare
In-App-Benachrichtigung angezeigt:

- In der Dateivorschau vor dem Anlegen des Projekts.
- Im Editor nach erfolgreichem Anlegen sowie beim erneuten Öffnen des Projekts.
- Mit LDraw-Teilenummer, betroffener Stückzahl und Fehlerursache.
- Zusätzlich mit BrickLink-Teilenummer, sofern diese ausdrücklich zugeordnet ist.

Mehrfach vorkommende Teile werden nach Referenz zusammengefasst. Die Liste ist
auf kleinen Bildschirmen scrollbar. Die Meldung verschwindet nicht automatisch;
im Editor kann sie geschlossen werden. Beim erneuten Öffnen oder Neuladen
erscheint sie wieder, solange das Projekt fehlende Geometrien enthält.

Eine fehlende BrickLink-Zuordnung oder eine unbekannte Farbe bedeutet nicht,
dass das Teil nicht importiert wurde. Diese Hinweise bleiben im ausführlichen
Importbericht und werden nicht als fehlgeschlagene Teilegeometrie gemeldet.

Die zugrunde liegenden Referenzen und Quelldaten werden weder gelöscht noch
durch andere Steine ersetzt. Diese Änderung lädt fehlende Geometrien nicht
automatisch nach. Eine vollständig unlesbare Datei liefert weiterhin einen
Dateifehler; ohne auslesbare Referenzen können keine Teilenummern genannt werden.

Die automatisierten DOM-Tests prüfen sichtbare IDs, Zusammenfassung, Ursachen,
Schließen, erneutes Anzeigen und sicheres Anzeigen als Text. Die Meldung ist
für Screenreader als Alarm ausgezeichnet. Ein physischer Android-Gerätetest
dieser Meldungen ist noch nicht erfolgt.
