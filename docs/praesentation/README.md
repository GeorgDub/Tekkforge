# Präsentation

`TekkForge-Uebersicht.pdf` — Funktionsübersicht und Ausblick, zum Zeigen und
Weitergeben. Die Datei liegt bewusst im Repository, damit immer eine aktuelle
Fassung greifbar ist.

## Bei jeder neuen Funktion mitpflegen

Eine Präsentation, die den Stand von vorgestern zeigt, ist schlimmer als keine.
Nach jeder Erweiterung also:

1. **Screenshot** der neuen Ansicht machen und als `bilder/<name>.png` ablegen
   (der Treiber hilft: `node .claude/skills/run-tekkforge/driver.mjs --run "launch; … ; ss <name>"`,
   dann aus `.tekkforge-shots/` hierher kopieren).
2. **Inhalt** in `scripts/make-doc-html.mjs` ergänzen — neuer Abschnitt oder
   neuer Punkt in einem bestehenden. Auch die Kennzahlen auf der Titelseite und
   den Ausblick anfassen, wenn sich dort etwas erledigt hat.
3. **Bauen und prüfen:**

   ```bash
   node scripts/make-doc-html.mjs
   node scripts/make-doc-pdf2.mjs .tekkforge-shots/doc.html docs/praesentation/TekkForge-Uebersicht.pdf
   node scripts/pruefe-doc.mjs      # Seitenzahl + Layout-Screenshots
   ```

4. **Mitcommitten** — PDF und neue Bilder gehören in denselben Commit wie die
   Funktion, sonst laufen sie auseinander.

## Aufbau

Titelseite mit Kennzahlen, Überblick, dann je ein Abschnitt pro Modul, danach
die gerätenahen Themen (Firmware-Unterschiede, Effekte, eigene Presets und
Grooves, Geräte-Spiegel, Speicherzugriff), zum Schluss Ausblick und Technik.

Der Text richtet sich an Leute, die die Electribe **nicht** kennen: keine
Abkürzungen ohne Erklärung, keine Byte-Offsets, dafür der Grund, warum eine
Sache erwähnenswert ist. Fachliche Details gehören in `README.md`, nicht hierhin.
