/**
 * make-doc-html.mjs — erzeugt die Praesentations-HTML (Funktionsuebersicht +
 * Ausblick) mit eingebetteten Screenshots aus docs/praesentation/bilder/.
 * Danach macht scripts/make-doc-pdf2.mjs eine PDF daraus.
 *
 * **Bei jeder neuen Funktion mitpflegen** — die PDF liegt im Repo und soll den
 * Stand zeigen, nicht den von vorgestern. Ablauf:
 *   node scripts/make-doc-html.mjs
 *   node scripts/make-doc-pdf2.mjs .tekkforge-shots/doc.html docs/praesentation/TekkForge-Uebersicht.pdf
 */
import * as fs from "node:fs";
import * as path from "node:path";

const VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const BILDER = "docs/praesentation/bilder";
const img = (name, caption) => {
  const datei = path.join(BILDER, `${name}.png`);
  if (!fs.existsSync(datei)) return `<p class="fehlt">[Screenshot ${name}.png fehlt in ${BILDER}]</p>`;
  const b64 = fs.readFileSync(datei).toString("base64");
  return `<figure><img src="data:image/png;base64,${b64}" alt="${caption}" />${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
};

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
      "<b>Sample-Editor</b> — Wellenform ansehen, Anfang und Ende ziehen, stille Ränder finden, kürzen, ein- und ausblenden, normalisieren, umkehren und den Loop setzen.",
      "<b>Bank ordnen</b> — Lücken schließen oder nach Name, Länge oder Nummer sortieren. Jede Nummernänderung zieht die Verweise der Patterns mit, damit nichts ins Leere zeigt.",
      "<b>Song-Modus</b> — Patterns zu einem Track aneinanderreihen: Abschnitt wählen, Durchgänge festlegen, Kette schreiben. Danach spielt das Gerät den Song von allein durch. Eine Kette, die schon im Projekt steckt — auch die eines importierten fremden Sets — wird angezeigt, und die ganze Kette lässt sich am Rechner zu einer Audiodatei ausrechnen und anhören.",
      "<b>Varianten aus einem Pattern</b> — aus einer fertigen Figur entsteht auf Knopfdruck eine Abwandlung als neues Pattern: Fill (Snare-Wirbel im letzten Viertel mit ansteigendem Anschlag), halbes und doppeltes Tempo, ausgedünnt fürs Intro, rückwärts, oder mit gestreutem Anschlag gegen den Maschinen-Klang. Das Original bleibt unberührt. Hing es in einer Kette, wird die Variante dazwischengehängt — genau der Fall „Fill vor dem Drop“.",
      "<b>Klangprobe vor dem Schreiben</b> — dieselbe Stelle einmal so, wie sie am Rechner liegt, und einmal so, wie das Gerät sie spielt: auf einen Kanal gelegt, auf 16 Bit quantisiert, im Tempo angepasst. Bei einem Sample mit gespeicherter Rate unter 44,1 kHz kommt ein dritter Knopf dazu — er spielt den Fall, dass die Electribe diese Rate NICHT beachtet und alles doppelt so schnell läuft. Genau diese Frage ist am Gerät noch offen; bis sie entschieden ist, kann man wenigstens beide Fälle vorher hören und hinterher am Klang erkennen, welcher eingetreten ist.",
      "<b>Rückgängig und Wiederherstellen</b> — dreißig Schritte weit zurück, über Strg+Z und Strg+Y oder die beiden Pfeile in der Werkzeugleiste. Gemerkt werden ganze Zustände, nicht einzelne Handgriffe: dadurch kann keine Bearbeitung vergessen werden, auch keine, die erst später dazukommt.",
      "Export als <code>.e2spat</code> (Einzel-Pattern), <code>.e2sallpat</code> (Bank mit 250 Slots) und <code>.all</code> (Sample-Bank).",
      "Direkter Draht zum Gerät: Patterns per SysEx in einen Slot schreiben oder von dort holen.",
    ],
    bild: ["editor", "Der Editor mit geladenem Akkord-Pattern: links die Pattern-Liste, in der Mitte das Step-Grid über 16 Parts, rechts der Sample-Pool mit RAM-Anzeige."],
    extra: `<div style="margin-top:10px">${img("sample-editor", "Der Sample-Editor: Wellenform mit ziehbarem Anfang und Ende, darunter die Werkzeuge — bis „Übernehmen“ bleibt das Original unberührt.")}</div>
    <div style="margin-top:10px">${img("klangprobe", "Die Klangprobe im Sample-Editor: „Original“ gegen „Wie am Gerät“, daneben die Angabe, was das Speichern an dieser Stelle überhaupt ändert.")}</div>
    <div style="margin-top:10px">${img("varianten", "Ein Fill aus „DROP“: links das Varianten-Feld mit Erklärung, im Raster der Snare-Wirbel auf den letzten vier Steps — heller werdend, weil der Anschlag zum Ende hin ansteigt. Das Original steht unverändert als Pattern 1 daneben.")}</div>`,
  },
  {
    nr: "02",
    titel: "Generator — vom Lied zum Set",
    lead: "Das Herzstück: aus einem Sample-Ordner oder einem ganzen Lied entsteht eine fertige Sample-Bank samt passender Patterns.",
    punkte: [
      "<b>Lied hineingeben</b> — als Datei oder per YouTube-/SoundCloud-Link. Tempo, Tonart (mit Camelot-Angabe) und die markanten Stellen werden gemessen. Die Oktave des Tempos wird dabei in Verhältnissen entschieden, nicht in Schritten: ein Lied mit gemessenen 120 Schlägen wird zuverlässig als 240er Tekk gefahren und nicht als Halbtempo — vorher entschied darüber ein Bruchteil eines Schlages.",
      "<b>Stems wählen</b> — vor dem Trennen lässt sich ankreuzen, was überhaupt herausfallen soll: Melodie, Vocals, Drums, Bass. Das ist keine Bequemlichkeit, sondern entscheidet, was im knappen Sample-RAM landet — wer die Drums lieber aus dem eigenen Kit nimmt, gewinnt den Platz für mehr Vocalspur. Bass fällt auf Wunsch als eigener Teil heraus und wird dann aus der Melodie herausgenommen, damit er nicht doppelt im Set steckt. Fehlt etwas Wichtiges, steht der Hinweis daneben, bevor der Lauf startet.",
      "<b>Stems trennen</b> — Demucs zerlegt das Lied in Melodie, Bass, Drums und Vocals. Aus dem Drums-Stem schneidet TekkForge einzelne Kick-, Snare- und Hat-Shots. Wahlweise schnell oder genau. Eine Grafikkarte wird genutzt, sobald sie verfügbar ist — gemessen der Faktor 7: eine Minute Musik in 2,4 statt 17,7 Sekunden.",
      "<b>Ganze Vocalspur</b> — alle hörbaren 8-Takt-Abschnitte werden getrennt und der Reihe nach auf die Patterns verteilt. Wer die Kette durchspielt, hat das Lied einmal komplett gehört. Wahlweise sparsam gespeichert, dann passt doppelt so viel Lied in eine Bank.",
      "<b>Aufbau-Kette</b> — die Patterns verketten sich von einer dünnen Anfangsstufe bis zum Drop; gespielt wird durch Entmuten am Gerät. Auf Wunsch spielt die erste Stufe nur jeden zweiten Schlagzeug-Schlag; Melodie und Vocals bleiben dabei ganz.",
      "<b>Luft im Pattern</b> — die erste Fassung war zu voll: nachgemessen lag auf <b>jedem</b> der 64 Sechzehntel mindestens ein Schlag, 109 insgesamt. Der schlanke Satz kommt auf 82 Schläge und 16 freie Stellen. Konkret: die offene HiHat rasselte auf jedem zweiten Step und ist jetzt ein Achtel-Akzent, der Clap lag in jedem Takt auf derselben Stelle wie die Snare und kommt jetzt nur noch in Takt 2 und 4, und die Kick bekommt einen eigenen vierten Takt statt viermal derselben Zeile. Dazu kommen Melodie und Vocals um gut 2 dB zurück: gerendert und nachgemessen lagen die Dauerschleifen +3,8 dB über dem gesamten Schlagzeug und deckten damit genau die Lücken zu, die das Ausdünnen geschaffen hatte. Der alte, dichte Satz bleibt als Schalter erhalten.",
      "<b>Drop mit Druck</b> — der Aufbau läuft gedimmt, vor dem Drop steht ein Sechzehntel-Wirbel auf der Snare, der von der gedimmten Aufbau-Höhe bis ans Maximum ansteigt, und im Drop gehen die Kicks auf 127. Den Wirbel bauen Generator und Pattern-Editor aus derselben Definition — eine Verbesserung trifft damit immer beide.",
      "<b>Als WAV ausrechnen</b> — die ganze Kette wird zu einer Audiodatei gerechnet, zum Anhören auf Kopfhörern oder unterwegs. Dieselbe vereinfachte Vorschau wie beim Vorhören: kein Filter, keine Effekte, also nicht der Geräteklang — aber genug, um Dichte, Aufbau und Verhältnis der Ebenen zu beurteilen, ohne dass das Gerät in Reichweite ist. Und es macht die eigenen Behauptungen nachprüfbar: dass der Wirbel wirklich ansteigt, dass die Kick sich nicht wiederholt und dass der schlanke Satz mehr Ruhe lässt, steht als Messung am gerenderten Ergebnis in den Tests.",
      "<b>Vorhören am Rechner</b> — jedes erzeugte Pattern lässt sich sofort anhören, ohne Gerät und ohne Umweg über den Editor. Gespielt wird der Weg über die fertige Bank-Datei, samt Stummschaltungen, Anschlag, Lautstärke, Panorama und Tonhöhe: was hier klingt, klingt auch dort. Damit lassen sich Varianten wie schlanker gegen dichten Satz direkt vergleichen.",
      "<b>Stapelbetrieb ohne Fenster</b> — <code>tekkforge lied &lt;ordner&gt;</code> fährt denselben Weg für einen ganzen Ordner: je Lied eine Sample-Bank und eine Pattern-Bank, auf Wunsch mit Stem-Trennung. Sechzehn Lieder umzusetzen ist damit ein Aufruf statt sechzehn Durchgängen. Gemessen: ein Lied mit Trennung in knapp einer Minute auf der Grafikkarte.",
      "<b>KI-Rezept</b> — auf Wunsch übersetzt Claude eine Beschreibung wie „düster, Vocal nur im Break“ in das Arrangement.",
    ],
    bild: ["generator-lied", "Ein kompletter Durchlauf: 30 Vocal-Segmente aus dem Lied, 5 geschnittene Drum-Shots, daraus 15 verkettete Patterns im gemessenen Tempo von 209,5 BPM."],
    extra: `<div style="margin-top:10px">${img("vorhoeren", "Jedes erzeugte Pattern lässt sich am Rechner anhören. Gespielt wird der Umweg über die fertige Bank-Datei — also genau das, was auch aufs Gerät ginge. Die Part-Zahlen 2 → 4 → 7 → 9 → 11 zeigen die Aufbau-Kette, die dritte Stufe läuft gerade.")}</div>`,
  },
  {
    nr: "03",
    titel: "MIDI zu Korg",
    lead: "Fertige MIDI-Dateien oder Audio in Electribe-Patterns übersetzen.",
    punkte: [
      "Standard-MIDI-Dateien (.mid, .kar, .rmi) laden und die Spuren den 16 Parts zuordnen.",
      "<b>Audio zu Noten</b> — eine WAV oder MP3 wird transkribiert: einstimmig oder polyphon mit bis zu vier gleichzeitigen Tönen.",
      "<b>Stimmen auf eigene Parts</b> — die erkannten Linien werden getrennt: tiefste zuerst, jede auf einen eigenen Part. Bass und Melodie lassen sich damit getrennt mit Samples belegen, statt als Akkord auf einem Part zu kleben.",
      "Akkord-Parts werden automatisch auf Poly gestellt, damit das Gerät wirklich alle Töne eines Steps spielt.",
      "Piano Roll zum Prüfen: Noten anklicken nimmt sie aus dem Import, Ziehen verschiebt sie — waagrecht in 16teln, senkrecht in Halbtönen.",
      "Übergabe in den Editor als 4-Takt-Patterns, Samples ordnest du dort zu.",
    ],
    bild: ["midi-polyphon", "Polyphone Transkription: 44 Noten auf drei Spuren aufgeteilt (21 tief, 14 mittel, 9 hoch) — jede landet auf einem eigenen Part."],
  },
  {
    nr: "04",
    titel: "Pad-Deck — Pads frei belegen",
    lead: "Ein eigenes Pad-Raster am Rechner: bis zu 8 × 8 Felder auf vier Seiten, und jedes Pad führt eine ganze Liste von Aktionen aus.",
    punkte: [
      "<b>Pattern wechseln</b> — springt auf einen der 250 Slots; bei laufendem Sequencer greift der Wechsel sauber am Taktende.",
      "<b>Pattern-Kopie mit Änderungen</b> — holt einen Slot vom Gerät, ändert Part-Werte, Lautstärke, Panorama, Mutes oder Tempo und schickt das Ergebnis flüchtig in den Zwischenspeicher. Kein Slot wird überschrieben.",
      "<b>Regler</b> — Cutoff, Resonanz und weitere Part-Regler, Insert-Effekt an/aus, Send zum Master-Effekt, dessen X/Y-Fläche.",
      "<b>Mutes</b> — Parts stumm oder wieder an, einzeln oder in Gruppen.",
      "<b>Transport</b> — Start, Stopp und ein Panik-Knopf, der alle Töne auf allen 16 Kanälen abwürgt.",
      "<b>Morph</b> — mehrere Regler gleichzeitig über eine bestimmte Zahl von Takten auf Zielwerte fahren, taktsynchron, mit Fortschrittsbalken im Pad.",
      "Je Pad: Beschriftung, Farbe, Tastaturkürzel und MIDI-Learn für einen eigenen Controller. Wahlweise sofort auslösen oder auf den nächsten Takt warten.",
      "<b>Live-FX per Controller</b> — 24 Regler verstellen die Parameter des gewählten Effekts, während das Gerät spielt. Ziel ist ein Part mit einem seiner beiden Insert-Effekte oder der Master-Effekt.",
      "Das Deck liegt im Projekt und lässt sich als Datei weitergeben; ein Beispiel-Deck baut sich aus den vorhandenen Patterns von selbst.",
    ],
    bild: ["fx-live", "Live-FX eingeschaltet: die Regler des Controllers gehen als Effekt-Parameter ans Gerät statt an die Pads."],
    extra: "<div class=\"hinweis\"><b>Eigener Controller, getrennter Weg:</b> Ein zweiter MIDI-Eingang — erprobt mit einem Akai MIDImix — geht ausschließlich ans Pad-Deck. Seine Nachrichten laufen bewusst nicht in die Gerätelogik, damit ein Reglerdreh am Controller nie versehentlich als Antwort der Electribe gedeutet wird.</div>",
  },
  {
    nr: "05",
    titel: "Was über MIDI geht",
    lead: "Der komplette Draht zum Gerät — alles über gewöhnliches MIDI, also mit beiden Firmware-Fassungen.",
    punkte: [
      "<b>Patterns übertragen</b> — in den Zwischenspeicher oder direkt in einen der 250 Slots, mit Empfangsbestätigung. Umgekehrt lassen sich Slots vom Gerät holen.",
      "<b>Arbeiten, während etwas läuft</b> — Pattern 50 vorbereiten, während 10 spielt: das laufende Pattern bleibt unberührt, der Slot ist fertig, sobald man hinwechselt.",
      "<b>Pattern-Wechsel</b> — über Program Change mit Bankumschaltung, damit auch die Patterns jenseits von 128 erreichbar sind.",
      "<b>Regler in beide Richtungen</b> — Bewegungen am Gerät erscheinen im Panel, Bewegungen im Panel gehen ans Gerät.",
      "<b>Transport und Takt</b> — Start, Stopp und eine mitlaufende MIDI-Uhr im Pattern-Tempo, driftkorrigiert.",
      "<b>Master-Effekt</b> — an/aus und die X/Y-Fläche fernsteuern.",
      "<b>Pads des Geräts</b> — Parts anspielen, chromatisch spielen, Steps löschen.",
      "<b>Panik</b> — Stopp, dann alle Töne auf allen Kanälen aus, dazu die selbst angespielten Noten einzeln. Wichtig dabei: die üblichen Sammelbefehle beenden nur Töne aus eingehenden Noten — den internen Sequencer stoppt erst der Stopp-Befehl.",
    ],
    bild: ["panel", "Das Panel: Geräteanbindung, Program Change, Regler-Spiegel und Transport."],
    extra:
      "<div class=\"hinweis\"><b>Zwei Eigenheiten, die uns Messreihen gekostet haben:</b> Das Gerät zählt Patterns beim Program Change ab null — die offizielle KORG-Beschreibung stimmt hier nicht. Und bei gestopptem Sequencer ignoriert es Pattern-Wechsel vollständig; sie greifen nur während der Wiedergabe. Beides steht heute als Hinweis direkt in der Oberfläche.</div>",
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
    bild: ["converter", "Der Converter mit Pattern-Auswahl und Mapping-Report."],
  },
  {
    nr: "07",
    titel: "Sample-Bank-Werkstatt",
    lead: "Zwei Bänke nebeneinander: links laden, rechts zusammenstellen.",
    punkte: [
      "<b>Aus mehreren Bänken sammeln</b> — links eine <code>.all</code> laden, ankreuzen, herüberholen. Die Quelle bleibt unberührt; man kann nacheinander beliebig viele Bänke öffnen und aus jeder das Passende nehmen.",
      "<b>Nummern werden neu vergeben</b> — und das ist der eigentliche Punkt. Zwei Bänke haben beide ein Sample 501; in der Zielbank kann nur eines die 501 behalten. Jede Nummer wandert deshalb über eine Abbildung, und Pattern-Verweise ziehen mit.",
      "<b>Verweise ohne Ziel werden geleert</b>, nicht geraten. Bliebe die alte Nummer stehen, spielte das Gerät dort ein fremdes Sample — still und falsch. Ein Part, der schweigt, ist besser als einer, der unbemerkt den falschen Klang bringt; gemeldet wird es zusätzlich.",
      "Filter Alle/Factory/User mit Zählern, Suche, +12-dB-Flag, Länge und Größe je Sample, Speicheranzeige gegen das ~24-MB-Limit.",
      "Fertige Bank als <code>.all</code> sichern oder direkt auf die Speicherkarte schreiben.",
    ],
    bild: ["sample-manager", "Zwei Bänke: links „drogen.all“ mit 62 Samples, rechts die Zielbank aus zwei verschiedenen Quellbänken zusammengestellt — beide brachten ein Sample 501 mit, in der Zielbank stehen sie sauber als 501 bis 504."],
  },
  {
    nr: "08",
    titel: "Stem-Werkbank",
    lead: "Die Spuren eines Lieds untereinander auf einer Zeitachse — anhören, Marken setzen, von Hand schneiden.",
    punkte: [
      "<b>Ein Lied hinein, vier Spuren heraus.</b> Melodie, Vocals, Drums und Bass werden in <b>einem</b> Durchgang über die ganze Länge getrennt und liegen danach untereinander, jede mit ihrer Wellenform. Gemessen (Grafikkarte): zwei Minuten Musik in 13,8 s. In 30-Sekunden-Stücken war derselbe Stoff langsamer — deshalb wird nicht gestückelt.",
      "<b>Anhören, wie es zusammen klingt.</b> Alle Spuren laufen aus einem einzigen Klangwerk, deshalb bleiben sie zusammen; je Spur gibt es stumm, solo und Pegel. Ein eigener Abspieler pro Spur wäre einfacher gewesen und innerhalb eines Taktes hörbar auseinandergelaufen — bei Stems desselben Lieds ist das der Unterschied zwischen „passt“ und „klingt falsch“.",
      "<b>Marken setzen mit der Maus</b> — Klick setzt, Umschalt+Klick nimmt weg, Ziehen wählt einen Bereich, Doppelklick spielt ab dort. Ein Raster aus Tempo und Taktzahl legt die Marken auf die Taktgrenzen, wahlweise auf alle Spuren oder nur auf eine.",
      "<b>Jede Marke schnappt auf den nächsten Nulldurchgang.</b> Ein Schnitt mitten in der Halbwelle knackt hörbar — und das fällt sonst erst auf, wenn die Bank schon auf dem Gerät ist.",
      "<b>Marken gehören zur Spur, nicht zur Zeitachse.</b> Naheliegend wäre ein gemeinsames Raster, denn die Spuren teilen sich ja die Zeit. Aber die Vocals will man in acht Phrasen zerlegen und die Melodie höchstens halbieren — mit gemeinsamen Marken ginge beides nicht nebeneinander.",
      "<b>Direkt bearbeiten</b> — auf die Auswahl kürzen, stille Ränder weg, ein- und ausblenden, normalisieren, umkehren, und zehn Schritte zurück. Dieselben Rechnungen wie im Sample-Editor.",
      "<b>Abschnitte in den Pool</b> — die Stücke zwischen den Marken werden zu nummerierten Samples. Was nicht ins ~24-MB-Sample-RAM passt, wird gar nicht erst angelegt; zu kurze Schnipsel fallen weg, statt als Knacken mit eigener Nummer in der Bank zu landen. Zerfällt eine <b>Melodie</b> in mehr als zwei Teile, steht der Hinweis dabei — von Hand ist es erlaubt, aber es soll Absicht sein.",
      "Aus dem Generator führt ein Knopf direkt hierher: dasselbe Lied, ohne es noch einmal auszuwählen.",
    ],
    bild: [
      "stem-werkbank",
      "Ein getrenntes Lied: oben der Mix, darunter Melodie und Vocals. Nur die Vocalspur ist im 8-Takt-Raster markiert und in 12 Abschnitte geschnitten — die Melodie bleibt ganz, genau wie es sein soll.",
    ],
    extra:
      "<div class=\"hinweis\"><b>Ein stiller Fehler kam dabei ans Licht:</b> Die Auswahl, welche Teile herausfallen sollen, wurde von der Oberfläche zwar geschickt, auf dem Weg zur Trennung aber weggelassen. Der Bass fiel deshalb nie als eigener Teil heraus, und Abwählen sparte keine Rechenzeit. Aufgefallen ist es erst, als die Werkbank vier Spuren anforderte und drei zurückkamen.</div>",
  },
  {
    nr: "09",
    titel: "Pattern-Bibliothek",
    lead: "Patterns mit ihrer Sample-Bank ablegen — und in einem Zug aufs Gerät bringen.",
    punkte: [
      "<b>Ein Eintrag ist ein Pattern MIT seinen Samples.</b> Abgelegt wird nicht der ganze Pool, sondern genau das, worauf die Parts zeigen. Damit endet die Sucherei nach der Bank, die zu einem Pattern von vorletzter Woche gehört.",
      "Ankreuzen, was mitsoll — und unten steht, wohin: <b>per USB auf die Geräte-Slots</b>, <b>als einzelne <code>.e2spat</code> in den Pattern-Ordner der Karte</b>, oder als <b>Set</b> aus einer <code>.e2sallpat</code> und den Bänken dazu.",
      "<b>Das Set gibt es in zwei Fassungen.</b> Getrennt: jedes Pattern behält seine Nummern, jede Bank bleibt für sich, am Gerät lädt man zu jedem Pattern die passende. Gemeinsam: alle Samples wandern in EINE Bank, die Nummern werden neu vergeben und die Verweise nachgezogen — ein Import, alles spielbar. Auf Wunsch hängen sich die Patterns dabei gleich zu einer Kette aneinander.",
      "<b>Eine Pattern-Datei wird nie ohne die Bank geschrieben, auf die sie zeigt.</b> Die Nummern sind das Einzige, was Pattern und Sample verbindet; passen sie nicht zusammen, lädt das Gerät trotzdem und spielt fremde Samples. Es gibt keinen Fehler — es klingt nur falsch, und man sucht die Ursache im Pattern. Deshalb liefert jeder Set-Weg ein fertiges Paar, statt das Zusammenstellen dem Nutzer zu überlassen.",
      "<b>Was das Gerät nicht laden kann, wird nicht geschrieben.</b> Passt eine Bank nicht ins ~24-MB-Sample-RAM, bleibt auch die Pattern-Datei aus, und es steht da, wie viele Megabyte es waren. Ein halbes Set auf der Karte wäre eine Fehlersuche für später.",
      "Die USB-Übertragung nennt vorher die Slots, die überschrieben werden, und hinterher die Sample-Nummern, die die Patterns erwarten — über MIDI gehen nur Patterns, die Bank muss am Gerät geladen sein.",
      "Die Einträge liegen als je eine Datei im Anwendungsordner: einen neuen anzulegen schreibt keine Megabyte neu, und ein beschädigter Eintrag reißt nicht die ganze Bibliothek mit.",
    ],
    bild: [
      "pattern-bibliothek",
      "Drei abgelegte Patterns aus einem HARDTEKK-Set, je 16 Samples; zwei sind markiert, und die vier Wege aufs Gerät stehen darunter mit der Anzahl im Knopf.",
    ],
  },
  {
    nr: "10",
    titel: "Start-Übersicht & Assistent",
    lead: "Der Einstieg: Status auf einen Blick und ein Assistent für Rückfragen.",
    punkte: [
      "Kacheln für Patterns im Projekt, Samples im Pool, belegtes Sample-RAM und den MIDI-Status.",
      "Zuletzt geöffnete Dateien und Schnellzugriff in alle Module.",
      "<b>Assistent</b> — beantwortet Fragen zu TekkForge und zur Electribe, kennt die Module und die Geräte-Grenzen.",
    ],
    bild: ["start", "Das Start-Dashboard mit Statuskacheln, letzten Dateien und dem Assistenten."],
  },
  {
    nr: "11",
    titel: "Einstellungen",
    lead: "Aussehen, Sicherheit, Aktualität.",
    punkte: [
      "Sechs Farbthemen plus frei wählbare Akzentfarbe — Aufbau und Bedienung bleiben gleich.",
      "<b>Auto-Backup</b> — beim Überschreiben landet der alte Stand in <code>backups/</code>, 20 Stände je Datei, mit Wiederherstellen-Knopf.",
      "<b>Schutz vor Abstürzen</b> — der Arbeitsstand wird still im Hintergrund beiseitegelegt, auch wenn noch nie gespeichert wurde. Kommt es zum Absturz oder fällt der Strom aus, bietet der nächste Start den letzten Stand mit Uhrzeit zum Zurückholen an. Wer regulär speichert, sieht davon nie etwas — die Sicherung räumt sich dann selbst weg. Verloren gehen kann höchstens die letzte Minute; ein Ersatz fürs Speichern ist sie ausdrücklich nicht.",
      "Update-Prüfung gegen die Veröffentlichungen auf GitHub — inklusive Download des passenden Installers, den man selbst startet.",
    ],
    bild: ["einstellungen", "Themenauswahl, Backup-Manager und Update-Prüfung."],
    extra: `<div style="margin-top:10px">${img("notfall", "Nach einem Absturz: Das Angebot steht über allen Modulen, damit es nicht übersehen wird — mit Uhrzeit des Standes und der Wahl zwischen Laden und Verwerfen.")}</div>`,
  },
];

/** Seiten zu Firmware, Speicherzugriff und Effekten — der technische Kern. */
const firmwareSeiten = `
<section class="seite">
  <span class="nr">12</span>
  <h2>Zwei Firmware-Welten</h2>
  <p class="lead">Die Electribe 2 gibt es mit der Firmware ab Werk und mit <b>Hacktribe</b> — einer von der Szene erweiterten Fassung, die dem Gerät Funktionen beibringt, die KORG nie vorgesehen hat. TekkForge spricht mit beiden und richtet sich selbst danach aus.</p>
  <table>
    <thead><tr><th>Funktion</th><th>Ab Werk</th><th>Hacktribe</th></tr></thead>
    <tbody>
      <tr><td>Patterns senden und holen, Grundeinstellungen lesen</td><td class="ja">ja</td><td class="ja">ja</td></tr>
      <tr><td>Regler in beide Richtungen, Pattern-Wechsel, Transport</td><td class="ja">ja</td><td class="ja">ja</td></tr>
      <tr><td>Parts live stummschalten</td><td class="halb">über eine Übertragung, rund eine Sekunde</td><td class="halb">Weg gebaut, am Gerät noch offen</td></tr>
      <tr><td>Effekt-Parameter live verändern, während das Gerät spielt</td><td class="nein">nicht möglich</td><td class="ja">ja</td></tr>
      <tr><td>Effekt-Presets und Groove-Vorlagen selbst bauen</td><td class="nein">nicht möglich</td><td class="ja">ja</td></tr>
      <tr><td>Direkter Zugriff auf den Arbeitsspeicher des Geräts</td><td class="nein">nicht möglich</td><td class="ja">ja</td></tr>
      <tr><td>Gerät meldet jeden Knopfdruck zurück</td><td class="nein">nicht möglich</td><td class="ja">ja — am Gerät bestätigt</td></tr>
    </tbody>
  </table>
  <p>Welche Fassung läuft, muss niemand raten: Ein Knopf schickt eine harmlose Vier-Byte-Leseanfrage. Kommt eine Antwort, ist es Hacktribe; bleibt es still, die Werksfirmware. Funktionen, die nur Hacktribe kann, sind ab Werk gar nicht erst sichtbar — statt eines Knopfes, der nichts tut, steht dort der Grund.</p>
  <div class="hinweis"><b>Ehrlich bleiben, wo es unsicher ist:</b> Ein von einem anderen Programm belegter MIDI-Anschluss sieht genauso aus wie eine Werksfirmware — das Gerät antwortet in beiden Fällen nicht. Der Statustext sagt das dazu, statt eine falsche Sicherheit vorzuspiegeln.</div>
</section>

<section class="seite">
  <span class="nr">13</span>
  <h2>Effekte — was Hacktribe möglich macht</h2>
  <p class="lead">Ab Werk stellt man einen Effekt am Gerät ein und dreht ihn dort von Hand. Mit Hacktribe wird er zum fernsteuerbaren Baustein.</p>
  <ul>
    <li><b>Live an den Reglern</b> — einzelne Effekt-Parameter lassen sich verändern, während der Sequencer läuft. Am Gerät nachgewiesen an einem Decimator: Bit-Tiefe und Abtastrate von außen verändert, die Klangänderung war hörbar und dreimal hintereinander reproduzierbar.</li>
    <li><b>Effekte beim Namen nennen</b> — TekkForge kennt <b>21 Insert-Algorithmen</b> (Kompressoren, Filter, Verzerrer, Chorus, Flanger, Phaser, Ring-Modulator, Decimator, kurzes Delay …) und <b>26 Master-Algorithmen</b> (Hall- und Plattenhall-Varianten, Bandecho, Grain Shifter, Vinyl Break, Looper …) samt ihren Parameternamen. Im Part-Fenster steht damit „Bit-Tiefe“ statt „Parameter 2“.</li>
    <li><b>Presets im Speicher</b> — 100 Insert- und 32 Master-Presets liegen als Blöcke im Arbeitsspeicher und lassen sich auslesen, sichern und zurückschreiben. Auch die Namen, die das Gerätemenü zeigt, stehen dort.</li>
    <li><b>Live per Controller</b> — 24 Regler eines angeschlossenen Controllers verstellen die Parameter des gewählten Effekts direkt, während der Sequencer läuft.</li>
  </ul>
  <div class="hinweis"><b>Eine Falle, die im Werkzeug dokumentiert ist:</b> Der Zwischenspeicher der Effekte zeigt <i>nicht</i> den laufenden Stand, sondern den beim Laden des Patterns — auch ein Reglerdreh am Gerät selbst ändert dort kein Byte. Wer ihn als Gegenprobe nimmt, hält einen funktionierenden Sendeweg für kaputt. Genau dieser Irrtum hat uns mehrere Messreihen gekostet und steht deshalb als Warnung im Code.</div>
</section>

<section class="seite">
  <span class="nr">14</span>
  <h2>Eigene Effekte und Grooves bauen</h2>
  <p class="lead">Was am Gerät nur auswählbar ist, lässt sich hier entwerfen: ein Effekt-Preset mit eigenem Namen, eigenen Algorithmen und eigener Belegung der Bedienelemente — und ein eigenes Timing-Gefühl.</p>
  <h3 class="unter-h">Effekt-Presets</h3>
  <p>Am Gerät wählt man im Menü einen Namen wie „Bit Crusher“. Dahinter steckt eine ganze Kette: bis zu zwei Insert-Effekte plus Master-Effekt, jeweils mit Algorithmus, Ein- und Ausgangspegel und Parameterwerten, dazu zehn Zuordnungen für die X/Y-Fläche und den FX-Knopf — jede mit Ziel-Parameter und eigenem Wertebereich.</p>
  <ul>
    <li>Platz vom Gerät lesen, Name und Algorithmen einstellen, Parameter mit ihren <b>echten Namen</b> verstellen — „Bit-Tiefe“ statt „Parameter 2“.</li>
    <li>Der zweite Insert-Effekt sperrt sich mit Begründung, wenn der erste ihn nicht zulässt — eine Regel des Geräts, die sonst still ins Leere liefe.</li>
    <li>Presets als Datei sichern und weitergeben; die Dateien des Hacktribe-Editors lassen sich direkt laden.</li>
  </ul>
  ${img("fx-preset", "Ein echtes Fremd-Preset im Editor: „Tube Drive“, Master-Effekt Tube Pre mit allen zwölf benannten Parametern, alle zehn Zuordnungen belegt.")}
  <div class="hinweis"><b>Ohne Gerät belegt:</b> Zehn echte Preset-Dateien aus dem Hacktribe-Projekt werden korrekt gelesen — Namen, Algorithmen und Werte passen — und byte-genau zurückgeschrieben. Das Format stimmt also, bevor die Electribe überhaupt angeschlossen ist.</div>
</section>

<section class="seite">
  <span class="nr">15</span>
  <h2>216 fertige Effekt-Presets zum Ausprobieren</h2>
  <p class="lead">Man muss nicht bei null anfangen: TekkForge bringt sechs fertig eingestellte Preset-Sets mit — drei für die Effekte einzelner Parts, drei für den Gesamtklang. Zusammen decken sie fast jeden Effekt-Algorithmus ab, den die Hacktribe-Firmware kennt. Die beiden neuesten Sets („Bewegung“ und „Tekk-Modulation“) bringen alles in den Takt — Ringmodulator, Tremolo, Slicer, Wobble-Filter, LFO-Bitcrusher — und stützen sich dabei auf die dekodierten Werks-Presets des Geräts statt auf Vermutungen.</p>
  <ul>
    <li><b>„Starter“</b> liefert das Tekk-Werkzeug — Zerre, Bitcrusher, Ringmodulator, Delay — und für die Summe Kompressor, EQ und Filter. <b>„Farben“</b> formt statt zu zerlegen, <b>„Raum &amp; Bewegung“</b> stellt den Mix in einen Raum.</li>
    <li>Zu jedem der 72 Grund-Presets gehören <b>zwei Abwandlungen</b>: derselbe Effekt, in genau eine Richtung verschoben. Nacheinander in denselben Platz geschrieben, hört man den Unterschied — und sonst nichts.</li>
    <li>Einige Paare sind zugleich <b>Messfühler</b>: Sie unterscheiden sich bewusst in einem einzigen Wert und beantworten am Ohr Fragen, die in keiner Unterlage stehen. Inzwischen sind sie gehört — bestätigt ist etwa der Neutralwert der Klangregler, und dass die Reihenfolge zweier Effekte deutlich hörbar ist.</li>
    <li>Geladen wird einzeln oder als <b>Sammlung</b> — und die lässt sich am Stück <b>verteilen</b>: je Eintrag ein Ziel-Platz (gezählt wie am Gerät, ab 1), ein Klick schreibt alle nacheinander, mit Prüfung nach jedem Schritt und einem Knopf, der alles wieder zurücknimmt. Die Platz-Zuweisung wird in der Sammlungs-Datei mitgespeichert.</li>
    <li>Die Plätze muss niemand einzeln tippen: Startplatz eintragen, <b>▲ aufsteigend</b> oder <b>▼ absteigend</b> drücken — die Reihe wird in Listenfolge vergeben, je Effektart getrennt, ohne hinter der Grenze wieder bei 1 anzufangen.</li>
    <li><b>Preset-Manager: die ganze Bank als Liste.</b> Alle 96 Insert- und 32 Master-Plätze sowie die 96 Groove-Vorlagen mit Name und Algorithmus bzw. Länge, geladen vom Gerät, aus einer Sicherung oder aus einer Firmware-Datei. Verschieben, tauschen, umbenennen, löschen, im Editor ändern, Dateien einfügen — geänderte Zeilen sind markiert, und geschrieben wird nur, was sich gegen den geladenen Stand unterscheidet: <b>flüchtig</b> ins Gerät zum Hören, oder <b>dauerhaft</b> in die Hacktribe-Firmware eingebrannt. Die Firmware ist ein 1:1-Abbild des Gerätespeichers hinter einem kleinen Header; TekkForge schreibt die Presets an dieselben Stellen, an denen sie im Gerät liegen, und prüft, dass sonst kein Byte kippt. <b>Am Gerät bestätigt:</b> die erste so gebaute Firmware mit den Plätzen 50 bis 96 wurde installiert, die neuen Presets stehen im Menü. Daneben eine <b>Bibliothek</b>: Presets und Sammlungen laden und per Ziehen auf einen Platz legen — leere Plätze nehmen sie einfach an, bei belegten fragt TekkForge, ob ersetzen, davor oder danach einfügen.</li>
    <li><b>Leere Plätze werden sichtbar.</b> Das Gerätemenü zeigt nur so viele Insert-Presets, wie 13 Zähler der Firmware erlauben (auf dem Testgerät 49; die Plätze 50–100 sind da, aber leer und unsichtbar). Ein Haken zieht die Zähler nach dem Verteilen bis zum höchsten Platz nach — derselbe Weg, den der Hacktribe-Editor geht, nur mit Netz: alle 13 werden vorher gelesen und auf Stimmigkeit geprüft, der neue Bereich auf Lücken, und bricht ein Schreibvorgang ab, werden die schon gesetzten sofort zurückgenommen. Gilt bis zum Ausschalten; Master-Presets lassen sich so nicht erweitern, dort sind alle 32 Plätze belegt.</li>
  </ul>
  ${img("fx-sammlung", "Das Set „Bewegung“ als Sammlung geladen und mit einem Klick ab Platz 50 durchnummeriert — Plätze, die das Gerätemenü bisher gar nicht zeigt. Der Haken darunter zieht nach dem Schreiben die Zähler nach, damit es sie zeigt.")}
  ${img("preset-manager", "Der Preset-Manager mit dem Stand einer Gerätesicherung: die 49 Werks-Presets, dahinter die leeren Plätze; je Zeile die Knöpfe zum Verschieben, Tauschen, Umbenennen, Bearbeiten und Löschen. Unten die beiden Schreibwege — flüchtig ins Gerät oder dauerhaft in die Firmware.")}
  <p>Dazu kommen <b>18 Tekk-Groove-Vorlagen</b>: gerade Grundbetonung, Push und Drag, Swing in zwei Stärken, Hat-Ghosts, Kick-Punch, Gate-Chop, Stomp, Rampen — und zwei mehrtaktige mit eingebautem Fill und Bruch. Die Werte sind an den 62 Werksvorlagen der Firmware kalibriert.</p>
  <h3 class="unter-h">Firmware-Werkbank — mehr als Presets</h3>
  <p>Die Firmware trägt außer den Presets noch vier Dinge, die sich austauschen lassen — darunter der Global-Block mit den Werks-Voreinstellungen (MIDI-Kanal, Clock, Chain Mode), gefunden direkt vor dem Init-Pattern —, allen voran: die <b>Groove-Vorlagen</b> (mit eigenen Zählern, wie die Presets), das <b>Init-Pattern</b> — der Block, den das Gerät für jedes neue Pattern nimmt, also Tempo, Länge, Part-Einstellungen und Motion, wie man sie im Editor eingestellt hat — und den <b>Startbildschirm</b>, 128 × 64 Pixel beim Einschalten. Die Werkbank lädt eine Basis, prüft ihre Struktur (auch eine frühere TekkForge-Fassung taugt, die nächste Runde baut darauf auf), und brennt ein, was angehakt ist. Für den Startbildschirm gibt es einen Pixel-Editor: malen mit der Maus, ein Bild einpassen und nach Helligkeit schwellen, das Logo aus der Basis holen — oder ein Wort in der eingebauten Pixelschrift schreiben, zentriert, in drei Punktgrößen. Die Bit-Belegung des Bildes ist am Original-Decoder bewiesen — das Hacktribe-Logo geht byte-genau hin und zurück —, und der erste eigene Schriftzug ist am Gerät angekommen: Er kam invertiert, was zeigte, dass das Gerät Bits umgekehrt liest als der Decoder; seitdem zeigt der Editor genau das, was das Gerät zeigt. Und wer sich am Gerät im Arbeitsspeicher etwas zusammengebaut und gehört hat, brennt es in einem Schritt ein: die Komplettsicherung erfasst jetzt auch Zähler, Init-Pattern und Startbild, und die Werkbank legt eine solche Sicherung als Ganzes in die Basis. Zwei Firmwares lassen sich außerdem nebeneinanderhalten: welche Plätze, Zähler, Init-Pattern und Startbild sich unterscheiden, und was außerhalb der bekannten Bereiche liegt — nach jedem Bau steht diese Gegenprobe automatisch im Bericht. Und der ganze Umbau lässt sich als <b>Bauplan</b> sichern: eine kleine Datei mit Presets, Grooves, Init-Pattern, Startbild und Werks-Global, die sich auf die nächste Hacktribe-Fassung legen oder weitergeben lässt.</p>
  ${img("firmware-werkbank", "Die Firmware-Werkbank: Basis geladen, Bausteine als Haken, rechts der Pixel-Editor mit dem Startbild aus der Hacktribe-Firmware.")}
  <h3 class="unter-h">Bis an den Klang selbst — und wo die Grenze liegt</h3>
  <p>Die Klangerzeugung läuft auf einem eigenen Signalprozessor, und dessen Programm steckt ebenfalls in der Firmware-Datei: 157 Blöcke ohne Prüfsumme über die Nutzdaten. Das Schwesterprojekt Omnitribe hat am Gerät gezeigt, dass gleichlange Änderungen darin flashbar und hörbar sind. TekkForge liest diese Blockkette, prüft jeden Kopf und wendet solche Patches an — nur gleiche Länge, nur innerhalb eines Datenblocks, nie ein Kopf, und danach wird die ganze Kette noch einmal geprüft. Elf bekannte Patches stehen als Register in der Werkbank: eine Wellentabelle, zwei Kurven im Sample-Pfad, eine Konstante. Jeder trägt seinen ehrlichen Stand — und der heißt bei allen noch <b>Hörprobe offen</b>. Genauso ehrlich die Grenze: Die Werks-Samples liegen nicht in der Firmware, sondern im Sample-Speicher, und dafür gibt es keinen Schreibweg; Filter oder Modulation lassen sich über diese Tabellen verbiegen, aber nicht neu bauen.</p>
  ${img("firmware-dsp", "Der DSP-Abschnitt der Werkbank: das Register mit Umfang und Stand je Patch — und dem Hinweis, wenn ein Patch nicht zur geladenen Basis passt.")}
  <h3 class="unter-h">Die Sample-Liste ist eine Tabelle</h3>
  <p>Was das Gerät unter Sample 001 bis 274 zeigt — SAW, PULSE, die Noise-Modelle, dann über hundert FM- und VPM-Varianten —, sind keine Aufnahmen, sondern Einträge einer Tabelle in der Firmware: ein Name, ein Klangprogramm des Signalprozessors und ein paar Parameter. Die Serienfirmware führt in derselben Tabelle die Namen ihrer Werks-Samples; Hacktribe hat sie durch seine Varianten ersetzt und 147 Plätze frei gelassen. Zwei Zellen im Code sagen dem Gerät, wie lang die Liste ist — derselbe Mechanismus wie beim Effekt-Menü, das TekkForge schon am Gerät verlängert hat. Die Werkbank hängt deshalb eigene Varianten an: eine Vorlage wählen, Name, Verstimmung oder Ratio und Pegel setzen, anhängen — oder für ein FM-Modell gleich die ganze Reihe der Halbtöne, die Hacktribe ausgelassen hat. Zum Probieren ohne Flashen geht das flüchtig in den Arbeitsspeicher des Geräts; erst wenn die Liste dort die neuen Plätze zeigt, wird gebrannt.</p>
  <div class="hinweis"><b>Nebenbei repariert:</b> Der Weg von der Datei aufs Gerät war bisher versperrt — die Pflicht-Lesung des Ziel-Platzes warf das geladene Preset wieder aus dem Editor. Jetzt bleibt es stehen, und die Lesung holt nur noch das, wofür sie da ist: den Vorher-Stand für den Rückweg. Jede der 216 Dateien wird zudem automatisch geprüft — Größe, Algorithmus, und dass jede Regler-Zuordnung auf einen Parameter zeigt, den es wirklich gibt.</div>
</section>

<section class="seite">
  <span class="nr">16</span>
  <h2>Groove-Vorlagen — eigener Swing</h2>
  <p class="lead">Eine Groove-Vorlage legt für jeden Step drei Dinge fest: den Zeitversatz, die Anschlagstärke und die Tonlänge. Genau daraus entsteht das Timing-Gefühl.</p>
  <ul>
    <li><b>96 Vorlagen</b> liegen im Gerät; jede lässt sich lesen, ändern und zurückschreiben.</li>
    <li><b>Swing auf Knopfdruck</b> — jeder zweite Step wandert um den eingestellten Betrag nach hinten. Ein halber Step ist der Maximalwert.</li>
    <li><b>Eigene Länge</b> — steht sie auf 13 statt 64, läuft das Muster gegen den Takt und ergibt schiefe, wandernde Grooves.</li>
    <li>Auch hier: als Datei sichern und weitergeben — oder mehrere Presets und Vorlagen zu einer <b>Sammlung</b> bündeln, die sich als ein Paket verschicken lässt.</li>
  </ul>
  <h3 class="unter-h">Groove aus einem Lied</h3>
  <p>Der interessanteste Weg zu einer eigenen Vorlage führt über ein Vorbild: Ein Stück klingt nicht deshalb lebendig, weil die Schläge genau auf dem Raster liegen, sondern weil sie <b>daneben</b> liegen — mal früher, mal später, mit wechselnder Anschlagstärke. TekkForge misst genau das. Lied hineingeben, Tempo und Anschläge werden bestimmt, ein Raster darübergelegt, und für jeden Schritt festgehalten, wie weit der Schlag danebenliegt. Über alle Takte gemittelt, damit ein einzelner Ausreißer nicht die ganze Vorlage verbiegt.</p>
  <p>Das Ergebnis ist eine Vorlage, die dein eigenes Pattern im Timing-Gefühl des Vorbilds laufen lässt.</p>
  ${img("groove-aus-lied", "Aus einem echten Track gemessen: 105 BPM, alle 64 Schritte belegt, 19 davon spürbar versetzt — kleine Abweichungen von wenigen Einheiten, dazu leicht schwankende Anschlagstärke.")}
  <div class="hinweis"><b>Vorsicht, wo Quellen sich widersprechen:</b> Zwei Beschreibungen des Formats nennen unterschiedliche Stellen für die Step-Tabelle. TekkForge folgt der Fassung des Hacktribe-Autors und prüft beim Lesen zusätzlich ein Muster, das nur an der richtigen Stelle auftritt. Passt es nicht, verweigert der Schreibknopf — lieber nichts schreiben als zwölf Byte daneben.</div>
</section>

<section class="seite">
  <span class="nr">17</span>
  <h2>Geräte-Spiegel und Werkbank</h2>
  <p class="lead">Hacktribe meldet jeden Griff am Gerät zurück: welcher Modus aktiv ist, welches Bedienelement bewegt wurde, wohin. TekkForge zeigt diesen Strom in Klartext.</p>
  <ul>
    <li>Jede Meldung erscheint als Zeile mit Kanal, Modus, Bedienelement und Zustand — vom Shift-Knopf bis zum Encoder, der „eins hoch“ meldet.</li>
    <li>Der Kanal verrät nebenbei, welcher Part am Gerät gerade gewählt ist.</li>
    <li>Unbekannte Kennungen werden als unbekannt ausgewiesen, statt einen Namen zu erfinden.</li>
  </ul>
  <h3 class="unter-h">Werkbank für das Undokumentierte</h3>
  <p>Manches kann das Gerät, ohne dass jemand aufgeschrieben hat, wie: Es gibt versteckte Einstellungen, die nur über MIDI erreichbar sind und im Menü gar nicht auftauchen. Veröffentlicht ist nur eine davon. Die Werkbank schickt deshalb <b>beliebige</b> Nachrichten — und der Spiegel daneben zeigt sofort, ob etwas passiert ist. Zusammen ergibt das eine Suchschleife für alles, was noch fehlt.</p>
  ${img("nrpn-spiegel", "Der Spiegel in Aktion: Shift im Keyboard-Modus gedrückt und losgelassen, IFX-On auf Kanal 1, ein Encoder-Schritt — jeweils mit Kanal, Modus und Bedienelement.")}
</section>

<section class="seite">
  <span class="nr">18</span>
  <h2>Zugriff auf den Arbeitsspeicher</h2>
  <p class="lead">Hacktribe erlaubt, direkt in den Speicher des laufenden Geräts zu schauen und zu schreiben. Das ist mächtig und heikel zugleich — deshalb ist der Weg dorthin bewusst umständlich gebaut.</p>
  <h3 class="unter-h">Was heute erreichbar ist</h3>
  <table>
    <thead><tr><th>Bereich</th><th>Umfang</th><th>Stand</th></tr></thead>
    <tbody>
      <tr><td>Insert-Effekt-Presets</td><td>100 Plätze à 524 Byte, mit Namen</td><td class="ja">lesen und schreiben</td></tr>
      <tr><td>Master-Effekt-Presets</td><td>32 Plätze à 524 Byte</td><td class="ja">lesen und schreiben</td></tr>
      <tr><td>Groove-Vorlagen</td><td>96 Vorlagen à 320 Byte</td><td class="ja">lesen und schreiben</td></tr>
      <tr><td>Effekt-Zwischenspeicher</td><td>Stand beim Pattern-Laden</td><td class="halb">nur lesen, nicht live</td></tr>
      <tr><td>Belegungszähler der Insert-Presets</td><td>13 Bytes (Menü + gespeicherte Parameter)</td><td class="ja">lesen und geschlossen nachziehen — am Gerät noch nicht abgenommen</td></tr>
    </tbody>
  </table>
  <h3 class="unter-h">Komplettsicherung</h3>
  <p>Alles Lesbare am Stück auslesen und als Datei ablegen — Effekt-Presets, Groove-Vorlagen, Zähler; rund 100 kB. Umgekehrt lässt sich das Gerät gegen eine ältere Sicherung halten: TekkForge nennt dann genau die Bereiche, die sich seither geändert haben, mit Byte-Zahl und erster Fundstelle. Bricht die Lesung unterwegs ab, entsteht bewusst <b>keine</b> Datei — eine lückenhafte Sicherung wäre schlimmer als gar keine.</p>
  <h3 class="unter-h">Die Sicherungen</h3>
  <ul>
    <li><b>Nur der Arbeitsspeicher, niemals der Flash.</b> Für die Flash-Befehle gibt es absichtlich keinen Bauplan im Werkzeug: Ein Fehler im Arbeitsspeicher ist nach dem Aus- und Einschalten weg, ein Fehler im Flash bleibt für immer.</li>
    <li><b>Ohne Vorher-Lesung kein Schreiben.</b> Wer keinen Schnappschuss hat, hat keinen Rückweg — das ist ein harter Abbruch, keine wegklickbare Warnung.</li>
    <li><b>Zwei Klicks statt einem.</b> Der erste prüft und sagt, wie viele Bytes sich ändern würden; erst der zweite sendet.</li>
    <li><b>Jeder Schreibvorgang wird zurückgelesen und verglichen.</b> Ein Schreibvorgang ohne Gegenprobe ist einer, von dem man nichts weiß.</li>
    <li><b>Ein Rückweg bleibt stehen.</b> Der Knopf zum Wiederherstellen trägt seine Zieladresse im Text und verschwindet nicht, wenn man daneben etwas verstellt.</li>
  </ul>
  <div class="hinweis"><b>Am Gerät nachgewiesen:</b> Ein Preset-Name wurde gezielt verändert („LP Drive“ → „MP Drive“), zurückgelesen, verglichen und wieder hergestellt — 524 Byte, unverändert identisch. Die vorherigen Fehlschläge hatten alle dieselbe Ursache: eine Bestätigung des Geräts, die nicht abgeholt wurde, ließ einen wirkungslosen Schreibvorgang wie einen erfolgreichen aussehen.</div>
</section>

<section class="seite">
  <span class="nr">19</span>
  <h2>Was über den Speicherzugriff noch möglich wird</h2>
  <p class="lead">Effekt-Presets und Groove-Vorlagen sind inzwischen gebaut. Was bleibt, ist nicht der Zugang, sondern das Wissen, welches Byte welche Bedeutung hat.</p>
  <div class="karten">
    <div class="karte"><h3>Die versteckten Schalter finden</h3><p>Drei Einstellungen gibt es nur über MIDI. Der Schalter, der das Gerät überhaupt erst zurückmelden lässt, ist gefunden und am Gerät belegt; mit Werkbank und Spiegel lassen sich die übrigen mit demselben Verfahren suchen.</p></div>
    <div class="karte"><h3>Regler-Bewegungen schreiben</h3><p>Aufgezeichnete Bewegungen werden heute nur gelesen. Sie auch setzen zu können, würde Arrangements in Bewegung bringen.</p></div>
    <div class="karte"><h3>Sequenz-Steps von außen</h3><p>Das Gerät nimmt inzwischen auch Befehle für einzelne Schritte entgegen. Was die Kennziffern bedeuten, steht nirgends — genau dafür ist die Werkbank da.</p></div>
    <div class="karte"><h3>Preset-Sammlungen</h3><p>Gebaut: 216 fertige Presets in sechs Sets. Die ersten vier sind am Gerät gehört; offen sind die beiden Takt-Sets und die Menü-Erweiterung für leere Plätze — die Messfühler-Paare darin beantworten dann, welche Zahl welche LFO-Wellenform ist.</p></div>
    <div class="karte"><h3>Vergleichen statt raten</h3><p>Zwei Auslesungen gegeneinanderhalten und die Unterschiede benennen — so lassen sich unbekannte Bytes Stück für Stück entschlüsseln.</p></div>
  </div>
  <div class="hinweis"><b>Bewusst nicht geplant:</b> Presets so anzulegen, dass sie im Gerätemenü als neue Einträge auftauchen. Dafür müssten dreizehn verstreute Zähler gleichzeitig stimmen; ein halb hochgezählter Satz hinterlässt eine Firmware in sich widersprüchlich. Diesen Weg soll weiterhin Hacktribes eigenes Werkzeug gehen.</div>
</section>`;

const roadmap = [
  {
    titel: "Abnahme am Gerät",
    wann: "als Nächstes",
    text: "Die neuen Funktionen sind am Bildschirm belegt, aber das Ohr entscheidet: kickt der Drop hörbar härter als der Aufbau, ergibt die Vocal-Reihenfolge das ganze Lied — und halten die mitgelieferten Effekt-Sammlungen, was ihre Namen versprechen?",
  },
  {
    titel: "Die versteckten Schalter aufspüren",
    wann: "einer gefunden",
    text: "Drei Einstellungen sind nur über MIDI erreichbar. Der wichtigste ist gefunden und am Gerät belegt: mit ihm meldet die Electribe jede Reglerbewegung als gewöhnlichen Controller-Wert zurück, ohne ihn bleibt sie stumm — sauber im Vergleich gemessen, einmal mit und einmal ohne. Genau daran hing der Geräte-Spiegel. Die beiden übrigen Schalter lassen sich mit derselben Suchschleife finden.",
  },
  {
    titel: "Vocals sparsamer speichern",
    wann: "gebaut, ungeprüft",
    text: "Ein vocal-lastiges Lied bringt schnell 30 Segmente mit — mehr, als die ~24 MB Sample-RAM auf einmal fassen. Ideen: Vocals mit halber Abtastrate ablegen (doppelte Abdeckung) oder klanglich ähnliche Abschnitte zusammenfassen.",
  },
  {
    titel: "Klangprobe vor dem Schreiben",
    wann: "gebaut",
    text: "Im Sample-Editor stehen Original und Geräte-Fassung nebeneinander: ein Kanal, 16 Bit, Tempoanpassung. Offen bleibt nur, was ohne Gerät nicht zu klären ist — ob die Electribe eine gespeicherte Rate unter 44,1 kHz beachtet. Beide Fälle lassen sich anhören, damit die Antwort am Klang sofort erkennbar ist."
  },
  {
    titel: "Transkription verfeinern",
    wann: "geplant",
    text: "Bis zu vier Töne je Step stehen. Als Nächstes: erkannte Stimmen automatisch auf mehrere Parts verteilen und Anschläge sauberer von gehaltenen Tönen trennen.",
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
    wann: "halb fertig",
    text: "Neue Veröffentlichungen werden gemeldet und der passende Installer lässt sich mit einem Klick herunterladen — er landet im Download-Ordner und wird dort angezeigt. Starten muss man ihn selbst: ein Werkzeug, das sich unbeaufsichtigt selbst austauscht, ist genau die Art Automatik, die man nicht will. Offen bleibt, die alte Fassung dabei sauber abzulösen.",
  },
];

const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>TekkForge ${VERSION} — Funktionen und Ausblick</title>
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

  /* Tabellen */
  table { width: 100%; border-collapse: collapse; margin: 4px 0 16px; font-size: 9.5pt; break-inside: avoid; }
  th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: 1px; color: #8a8aa0;
       border-bottom: 1px solid #2c2c38; padding: 0 8px 6px; }
  td { padding: 7px 8px; border-bottom: 1px solid #1e1e28; vertical-align: top; }
  td.ja { color: #5ed49a; font-weight: 600; }
  td.nein { color: #74748a; }
  td.halb { color: #ffb15e; }
  th:not(:first-child), td:not(:first-child) { width: 26%; }
  h3.unter-h { font-size: 12pt; margin: 18px 0 6px; color: #fff; }
  p { margin: 0 0 12px; }

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
  <h1>Tekk<span>Forge</span> ${VERSION}</h1>
  <p class="unter">Ein Werkzeugkasten für den KORG Electribe 2 Sampler: aus einem Lied wird ein spielbares Pattern-Set — Sample-Bank, Arrangement und Gerätesteuerung in einer Anwendung. Alles läuft lokal, keine Datei verlässt den Rechner.</p>
  <div class="kennz">
    <div><b>9</b><span>Module in einer App</span></div>
    <div><b>250</b><span>Pattern-Slots je Bank</span></div>
    <div><b>~24 MB</b><span>Sample-RAM im Blick</span></div>
    <div><b>2565</b><span>automatische Tests</span></div>
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
  ${img("start", "Der Start-Bildschirm: Statuskacheln, zuletzt geöffnete Dateien, Schnellzugriff und der eingebaute Assistent.")}
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
  ${a.extra ?? ""}
</section>`,
  )
  .join("\n")}

${firmwareSeiten}

<section class="seite">
  <span class="nr">20 · AUSBLICK</span>
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
  <span class="nr">21 · TECHNIK</span>
  <h2>Grundlagen in Kürze</h2>
  <p class="lead">Was unter der Oberfläche gilt — die Regeln, an denen sich alles ausrichtet.</p>
  <div class="karten">
    <div class="karte"><h3>Am Gerät nachgemessen</h3><p>Schrittraster, Ketten, Effekt- und Part-Einstellungen sind gegen echte Werksdateien und Testpatterns auf der Hardware abgeglichen.</p></div>
    <div class="karte"><h3>Alles einkanalig</h3><p>Die Electribe legt ein einkanaliges Sample auf einen Part, ein zweikanaliges auf zwei. Jedes erzeugte Sample ist deshalb einkanalig — das spart Parts und Speicher.</p></div>
    <div class="karte"><h3>Zwei Firmware-Welten</h3><p>Serien-Firmware und die erweiterte Hacktribe-Fassung werden erkannt; heikle Zusatzfunktionen bleiben gesperrt, solange sie nicht sicher verfügbar sind.</p></div>
    <div class="karte"><h3>Nichts verlässt den Rechner</h3><p>Analyse, Trennung und Erzeugung laufen lokal. Nur zwei Wege gehen nach außen — und nur, wenn man sie nutzt: der Link-Import und die optionale KI-Anfrage.</p></div>
    <div class="karte"><h3>Sicherheitsnetz</h3><p>Vor jedem Überschreiben wird der alte Stand gesichert; zwanzig Stände je Datei lassen sich zurückholen.</p></div>
    <div class="karte"><h3>Geprüft statt geglaubt</h3><p>2565 automatische Tests laufen bei jeder Änderung — darunter eine Einzelprüfung für jedes mitgelieferte Effekt-Preset — dazu Durchläufe in der echten Anwendung mit Bildnachweis.</p></div>
    <div class="karte"><h3>Herkunft offengelegt</h3><p>Ein Teil des Geräte-Wissens stammt aus dem freien Hacktribe-Projekt. Woher genau und unter welchen Bedingungen, steht im Projekt dokumentiert — samt einer Korrektur, als sich zeigte, dass die Lizenz eine strengere war als angenommen.</p></div>
  </div>
  <div class="hinweis"><b>Bezug:</b> Windows-Installer und tragbare Fassung liegen als Veröffentlichung ${VERSION} auf GitHub bereit. Für Stem-Trennung und Link-Import wird zusätzlich Python benötigt.</div>
  <div class="fuss"><span>TekkForge ${VERSION} — Funktionsübersicht und Ausblick</span><span>${heute}</span></div>
</section>

</body>
</html>`;

fs.writeFileSync(".tekkforge-shots/doc.html", html, "utf8");
console.log(`HTML: .tekkforge-shots/doc.html (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
