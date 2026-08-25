/**
 * make-doc-html.mjs — erzeugt die Praesentations-HTML (Funktionsuebersicht +
 * Roadmap) mit eingebetteten Screenshots aus .tekkforge-shots/bilder.json.
 * Danach macht scripts/make-doc-pdf.mjs eine PDF daraus.
 */
import * as fs from "node:fs";

const bilder = JSON.parse(fs.readFileSync(".tekkforge-shots/bilder.json", "utf8"));
const img = (name, caption) =>
  bilder[name]
    ? `<figure><img src="data:image/png;base64,${bilder[name]}" alt="${caption}" />${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`
    : `<p class="fehlt">[Screenshot ${name} fehlt]</p>`;

const heute = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

const abschnitte = [
  {
    nr: "01",
    titel: "Pattern-Editor",
    lead: "Patterns von Grund auf am PC bauen — ohne dass eine ESX-Datei im Spiel sein muss.",
    punkte: [
      "16 Parts × 16/32/64 Steps; je Step Note, Velocity und Gate, bis zu 4 Töne für Akkorde.",
      "Eigene WAVs importieren, den Parts zuweisen und direkt am Rechner vorhören.",
      "Sample-Pool als Bibliothek: Filter Alle/Factory/User, Suche, +12-dB-Flag, Speicherbalken gegen das ~24-MB-Sample-RAM.",
      "Export als <code>.e2spat</code> (Einzel-Pattern), <code>.e2sallpat</code> (Bank mit 250 Slots) und <code>.all</code> (Sample-Bank).",
      "Direkter Draht zum Gerät: Patterns per SysEx in einen Slot schreiben oder von dort holen.",
    ],
    bild: ["doc-editor", "Der Editor mit geladenem Akkord-Pattern: links die Pattern-Liste, in der Mitte das Step-Grid über 16 Parts, rechts der Sample-Pool mit RAM-Anzeige."],
  },
  {
    nr: "02",
    titel: "Generator — vom Lied zum Set",
    lead: "Das Herzstück: aus einem Sample-Ordner oder einem ganzen Lied entsteht eine fertige Sample-Bank samt passender Patterns.",
    punkte: [
      "<b>Lied hineingeben</b> — als Datei oder per YouTube-/SoundCloud-Link. Tempo, Tonart (mit Camelot-Angabe) und die markanten Stellen werden gemessen.",
      "<b>Stems trennen</b> — Demucs zerlegt das Lied in Melodie, Bass, Drums und Vocals. Aus dem Drums-Stem schneidet TekkForge einzelne Kick-, Snare- und Hat-Shots.",
      "<b>Ganze Vocalspur</b> — alle hörbaren 8-Takt-Abschnitte werden getrennt und der Reihe nach auf die Patterns verteilt. Wer die Kette durchspielt, hat das Lied einmal komplett gehört.",
      "<b>Aufbau-Kette</b> — die Patterns verketten sich von einer dünnen Anfangsstufe bis zum Drop; gespielt wird durch Entmuten am Gerät.",
      "<b>Drop mit Druck</b> — der Aufbau läuft gedimmt, vor dem Drop steht ein Snare-Fill, im Drop gehen die Kicks auf Maximum.",
      "<b>KI-Rezept</b> — auf Wunsch übersetzt Claude eine Beschreibung wie „düster, Vocal nur im Break“ in das Arrangement.",
    ],
    bild: ["vocal-probe4", "Ein kompletter Durchlauf: 30 Vocal-Segmente aus dem Lied, 5 geschnittene Drum-Shots, daraus 15 verkettete Patterns im gemessenen Tempo von 209,5 BPM."],
  },
  {
    nr: "03",
    titel: "MIDI zu Korg",
    lead: "Fertige MIDI-Dateien oder Audio in Electribe-Patterns übersetzen.",
    punkte: [
      "Standard-MIDI-Dateien (.mid, .kar, .rmi) laden und die Spuren den 16 Parts zuordnen.",
      "<b>Audio zu Noten</b> — eine WAV oder MP3 wird transkribiert: einstimmig oder polyphon mit bis zu vier gleichzeitigen Tönen.",
      "Akkord-Parts werden automatisch auf Poly gestellt, damit das Gerät wirklich alle Töne eines Steps spielt.",
      "Piano Roll zum Prüfen: Noten anklicken nimmt sie aus dem Import, Ziehen verschiebt sie — waagrecht in 16teln, senkrecht in Halbtönen.",
      "Übergabe in den Editor als 4-Takt-Patterns, Samples ordnest du dort zu.",
    ],
    bild: ["midi-poly", "Polyphone Transkription einer Melodie-WAV: 44 Noten mit drei Stimmen — Melodielinie oben, durchgehende Basstöne darunter."],
  },
  {
    nr: "04",
    titel: "Pad-Deck",
    lead: "Slots live triggern und mischen — die Bühnenseite des Werkzeugs.",
    punkte: [
      "Pattern-Slots direkt antippen; das laufende Pattern bleibt dabei unberührt.",
      "Learn-Funktion für eigene Controller — mit einem Akai MIDImix erprobt.",
      "Der Controller hängt an einem zweiten Port, getrennt von der Gerätelogik.",
    ],
    bild: ["doc-paddeck", "Das Pad-Deck mit Slot-Kacheln und Controller-Zuweisung."],
  },
  {
    nr: "05",
    titel: "Gerätesteuerung & Panel",
    lead: "Die Electribe vom Rechner aus bedienen.",
    punkte: [
      "Program Change, Mutes und Regler über MIDI — geräteverifiziert bis auf die Zählweise der Slot-Nummern.",
      "Transport: Play/Stop und MIDI-Clock werden vom Gerät angenommen.",
      "Zwei Firmware-Modi: Serien-Firmware (Stock) und Hacktribe werden erkannt; Hacktribe-Funktionen wie der RAM-Zugriff bleiben sonst gesperrt.",
    ],
    bild: ["doc-panel", "Das Panel mit Geräteanbindung, Program Change und Reglern."],
  },
  {
    nr: "06",
    titel: "ESX-Converter",
    lead: "Alte ESX-1-Backups auf die Electribe 2 heben.",
    punkte: [
      "Ein <code>.esx</code>-All-Backup wird in importfertige E2-Dateien gewandelt — Patterns und Samples.",
      "Ein Mapping-Report hält fest, welche Geräte-Nummer zu welchem Namen und welchem ESX-Index gehört.",
      "Gibt es auch als Kommandozeilen-Werkzeug für Stapelverarbeitung.",
    ],
    bild: ["doc-converter", "Der Converter mit Pattern-Auswahl und Mapping-Report."],
  },
  {
    nr: "07",
    titel: "Start-Dashboard & Assistent",
    lead: "Der Einstieg: Status auf einen Blick und ein Assistent für Rückfragen.",
    punkte: [
      "Kacheln für Patterns im Projekt, Samples im Pool, belegtes Sample-RAM und den MIDI-Status.",
      "Zuletzt geöffnete Dateien und Schnellzugriff in alle Module.",
      "<b>Assistent</b> — beantwortet Fragen zu TekkForge und zur Electribe, kennt die Module und die Geräte-Grenzen.",
    ],
    bild: ["doc-start", "Das Start-Dashboard mit Statuskacheln, letzten Dateien und dem Assistenten."],
  },
  {
    nr: "08",
    titel: "Einstellungen",
    lead: "Aussehen, Sicherheit, Aktualität.",
    punkte: [
      "Sechs Farbthemen plus frei wählbare Akzentfarbe — Aufbau und Bedienung bleiben gleich.",
      "<b>Auto-Backup</b> — beim Überschreiben landet der alte Stand in <code>backups/</code>, 20 Stände je Datei, mit Wiederherstellen-Knopf.",
      "Update-Prüfung gegen die Veröffentlichungen auf GitHub.",
    ],
    bild: ["doc-settings", "Themenauswahl, Backup-Manager und Update-Prüfung."],
  },
];

const roadmap = [
  {
    titel: "Abnahme am Gerät",
    wann: "als Nächstes",
    text: "Die neuen Funktionen sind am Bildschirm belegt, aber das Ohr entscheidet: kickt der Drop hörbar härter als der Aufbau, ergibt die Vocal-Reihenfolge das ganze Lied, klingen Akkorde vollständig, belegt jedes Sample genau einen Part?",
  },
  {
    titel: "Vocals sparsamer speichern",
    wann: "geplant",
    text: "Ein vocal-lastiges Lied bringt schnell 30 Segmente mit — mehr, als die ~24 MB Sample-RAM auf einmal fassen. Ideen: Vocals mit halber Abtastrate ablegen (doppelte Abdeckung) oder klanglich ähnliche Abschnitte zusammenfassen.",
  },
  {
    titel: "Stem-Trennung beschleunigen",
    wann: "geplant",
    text: "Die Trennung über das ganze Lied dauert derzeit einige Minuten. Grafikkarten-Unterstützung und eine Wahl zwischen schnellem und genauem Modell würden das deutlich kürzen.",
  },
  {
    titel: "Transkription verfeinern",
    wann: "geplant",
    text: "Bis zu vier Töne je Step stehen. Als Nächstes: erkannte Stimmen automatisch auf mehrere Parts verteilen und Anschläge sauberer von gehaltenen Tönen trennen.",
  },
  {
    titel: "Bank-Manager",
    wann: "vorgemerkt",
    text: "Samples innerhalb einer Bank umsortieren und ersetzen, ohne dass die Verweise in den Patterns brechen.",
  },
  {
    titel: "Motion-Sequenzen",
    wann: "vorgemerkt",
    text: "Regler-Bewegungen werden bisher nur gelesen. Sie auch schreiben zu können, würde ganze Arrangements lebendiger machen.",
  },
  {
    titel: "Mehr Plattformen",
    wann: "vorgemerkt",
    text: "Derzeit gibt es einen Windows-Installer. Baupläne für macOS und Linux sind der nächste logische Schritt.",
  },
  {
    titel: "Automatische Updates",
    wann: "vorgemerkt",
    text: "Die Prüfung meldet neue Veröffentlichungen bereits. Das Herunterladen und Einspielen soll die App künftig selbst übernehmen.",
  },
];

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>TekkForge 0.6.0 — Funktionen und Ausblick</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    background: #0e0e12; color: #e8e8ef;
    font-size: 10.5pt; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .seite { width: 210mm; min-height: 297mm; padding: 16mm 15mm; position: relative; page-break-after: always; }
  .seite:last-child { page-break-after: auto; }

  /* Titelseite */
  .titel { display: flex; flex-direction: column; justify-content: center; background: linear-gradient(150deg, #14141b 0%, #0e0e12 55%, #1b1118 100%); }
  .logo { width: 78px; height: 78px; border-radius: 20px; background: linear-gradient(135deg, #ff6a00, #4db8ff);
          display: flex; align-items: center; justify-content: center; font-size: 30pt; font-weight: 700; color: #0e0e12; letter-spacing: -1px; }
  h1 { font-size: 34pt; line-height: 1.1; margin: 22px 0 8px; letter-spacing: -0.5px; }
  h1 span { color: #ff6a00; }
  .unter { font-size: 14pt; color: #a9a9bd; max-width: 150mm; margin: 0 0 30px; }
  .kennz { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 8px; }
  .kennz div { background: #17171f; border: 1px solid #26262f; border-radius: 10px; padding: 12px 14px; }
  .kennz b { display: block; font-size: 18pt; color: #4db8ff; line-height: 1.2; }
  .kennz span { font-size: 8.5pt; color: #9a9ab0; }
  .fuss { position: absolute; left: 15mm; right: 15mm; bottom: 14mm; font-size: 9pt; color: #74748a;
          border-top: 1px solid #26262f; padding-top: 8px; display: flex; justify-content: space-between; }

  /* Abschnitte */
  h2 { font-size: 19pt; margin: 0 0 4px; letter-spacing: -0.3px; }
  .nr { color: #ff6a00; font-weight: 700; font-size: 11pt; letter-spacing: 2px; display: block; margin-bottom: 2px; }
  .lead { color: #a9a9bd; font-size: 11.5pt; margin: 0 0 16px; }
  ul { margin: 0 0 16px; padding-left: 18px; }
  li { margin-bottom: 7px; }
  code { background: #1e1e28; border: 1px solid #2c2c38; border-radius: 4px; padding: 1px 5px; font-size: 9pt; color: #7fd6ff; }
  b { color: #fff; }
  figure { margin: 0; break-inside: avoid; }
  figure img { width: 100%; border-radius: 8px; border: 1px solid #2c2c38; display: block; }
  figcaption { font-size: 8.5pt; color: #8a8aa0; margin-top: 6px; line-height: 1.4; }
  .fehlt { color: #ff6a00; font-size: 9pt; }

  /* Überblick */
  .karten { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
  .karte { background: #17171f; border: 1px solid #26262f; border-radius: 10px; padding: 14px 16px; break-inside: avoid; }
  .karte h3 { margin: 0 0 5px; font-size: 11.5pt; color: #fff; }
  .karte p { margin: 0; font-size: 9.5pt; color: #a9a9bd; }

  /* Roadmap */
  .rm { border-left: 2px solid #2c2c38; margin: 18px 0 0; padding-left: 18px; }
  .rm-eintrag { position: relative; margin-bottom: 18px; break-inside: avoid; }
  .rm-eintrag::before { content: ""; position: absolute; left: -24px; top: 5px; width: 10px; height: 10px;
                        border-radius: 50%; background: #ff6a00; border: 2px solid #0e0e12; }
  .rm-eintrag h3 { margin: 0 0 3px; font-size: 12pt; color: #fff; display: flex; align-items: baseline; gap: 10px; }
  .marke { font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #0e0e12;
           background: #4db8ff; border-radius: 20px; padding: 2px 9px; font-weight: 700; }
  .marke.jetzt { background: #ff6a00; }
  .rm-eintrag p { margin: 0; color: #a9a9bd; font-size: 10pt; }
  .hinweis { background: #17171f; border: 1px solid #26262f; border-left: 3px solid #ff6a00;
             border-radius: 8px; padding: 12px 16px; margin-top: 18px; font-size: 10pt; color: #c9c9d8; }
</style>
</head>
<body>

<section class="seite titel">
  <div class="logo">TF</div>
  <h1>Tekk<span>Forge</span> 0.6.0</h1>
  <p class="unter">Ein Werkzeugkasten für den KORG Electribe 2 Sampler: aus einem Lied wird ein spielbares Pattern-Set — Sample-Bank, Arrangement und Gerätesteuerung in einer Anwendung. Alles läuft lokal, keine Datei verlässt den Rechner.</p>
  <div class="kennz">
    <div><b>8</b><span>Module in einer App</span></div>
    <div><b>250</b><span>Pattern-Slots je Bank</span></div>
    <div><b>~24 MB</b><span>Sample-RAM im Blick</span></div>
    <div><b>538</b><span>automatische Tests</span></div>
  </div>
  <div class="fuss"><span>Funktionsübersicht und Ausblick</span><span>${heute}</span></div>
</section>

<section class="seite">
  <span class="nr">ÜBERBLICK</span>
  <h2>Was TekkForge macht</h2>
  <p class="lead">Die Electribe 2 ist ein eigenständiges Instrument mit engen Grenzen: 250 Pattern-Plätze, rund 24 MB Speicher für eigene Klänge, 16 Parts je Pattern. TekkForge nimmt die mühsame Vorbereitung am Rechner ab und liefert Dateien, die das Gerät direkt lädt.</p>
  <div class="karten">
    <div class="karte"><h3>Aus einem Lied</h3><p>Tempo und Tonart messen, in Melodie, Bass, Drums und Gesang zerlegen, Einzelschläge schneiden — und daraus eine Bank mit passenden Patterns bauen.</p></div>
    <div class="karte"><h3>Aus einem Ordner</h3><p>Ein Verzeichnis voller Samples wird sortiert, auf das Speicherbudget verteilt und zu einer spielbaren Bank zusammengesetzt.</p></div>
    <div class="karte"><h3>Von Hand</h3><p>Der Pattern-Editor baut Patterns Schritt für Schritt: Noten, Anschlagstärke, Tonlänge, Akkorde, eigene Klänge.</p></div>
    <div class="karte"><h3>Ans Gerät</h3><p>Fertige Dateien auf die Speicherkarte kopieren oder direkt per MIDI in einen Slot schreiben — das laufende Pattern bleibt unberührt.</p></div>
  </div>
  ${img("doc-start", "Der Start-Bildschirm: Statuskacheln, zuletzt geöffnete Dateien, Schnellzugriff und der eingebaute Assistent.")}
  <div class="hinweis"><b>Warum das zählt:</b> Das Dateiformat der Electribe ist nirgends offiziell beschrieben. Jede Byte-Position in TekkForge ist am echten Gerät nachgemessen — deshalb landen die Dateien nicht nur im Speicher, sondern klingen auch so, wie sie sollen.</div>
</section>

${abschnitte
  .map(
    (a) => `<section class="seite">
  <span class="nr">${a.nr}</span>
  <h2>${a.titel}</h2>
  <p class="lead">${a.lead}</p>
  <ul>${a.punkte.map((p) => `<li>${p}</li>`).join("")}</ul>
  ${img(a.bild[0], a.bild[1])}
</section>`,
  )
  .join("\n")}

<section class="seite">
  <span class="nr">AUSBLICK</span>
  <h2>Was als Nächstes kommt</h2>
  <p class="lead">Der Stand von heute ist benutzbar und getestet. Diese Punkte stehen als Nächstes an — geordnet nach Dringlichkeit, nicht nach Aufwand.</p>
  <div class="rm">
    ${roadmap
      .map(
        (r) => `<div class="rm-eintrag">
      <h3>${r.titel} <span class="marke${r.wann === "als Nächstes" ? " jetzt" : ""}">${r.wann}</span></h3>
      <p>${r.text}</p>
    </div>`,
      )
      .join("")}
  </div>
</section>

<section class="seite">
  <span class="nr">TECHNIK</span>
  <h2>Grundlagen in Kürze</h2>
  <p class="lead">Was unter der Oberfläche gilt — die Regeln, an denen sich alles ausrichtet.</p>
  <div class="karten">
    <div class="karte"><h3>Am Gerät nachgemessen</h3><p>Schrittraster, Ketten, Effekt- und Part-Einstellungen sind gegen echte Werksdateien und Testpatterns auf der Hardware abgeglichen.</p></div>
    <div class="karte"><h3>Alles einkanalig</h3><p>Die Electribe legt ein einkanaliges Sample auf einen Part, ein zweikanaliges auf zwei. Jedes erzeugte Sample ist deshalb einkanalig — das spart Parts und Speicher.</p></div>
    <div class="karte"><h3>Zwei Firmware-Welten</h3><p>Serien-Firmware und die erweiterte Hacktribe-Fassung werden erkannt; heikle Zusatzfunktionen bleiben gesperrt, solange sie nicht sicher verfügbar sind.</p></div>
    <div class="karte"><h3>Nichts verlässt den Rechner</h3><p>Analyse, Trennung und Erzeugung laufen lokal. Nur zwei Wege gehen nach außen — und nur, wenn man sie nutzt: der Link-Import und die optionale KI-Anfrage.</p></div>
    <div class="karte"><h3>Sicherheitsnetz</h3><p>Vor jedem Überschreiben wird der alte Stand gesichert; zwanzig Stände je Datei lassen sich zurückholen.</p></div>
    <div class="karte"><h3>Geprüft statt geglaubt</h3><p>538 automatische Tests laufen bei jeder Änderung, dazu Durchläufe in der echten Anwendung mit Bildnachweis.</p></div>
  </div>
  <div class="hinweis"><b>Bezug:</b> Windows-Installer und tragbare Fassung liegen als Veröffentlichung 0.6.0 auf GitHub bereit. Für Stem-Trennung und Link-Import wird zusätzlich Python benötigt.</div>
  <div class="fuss"><span>TekkForge 0.6.0 — Funktionsübersicht und Ausblick</span><span>${heute}</span></div>
</section>

</body>
</html>`;

fs.writeFileSync(".tekkforge-shots/doc.html", html, "utf8");
console.log(`HTML: .tekkforge-shots/doc.html (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
