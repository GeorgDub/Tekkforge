/**
 * sampleScan — Rollen (kick/snare/clap/hat/perc/ton/bass/fx/vox/melo/track),
 * Familien (Namensstamm ohne Nummern), saubere 16-Zeichen-Namen und
 * Dubletten-Erkennung auf bereits dekodierten Mono-Puffern.
 * Port der Heuristik aus scripts/prep-folder.py (Stand 2026-08-22).
 *
 * Der Dateiname bleibt die erste Quelle — er traegt das, was der Nutzer selbst
 * ueber sein Material weiss, und das schlaegt jede Messung. Aber er traegt es
 * nur, wenn jemand ihn vergeben hat. Fuer alles andere — geschnittene Stems,
 * Downloads mit Nummern statt Namen, "audio_04.wav" — stand hier bisher eine
 * Verlegenheitsregel: kuerzer als 0,9 s und lauter als −8,5 dB ist eine Kick.
 * Nach der ist eine laute Hi-Hat eine Kick, ein Clap eine Kick und ein
 * abgehacktes Vocal auch. Seit v0.7 wird in diesem Fall stattdessen der KLANG
 * gelesen (`rolleAusKlang`): Bassanteil, Helligkeit und Scheitelfaktor sagen,
 * was da liegt, und zwar unabhaengig davon, wie die Datei heisst.
 */

import { klangAbstand, klangProfil, type Klangprofil } from "./klangProfil";

export type Rolle = "kick" | "snare" | "clap" | "hat" | "perc" | "ton" | "bass" | "fx" | "vox" | "melo" | "track";

export interface ScanEingabe {
  name: string;
  /** mono, [-1, 1] */
  pcm: Float32Array;
  sampleRate: number;
}

export interface ScanEintrag {
  datei: string;
  stem: string;
  rolle: Rolle;
  familie: string;
  sekunden: number;
  rmsDb: number;
  peak: number;
  pcm: Float32Array;
  sampleRate: number;
  hinweis?: string;
  /** Lied-Kuerzel, wenn der Eintrag aus einer Lied-Analyse stammt */
  lied?: string;
  /** Einmal gemessen, ueberall weiterverwendet — siehe `klangProfil`. */
  klang: Klangprofil;
  /**
   * Bassline des Fensters aus dem Bass-Stem: eine MIDI-Note je Viertel, null
   * bei Pause (`grundton.bassNoten`). Nur bei Melodie-Fenstern eines Lieds.
   */
  bassLinie?: (number | null)[];
  /** Melodie des Fensters als Noten je 16tel (`meloNoten`), fuer Stab, Bass und Kick zur Melo. */
  meloLinie?: import("./meloNoten").MeloLinie;
}

export const LANG_AB = 2.5;
export const TRACK_AB = 60;
const STILL_PEAK = 0.05;

const UML: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };
const umlaute = (s: string) => s.replace(/[äöüÄÖÜß]/g, (c) => UML[c]);

const RE = {
  vox: /vocal|vokal|vox\b|audio|whatsapp|stimme|voice|communic|prophet|gzuz|abriss|gefuehl|nase|seen me|gibs tekk|katze/,
  fx: /\bfx\b|effekt|effect|sweep|alarm|riser|noise|quietsch|schall|aufgeschlizt|impact|crash|scratch/,
  melo: /melo|mello|synth|syme|pad\b|\d+(me|sp)\w*heiko|liebestrank|krossi|lackleder|mega ton|metropole|\bbgg\b|biese|hawk|bush|devillache|hyper|barett|hibliebe|honig|hpbe|intro|default|dhrc|sound|ancer|lead|chord|string|piano|arp/,
  kick: /kick|kicker|kiuck|\bbd\b|bassdrum|bumbug|\bki\d|tetoki|vink\d|bilanz|kank|tropf|turbo|toumoux|hard french|taeter drum|bern drum|hardki|emmaki|luzz\d? 16|druff|hub kick|homm|\bexo|dudibrumm|geil\b|boooffl|futeloser|baus\d|\bbreak\b|piup|aniki/,
  bass: /bass|bas\b|\bsub\b|808 bass/,
  snare: /snar|snair|snarre|snaare|\bsn\d|\bsd\b|rim/,
  clap: /clap|klatsch|handclap/,
  hat: /\bhat|hihat|hi-hat|\bhh\b|eatclose|eatopen|zlzzer|cymbal|ride|crash/,
  ton: /\bton\b|\bto\[n\]|ton[-_ ]?\d|_ton|teeton|tee ton|techno ton|tekke ton|tontekk|\bfuer\b|\btab\b|\bdn\b|foterlo|bussmj|moral|rtw|\bfote/,
  perc: /perc|shaker|tom\b|conga|bongo|tab\b|wood|click/,
};

/** Ab dieser Sicherheit setzt sich die Messung gegen die Verlegenheitsregel durch. */
export const KLANG_SICHER = 0.5;

export interface KlangRolle {
  rolle: Rolle;
  /** 0..1 — wie eindeutig das Material ist. */
  sicherheit: number;
  /** Was den Ausschlag gab, fuer die Anzeige. */
  grund: string;
}

/**
 * Die Rolle aus dem Klang lesen — der Ersatz fuer „kurz und laut ist eine Kick".
 *
 * Die Schwellen sind an den 43 Beispiel-Samples in `examples/e2s/korg3`
 * gemessen und nicht geraten. Was dort steht und was NICHT dort steht, ist
 * gleich wichtig:
 *
 * - **Bassanteil** trennt sauber: die Kicks liegen bei 0,67–0,98, alles andere
 *   ausser zwei tiefen Toenen unter 0,11. Das ist die verlaesslichste Zahl.
 * - **Helligkeit** trennt oben: Hats liegen bei 0,63–0,81, Kicks bei 0,00–0,54.
 * - **Scheitelfaktor** trennt Hat von Snare/Clap: Hats haben 11–16 dB, Snare
 *   und Clap 3–5 dB. Hardtekk-Kicks liegen bei 2–8 dB, weil sie durchweg
 *   limitiert sind.
 * - **Rauschigkeit** trennt hier NICHT. Bei diesem Material ist alles verzerrt,
 *   und die Flachheit streut bei Kicks (0,00–0,76) genauso breit wie bei
 *   Melodien (0,00–0,84). Sie steht im Profil, weil sie bei sauberem Material
 *   etwas taugt — hier geht sie bewusst nicht in die Entscheidung ein.
 *
 * Was das Verfahren NICHT kann: Vocals und FX erkennen. Beides ist eine Frage
 * des Inhalts, nicht der Klangfarbe; dafuer bleibt der Dateiname zustaendig.
 */
export function rolleAusKlang(p: Klangprofil): KlangRolle {
  const { sekunden, tiefe, helligkeit, crestDb } = p;
  if (sekunden >= TRACK_AB) return { rolle: "track", sicherheit: 0.9, grund: `${Math.round(sekunden)} s lang` };
  if (tiefe >= 0.6 && helligkeit <= 0.45) {
    return sekunden < 1
      ? { rolle: "kick", sicherheit: 0.85, grund: `${Math.round(tiefe * 100)} % unter 150 Hz, kurz` }
      : { rolle: "bass", sicherheit: 0.6, grund: `${Math.round(tiefe * 100)} % unter 150 Hz, gehalten` };
  }
  if (helligkeit >= 0.62 && sekunden < 0.5 && crestDb >= 8) {
    return { rolle: "hat", sicherheit: 0.7, grund: `Mitte ${Math.round(p.schwerpunktHz)} Hz, spitze Transiente` };
  }
  if (helligkeit >= 0.55 && sekunden < 1 && crestDb < 8 && tiefe < 0.2) {
    return { rolle: "snare", sicherheit: 0.55, grund: `hell, aber flach — Schlag statt Zischen` };
  }
  if (sekunden >= LANG_AB) return { rolle: "melo", sicherheit: 0.5, grund: `${sekunden.toFixed(1)} s — dafuer ist es zu lang` };
  if (sekunden < 0.6) return { rolle: "ton", sicherheit: 0.35, grund: "kurz, weder tief noch hell" };
  return { rolle: "ton", sicherheit: 0.3, grund: "nichts Auffaelliges" };
}

/**
 * Rolle eines Samples. Der Name entscheidet, solange er etwas sagt.
 *
 * `klang` ist optional, damit die Funktion auch ohne Analyse aufrufbar bleibt
 * (Tests, Wiederherstellen aus alten Projekten). Fehlt sie, greift die alte
 * Verlegenheitsregel — mit allen ihren Fehlern, aber ohne Ueberraschung.
 */
export function rolleFuer(stem: string, sekunden: number, rmsDb: number, klang?: Klangprofil): Rolle {
  const s = umlaute(stem).toLowerCase().replace(/_+/g, " ");
  if (sekunden >= TRACK_AB) return "track";
  if (/\d+\s*bpm/.test(s) && sekunden >= 12) return "track";
  if (RE.vox.test(s)) return "vox";
  if (RE.fx.test(s) && !RE.hat.test(s)) return "fx";
  if (RE.kick.test(s)) return "kick";
  if (RE.bass.test(s)) return "bass";
  if (RE.clap.test(s)) return "clap";
  if (RE.snare.test(s)) return "snare";
  if (RE.hat.test(s)) return "hat";
  if (RE.melo.test(s) && sekunden >= 1) return "melo";
  if (RE.ton.test(s)) return sekunden < LANG_AB ? "ton" : "melo";
  if (RE.perc.test(s)) return "perc";
  // Ab hier sagt der Name nichts mehr. Erst messen, dann raten.
  if (klang) {
    const k = rolleAusKlang(klang);
    if (k.sicherheit >= KLANG_SICHER) return k.rolle;
  }
  if (sekunden >= LANG_AB) return "melo";
  if (sekunden < 0.9 && rmsDb > -8.5) return "kick";
  if (sekunden < 0.6) return "perc";
  return "ton";
}

export function familie(stem: string): string {
  let s = umlaute(stem).toLowerCase();
  s = s.replace(/\(.*?\)/g, "");
  s = s.replace(/^\d+\s*/, "");
  s = s.replace(/[\s_\-!#.]*\d+[\s_\-!#.\d]*$/, "");
  s = s.replace(/[\s_\-!#.]+/g, " ").trim();
  return s || stem.toLowerCase();
}

export function sauberName(s: string, maxLen = 16): string {
  const t = umlaute(s).replace(/[^\x20-\x7e]/g, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return t.slice(0, maxLen).trim();
}

export function rmsDb(pcm: Float32Array): number {
  if (!pcm.length) return -120;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return 20 * Math.log10(Math.sqrt(s / pcm.length) + 1e-9);
}

export function peakVon(pcm: Float32Array): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > p) p = a;
  }
  return p;
}

/**
 * Ab diesem Klangfarben-Abstand sind zwei Samples verschieden.
 *
 * An denselben 43 Beispiel-Samples gemessen: dieselbe Datei nochmal, nur
 * leiser, kommt auf 0,000; dieselbe Datei zehn Prozent kuerzer geschnitten auf
 * 0,026; das AEHNLICHSTE echte Paar (zwei verschiedene Kicks derselben
 * Familie) auf 0,063. 0,04 liegt dazwischen und trennt beides sauber.
 *
 * Das ist genau die Luecke, die der Wellenform-Vergleich nicht schliesst: der
 * verlangt gleiche Laenge auf 50 ms und dieselbe Abtastrate und findet darum
 * dieselbe Kick nicht wieder, wenn sie einmal anders beschnitten wurde. Genau
 * so kommen Dubletten in einen Ordner.
 */
export const KLANG_DUBLETTE = 0.04;

/** Korrelation der ersten 0,2 s (One-Shots) bzw. des ganzen Puffers (Loops) — Fast-Dubletten. */
function korrelation(a: Float32Array, b: Float32Array, kurz: boolean, sr: number): number {
  const n = Math.min(a.length, b.length, kurz ? Math.round(0.2 * sr) : Infinity);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += a[i] * b[i];
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
  }
  return sab / (Math.sqrt(saa * sbb) + 1e-9);
}

export function scanne(
  eingaben: ScanEingabe[],
  overrides: Record<string, Rolle | "skip"> = {},
): { eintraege: ScanEintrag[]; uebersprungen: { datei: string; grund: string }[] } {
  const eintraege: ScanEintrag[] = [];
  const uebersprungen: { datei: string; grund: string }[] = [];
  for (const e of eingaben) {
    const stem = e.name.replace(/\.[^.]+$/, "");
    const ov = overrides[e.name] ?? overrides[stem];
    if (ov === "skip") {
      uebersprungen.push({ datei: e.name, grund: "overrides: skip" });
      continue;
    }
    const peak = peakVon(e.pcm);
    if (peak < STILL_PEAK || e.pcm.length < 64) {
      uebersprungen.push({ datei: e.name, grund: `still (Peak ${peak.toFixed(3)})` });
      continue;
    }
    const sekunden = e.pcm.length / e.sampleRate;
    const db = rmsDb(e.pcm);
    const dup = eintraege.find(
      (b) =>
        Math.abs(b.sekunden - sekunden) <= 0.05 &&
        sekunden <= 30 &&
        b.sampleRate === e.sampleRate &&
        korrelation(b.pcm, e.pcm, sekunden < LANG_AB, e.sampleRate) > 0.98,
    );
    if (dup) {
      uebersprungen.push({ datei: e.name, grund: `Dublette von ${dup.datei}` });
      continue;
    }
    const klang = klangProfil(e.pcm, e.sampleRate);
    // Zweite Stufe: gleiche Klangfarbe bei aehnlicher Laenge. Die Laengenpruefung
    // muss dabeibleiben — ein 1-Takt-Loop und der 8-Takt-Loop desselben Stuecks
    // haben dieselbe Klangfarbe und sind trotzdem zwei verschiedene Werkzeuge.
    const klangDup = eintraege.find(
      (b) =>
        Math.min(b.sekunden, sekunden) / Math.max(b.sekunden, sekunden) >= 0.75 &&
        klangAbstand(b.klang, klang) < KLANG_DUBLETTE,
    );
    if (klangDup) {
      uebersprungen.push({
        datei: e.name,
        grund: `klanglich identisch mit ${klangDup.datei} (Abstand ${klangAbstand(klangDup.klang, klang).toFixed(3)})`,
      });
      continue;
    }
    eintraege.push({
      datei: e.name,
      stem,
      rolle: ov ?? rolleFuer(stem, sekunden, db, klang),
      familie: familie(stem),
      sekunden,
      rmsDb: db,
      peak,
      pcm: e.pcm,
      sampleRate: e.sampleRate,
      klang,
    });
  }
  return { eintraege, uebersprungen };
}
