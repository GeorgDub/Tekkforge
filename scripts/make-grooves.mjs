/**
 * Erzeugt die Tekk-Groove-Vorlagen in `examples/grooves/` — je Vorlage eine
 * `.e2gv` (320-Byte-Block) und eine Sammlung, die alle auf einmal in die
 * Bibliothek des Preset-Managers laedt.
 *
 *   npx tsx scripts/make-grooves.mjs [zielordner]
 *
 * ## Was eine Groove-Vorlage tut
 *
 * Je Step drei Werte: Zeitversatz (−48..+48, ±48 = halber Step; negativ =
 * frueher), Anschlagstaerke (0..127) und Tonlaenge (0..96, 96 = ganz). Die
 * Vorlage wird einem Part zugewiesen und wiederholt sich mit ihrer Laenge.
 *
 * ## Woher die Zahlen kommen
 *
 * Aus den 62 Werksvorlagen der Hacktribe-Firmware (Sicherung vom 2026-09-01,
 * dekodiert): Grundanschlag liegt dort um 96, Akzente bei 120–127, Ghosts bei
 * 30–60; Versatz meist ±4..±22, „Rushbeat" schiebt alles um −44; Gate ist
 * fast immer 96, „Rushbeat" endet mit 48. Tekk ist gerade und treibend —
 * deshalb hier: wenig Versatz, klare Akzente auf den Vierteln, Ghosts auf den
 * Sechzehnteln, und ein paar Vorlagen, die den Puls bewusst kippen.
 *
 * Gehoert hat das hier noch niemand. Genau dafuer sind es Vorlagen mit Namen:
 * was am Geraet anders wirkt als der Name verspricht, wird korrigiert.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { encodeGroove, GROOVE_SIZE } from "../src/core/e2Groove.ts";
import { baueSammlung } from "../src/core/sammlung.ts";

const ZIEL = process.argv[2] ?? "examples/grooves";

/** Anschlagstufen — Namen statt Zahlen, damit die Tabelle lesbar bleibt. */
const V = { akzent: 127, stark: 118, normal: 96, leicht: 80, ghost: 48 };
/** Tonlaengen. */
const G = { ganz: 96, halb: 48, kurz: 24, punkt: 12 };

const istViertel = (i) => i % 4 === 0;
const istAchtel = (i) => i % 4 === 2;
const istSechzehntel = (i) => i % 2 === 1;

/**
 * Eine Vorlage aus einer Step-Funktion: `fn(i, takt)` liefert
 * { trigger?, velocity?, gate? } — Fehlendes bleibt gerade/normal/ganz.
 */
const vorlage = (datei, name, zweck, laenge, fn) => ({
  datei,
  name,
  zweck,
  laenge,
  steps: Array.from({ length: 64 }, (_, i) => {
    const s = i < laenge ? fn(i % 16, Math.floor(i / 16), i) : {};
    return { trigger: s.trigger ?? 0, velocity: s.velocity ?? V.normal, gate: s.gate ?? G.ganz };
  }),
});

/** Die Tekk-Grundbetonung: Viertel akzentuiert, Achtel stark, Sechzehntel normal. */
const betonung = (i) => (istViertel(i) ? V.akzent : istAchtel(i) ? V.stark : V.normal);

const GROOVES = [
  vorlage("01-tekk-straight", "Tekk Straight", "Gerade, Viertel akzentuiert, Achtel stark — die Grundvorlage.", 16, (i) => ({ velocity: betonung(i) })),
  vorlage("02-tekk-push", "Tekk Push", "Achtel-Offbeats um 10 nach vorn — treibt, ohne zu eiern.", 16, (i) => ({ trigger: istAchtel(i) ? -10 : 0, velocity: betonung(i) })),
  vorlage("03-tekk-drag", "Tekk Drag", "Achtel-Offbeats um 10 nach hinten — schwerer Schritt.", 16, (i) => ({ trigger: istAchtel(i) ? 10 : 0, velocity: betonung(i) })),
  vorlage("04-swing-8-light", "Swing 8 Light", "Leichter Achtel-Swing (+12), Sechzehntel leiser.", 16, (i) => ({ trigger: istAchtel(i) ? 12 : 0, velocity: istViertel(i) ? V.akzent : istAchtel(i) ? V.normal : V.leicht })),
  vorlage("05-swing-8-hard", "Swing 8 Hard", "Harter Achtel-Swing (+24), Sechzehntel leiser.", 16, (i) => ({ trigger: istAchtel(i) ? 24 : 0, velocity: istViertel(i) ? V.akzent : istAchtel(i) ? V.normal : V.leicht })),
  vorlage("06-swing-16", "Swing 16", "Jeder zweite Sechzehntel +10 und leiser — Hats bekommen Bewegung.", 16, (i) => ({ trigger: istSechzehntel(i) ? 10 : 0, velocity: istViertel(i) ? V.akzent : istSechzehntel(i) ? V.leicht : V.normal })),
  vorlage("07-shuffle-16", "Shuffle 16", "Sechzehntel +20 und deutlich leiser — der Shuffle.", 16, (i) => ({ trigger: istSechzehntel(i) ? 20 : 0, velocity: istViertel(i) ? V.akzent : istSechzehntel(i) ? 64 : V.normal })),
  vorlage("08-hat-ghost", "Hat Ghost", "Fuer Hats: Viertel laut, Achtel mittel, Sechzehntel als kurze Ghosts.", 16, (i) => ({ velocity: istViertel(i) ? V.akzent : istAchtel(i) ? 100 : V.ghost, gate: istSechzehntel(i) ? G.halb : G.ganz })),
  vorlage("09-kick-punch", "Kick Punch", "Fuer Kicks auf allen Sechzehnteln: Viertel voll, der Rest zurueck und kurz.", 16, (i) => ({ velocity: istViertel(i) ? (i === 0 ? V.akzent : V.stark) : 60, gate: istViertel(i) ? G.ganz : 40 })),
  vorlage("10-gate-chop", "Gate Chop", "Tonlaenge wechselt ganz/kurz — zerhackt lange Samples im Takt.", 16, (i) => ({ velocity: 100, gate: i % 2 === 0 ? G.ganz : G.kurz })),
  vorlage("11-stomp", "Stomp", "Viertel ganz und laut, alles andere sehr kurz — stampft.", 16, (i) => ({ velocity: istViertel(i) ? V.akzent : 90, gate: istViertel(i) ? G.ganz : 20 })),
  vorlage("12-ramp-up-4", "Ramp Up 4", "Anschlag steigt in jeder Vierergruppe: 70, 85, 100, 127.", 16, (i) => ({ velocity: [70, 85, 100, 127][i % 4] })),
  vorlage("13-ramp-down-4", "Ramp Down 4", "Anschlag faellt in jeder Vierergruppe: 127, 105, 85, 70.", 16, (i) => ({ velocity: [127, 105, 85, 70][i % 4] })),
  vorlage("14-rush", "Rush", "Alles ausser den Vierteln um 20 nach vorn — nervoes, wie das Werks-Rushbeat, nur mit festem Puls.", 16, (i) => ({ trigger: istViertel(i) ? 0 : -20, velocity: betonung(i) })),
  vorlage("15-laid-back", "Laid Back", "Alles ausser den Vierteln um 14 nach hinten — das Gegenteil von Rush.", 16, (i) => ({ trigger: istViertel(i) ? 0 : 14, velocity: betonung(i) })),
  vorlage("16-bounce", "Bounce", "Sechzehntel +8 und leise, Achtel mittel, Viertel voll — federt.", 16, (i) => ({ trigger: istSechzehntel(i) ? 8 : 0, velocity: istViertel(i) ? V.akzent : istAchtel(i) ? 100 : 60 })),
  vorlage(
    "17-hardtekk-64",
    "Hardtekk 64",
    "Vier Takte: drei gerade, im vierten steigt der Anschlag ueber die letzten vier Steps auf 127 und die Gates werden kurz — der eingebaute Fill.",
    64,
    (i, takt) => {
      if (takt === 3 && i >= 12) return { velocity: [100, 110, 120, 127][i - 12], gate: [G.ganz, G.halb, G.halb, G.kurz][i - 12] };
      return { velocity: betonung(i) };
    },
  ),
  vorlage(
    "18-breaker-32",
    "Breaker 32",
    "Zwei Takte: der erste gerade, im zweiten Achtel nach vorn (−12) und Sechzehntel als Ghosts — der Bruch alle zwei Takte.",
    32,
    (i, takt) => (takt === 0 ? { velocity: betonung(i) } : { trigger: istAchtel(i) ? -12 : 0, velocity: istViertel(i) ? V.akzent : istAchtel(i) ? V.stark : V.ghost }),
  ),
];

fs.mkdirSync(ZIEL, { recursive: true });
const eintraege = [];
for (const g of GROOVES) {
  if (g.name.length > 15) throw new Error(`Name "${g.name}" ist laenger als 15 Zeichen`);
  const bytes = encodeGroove({ name: g.name, laenge: g.laenge, steps: g.steps });
  if (bytes.length !== GROOVE_SIZE) throw new Error(`${g.name}: ${bytes.length} statt ${GROOVE_SIZE} Bytes`);
  const datei = path.join(ZIEL, `${g.datei}.e2gv`);
  fs.writeFileSync(datei, bytes);
  eintraege.push({ art: "groove", name: g.name, bytes });
  console.log(`${datei.padEnd(40)} „${g.name}" — ${g.laenge} Steps — ${g.zweck}`);
}
const sammlung = path.join(ZIEL, "TekkForge-Grooves-Tekk.tfsam");
fs.writeFileSync(sammlung, baueSammlung(eintraege, { titel: "TekkForge Grooves Tekk", autor: "TekkForge", wann: "2026-09-03T00:00:00.000Z" }));
console.log(`${sammlung.padEnd(40)} ${eintraege.length} Vorlagen in einer Datei.`);
