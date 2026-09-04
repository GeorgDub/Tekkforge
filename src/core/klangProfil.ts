/**
 * klangProfil — was in einem Stueck Audio drinsteckt, als Zahlen.
 *
 * Bisher wurde an vielen Stellen geraten, wo gemessen werden koennte: die
 * Rolle eines Samples kam aus dem Dateinamen und ersatzweise aus Dauer und
 * Pegel, die Marken der Werkbank aus einem blinden Taktraster, und welche
 * Snare zu welcher Kick gelegt wird, entschied ein Zaehler reihum. Alle drei
 * Entscheidungen haengen in Wahrheit am Klang — und der laesst sich lesen.
 *
 * Dieses Modul misst EINMAL und legt das Ergebnis als kleinen Satz Zahlen ab.
 * Alles weiter unten rechnet nur noch mit diesen Zahlen:
 *
 * - **Bandenergie** (24 log-Baender 60 Hz–10 kHz): wo im Spektrum das Sample
 *   sitzt. Zwei Klaenge mit derselben Bandverteilung verdecken sich
 *   gegenseitig — das ist die Grundlage von `konflikt()`.
 * - **Helligkeit** (spektraler Schwerpunkt): eine Zahl statt 24, zum Sortieren
 *   und Anzeigen.
 * - **Tiefe** (Anteil unter 150 Hz): trennt Kick und Bass vom Rest.
 * - **Rauschigkeit** (spektrale Flachheit): trennt Zischendes (Hats, Crashes,
 *   Noise-FX) von Tonalem (Bass, Melodie, Stabs).
 * - **Dichte** (Anschlaege je Takt): wie viel im Sample los ist. Ein dichter
 *   Loop vertraegt ein duennes Schlagzeug und umgekehrt.
 * - **Stille**, **Scheitelfaktor**, **Uebersteuerung**, **Gleichanteil**: die
 *   Guetefragen. Was hier auffaellt, gehoert nicht in eine Bank.
 *
 * Das Profil ist bewusst klein und aus reinen Zahlen gebaut: es wandert mit
 * dem Projekt in die JSON-Datei und ueberlebt Speichern und Laden.
 *
 * Reine Rechnung auf Mono-PCM — kein Geraet, keine Oberflaeche.
 */

import {
  anteilUnter,
  bandEnergienAus,
  flachheit,
  gesamtLeistung,
  mittleresSpektrum,
  schwerpunkt,
  type Spektrum,
} from "./dsp";
import { onsetKurve } from "./tempoAnalyse";

/** Wie viele log-Baender der Klangfarben-Vektor hat. */
export const BAENDER = 24;
/** Unterste und oberste Frequenz des Vektors — dieselben wie in `dsp`. */
export const F_MIN = 60;
export const F_MAX = 10000;
/** Laenger als das wird nicht ausgewertet; der Ausschnitt kommt aus der Mitte. */
export const MAX_ANALYSE_SEK = 30;
/** Unterhalb dieses Pegels gilt ein Block als still. */
export const STILL_DB = -45;

export interface Klangprofil {
  /** 24 log-Baender 60 Hz–10 kHz, Summe 1 (oder alles 0, wenn zu kurz/still). */
  baender: number[];
  /** Spektraler Schwerpunkt in Hz. */
  schwerpunktHz: number;
  /** Schwerpunkt logarithmisch auf 60 Hz…10 kHz abgebildet, 0..1. */
  helligkeit: number;
  /** Energieanteil unter 150 Hz, 0..1. */
  tiefe: number;
  /** 0 = tonal (Bass, Melodie), 1 = rauschig (Hat, Crash, Noise). */
  rauschig: number;
  /**
   * Anschlaege je Takt bei dem Tempo, mit dem gemessen wurde.
   *
   * Nur bei Loops aussagekraeftig. Ein One-Shot ist kuerzer als ein Takt, und
   * die paar Ausschlaege in seinem Ausklang werden dann auf einen ganzen Takt
   * hochgerechnet — eine 0,33-s-Kick kommt so auf zwanzig Anschlaege je Takt.
   * Wer die Zahl auswertet, prueft vorher `sekunden` gegen die Taktlaenge.
   */
  dichte: number;
  /** Gefundene Anschlaege insgesamt. */
  anschlaege: number;
  /** Anteil der Zeit unter −45 dBFS, 0..1. */
  stille: number;
  /** Peak − RMS in dB. Hoch = Transiente (Kick, Clap), niedrig = Flaeche. */
  crestDb: number;
  pegelDb: number;
  peak: number;
  /** Laengere Strecken an der Vollaussteuerung — das knackt auf dem Geraet. */
  uebersteuert: boolean;
  /** Gleichanteil (Mittelwert). Ueber ~0,01 klemmt der Klang einseitig. */
  gleichanteil: number;
  sekunden: number;
}

export interface ProfilOptionen {
  /** Tempo fuer die Dichte in Anschlaegen je Takt; ohne Angabe 180. */
  bpm?: number;
  /** Laengster ausgewerteter Ausschnitt in Sekunden. */
  maxSekunden?: number;
}

const klemm01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/**
 * Flachheit auf eine brauchbare Skala bringen.
 *
 * Roh liegt die Flachheit bei tonalem Material um 1e-4 und bei Rauschen um
 * 0,3 — linear ist damit nichts anzufangen, weil sich alles Interessante in
 * den untersten Prozenten abspielt. Logarithmisch verteilt sich derselbe
 * Bereich gleichmaessig: 1e-3 → 0, 1e-2 → 0,33, 1e-1 → 0,67, 1 → 1.
 */
export function rauschigkeitAus(flach: number): number {
  return klemm01(Math.log10(Math.max(flach, 1e-6)) / 3 + 1);
}

/** Schwerpunkt in Hz auf 0..1 — logarithmisch, weil Gehoer und Frequenz es auch sind. */
export function helligkeitAus(hz: number): number {
  if (!(hz > 0)) return 0;
  return klemm01(Math.log2(hz / F_MIN) / Math.log2(F_MAX / F_MIN));
}

/**
 * Anschlaege in einem Ausschnitt: Stellen, an denen die Energie sprunghaft steigt.
 *
 * Dieselbe Onset-Kurve wie bei der Tempo-Analyse, nur anders ausgewertet — hier
 * zaehlen die Spitzen, nicht ihr Abstand. Mindestabstand 50 ms, damit der
 * Ausklang eines Schlags nicht als zweiter Schlag durchgeht.
 *
 * ⚠ Wie bei `grooveAusLied` kommt ein Stueck Stille davor: die Onset-Kurve
 * misst den ANSTIEG der Energie, und ein Sample, das direkt mit einem Schlag
 * beginnt (also jeder One-Shot und die meisten Loops), hat davor nichts, wogegen
 * dieser Anstieg zaehlen koennte. Ohne Vorlauf fehlt genau der erste Schlag —
 * bei einem Viertel-Muster sind das 25 % Fehler in der Dichte.
 */
export function anschlagStellen(pcm: Float32Array, sr: number, hop = 256): number[] {
  const vorlauf = hop * 2;
  const gepolstert = new Float32Array(pcm.length + vorlauf);
  gepolstert.set(pcm, vorlauf);
  const kurve = onsetKurve(gepolstert, sr, hop);
  let max = 0;
  for (const v of kurve) if (v > max) max = v;
  if (max <= 0) return [];
  const schwelle = 0.3 * max;
  const minHops = Math.max(1, Math.round((0.05 * sr) / hop));
  const out: number[] = [];
  let letzter = -Infinity;
  for (let i = 1; i < kurve.length - 1; i++) {
    if (kurve[i] < schwelle || kurve[i] < kurve[i - 1] || kurve[i + 1] > kurve[i]) continue;
    if (i - letzter < minHops) continue;
    letzter = i;
    out.push(Math.max(0, i * hop - vorlauf));
  }
  return out;
}

/** Wie viele Anschlaege im Ausschnitt stecken. */
export function anschlagZahl(pcm: Float32Array, sr: number, hop = 256): number {
  return anschlagStellen(pcm, sr, hop).length;
}

/**
 * Rhythmische Dichte in Anschlaegen je Takt.
 *
 * „Je Takt" und nicht „je Sekunde", weil die Zahl danach mit Patterns
 * verglichen wird und ein Pattern 16 Sechzehntel je Takt hat: 4 ist eine
 * Viertelnote-Kick, 16 ein durchgehendes Sechzehntel-Muster, darueber wird es
 * ein Wirbel.
 */
export function rhythmusDichte(pcm: Float32Array, sr: number, bpm = 180): number {
  const sekunden = pcm.length / sr;
  if (sekunden <= 0 || !(bpm > 0)) return 0;
  const takte = sekunden / (240 / bpm);
  if (takte <= 0) return 0;
  return anschlagZahl(pcm, sr) / takte;
}

/** Anteil der Zeit unter `STILL_DB`, in Bloecken von 20 ms gemessen. */
export function stilleAnteil(pcm: Float32Array, sr: number): number {
  const block = Math.max(1, Math.round(0.02 * sr));
  const schwelle = Math.pow(10, STILL_DB / 20);
  let bloecke = 0;
  let still = 0;
  for (let s = 0; s + block <= pcm.length; s += block) {
    let e = 0;
    for (let i = s; i < s + block; i++) e += pcm[i] * pcm[i];
    if (Math.sqrt(e / block) < schwelle) still++;
    bloecke++;
  }
  return bloecke ? still / bloecke : 0;
}

/**
 * Klebt das Signal an der Vollaussteuerung?
 *
 * Gesucht sind nicht einzelne laute Samples, sondern FLACHE Stellen: drei oder
 * mehr Werte hintereinander bei nahezu 1,0. Ein sauberer Peak beruehrt die
 * Eins hoechstens einmal; ein abgeschnittener liegt dort mehrere Samples lang.
 * Auf dem Geraet wird daraus beim Quantisieren ein Knacken.
 */
function klebt(pcm: Float32Array): boolean {
  let lauf = 0;
  let strecken = 0;
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) >= 0.98) {
      lauf++;
      if (lauf === 3) strecken++;
    } else lauf = 0;
  }
  return strecken > 3;
}

/**
 * Das ganze Profil eines Mono-Ausschnitts.
 *
 * Das Spektrum wird auf dem KLINGENDEN Teil gemessen, die Zeitgroessen auf dem
 * ganzen Puffer. Der Grund ist gemessen, nicht theoretisch: das Spektrum
 * entsteht aus Fenstern von 2048 Samples ab Pufferanfang, und bei einem
 * 0,34-s-Kick sind das gerade sieben Stueck. Schiebt man 80 ms Stille davor,
 * verschieben sich alle sieben Fenster gegen den Klang — derselbe Kick kam so
 * auf einen Klangfarben-Abstand von 0,061 zu sich selbst, mehr als der Abstand
 * zwischen zwei VERSCHIEDENEN Kicks (0,063). Damit waere jeder Vergleich
 * wertlos gewesen. Auf dem klingenden Teil gemessen sind es 0,000.
 *
 * Stille, Scheitelfaktor und Dauer beziehen sich weiter auf den ganzen Puffer —
 * sie sollen ja gerade sagen, wie viel Luft mit im Sample liegt.
 */
export function klangProfil(pcm: Float32Array, sr: number, opts: ProfilOptionen = {}): Klangprofil {
  const sekunden = pcm.length / sr;
  const grenzen = klangGrenzen(pcm, sr);
  const klingend = pcm.subarray(grenzen.von, grenzen.bis);
  const spek: Spektrum = mittleresSpektrum(klingend, sr, 2048, opts.maxSekunden ?? MAX_ANALYSE_SEK);
  const hz = schwerpunkt(spek);
  let summe = 0;
  let peak = 0;
  let mittel = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    summe += v * v;
    mittel += v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  const rms = pcm.length ? Math.sqrt(summe / pcm.length) : 0;
  const pegelDb = 20 * Math.log10(rms + 1e-9);
  return {
    baender: Array.from(bandEnergienAus(spek, BAENDER)),
    schwerpunktHz: hz,
    helligkeit: helligkeitAus(hz),
    tiefe: anteilUnter(spek, 150),
    rauschig: rauschigkeitAus(flachheit(spek)),
    dichte: rhythmusDichte(pcm, sr, opts.bpm ?? 180),
    anschlaege: anschlagZahl(pcm, sr),
    stille: stilleAnteil(pcm, sr),
    crestDb: rms > 0 ? 20 * Math.log10(peak / rms) : 0,
    pegelDb,
    peak,
    uebersteuert: klebt(pcm),
    gleichanteil: pcm.length ? mittel / pcm.length : 0,
    sekunden,
  };
}

// ── Zeitstruktur ────────────────────────────────────────────────────────────

export interface Novitaet {
  /** Wie stark sich der Klang von Fenster zu Fenster aendert. */
  werte: Float32Array;
  /** Abstand zweier Werte in Frames — Wert `i` gehoert zu Frame `i * hop`. */
  hop: number;
}

/**
 * Novitaetskurve — WO im Lied sich der Klang aendert.
 *
 * Das ist der Unterschied zwischen „alle 8 Takte schneiden" und „schneiden, wo
 * etwas passiert". Ein Taktraster trifft die Uebergaenge nur, wenn das Lied
 * exakt im Raster liegt und wirklich alle acht Takte etwas Neues bringt; sonst
 * schneidet es mitten in eine gehaltene Flaeche und laesst den Drop-Einsatz
 * ungeschnitten.
 *
 * Gemessen wird auf 12 log-Baendern statt auf dem rohen Spektrum: das haelt
 * die Kurve ruhig gegenueber Vibrato und kleinen Tonhoehenaenderungen und
 * schlaegt trotzdem aus, wenn ein Bass einsetzt oder die Hats verschwinden.
 * Die Baender gehen logarithmisch in die Kurve (`log(1+E)`), damit sowohl ein
 * Klangfarbenwechsel als auch ein Pegelsprung sichtbar wird — beides ist ein
 * Uebergang, den man schneiden will.
 */
export function novitaetsKurve(pcm: Float32Array, sr: number, hop = 1024, n = 2048, baender = 12): Novitaet {
  const rahmen = Math.max(0, Math.floor((pcm.length - n) / hop) + 1);
  const werte = new Float32Array(Math.max(0, rahmen));
  if (rahmen < 2) return { werte, hop };
  let vorher: Float32Array | null = null;
  for (let i = 0; i < rahmen; i++) {
    const spek = mittleresSpektrum(pcm.subarray(i * hop, i * hop + n), sr, n);
    const roh = bandEnergienAus(spek, baender);
    // Bandenergien sind auf Summe 1 normiert und blind fuer Lautstaerke —
    // die Gesamtleistung kommt darum als eigener Faktor wieder hinein.
    const pegel = Math.log1p(gesamtLeistung(spek) * 1000);
    const jetzt = new Float32Array(baender);
    for (let b = 0; b < baender; b++) jetzt[b] = Math.log1p(roh[b] * pegel * 10);
    if (vorher) {
      let d = 0;
      let summe = 0;
      for (let b = 0; b < baender; b++) {
        d += Math.abs(jetzt[b] - vorher[b]);
        summe += jetzt[b] + vorher[b];
      }
      // Die AENDERUNG ins Verhaeltnis zum PEGEL setzen. Ohne das haengt der
      // Zahlenwert an der Aussteuerung, und dann laesst sich nicht sagen, ob
      // ein Ausschlag ein Uebergang ist oder nur ein lautes Stueck. So heisst
      // 0 „nichts aendert sich" und 0,3 „ein Drittel des Klangs ist anders" —
      // unabhaengig davon, wie laut das Lied gemastert wurde.
      werte[i] = summe > 0 ? (2 * d) / summe : 0;
    }
    vorher = jetzt;
  }
  return { werte, hop };
}

export interface Bereich {
  von: number;
  bis: number;
}

/**
 * Stille Strecken — wo nichts klingt.
 *
 * Zwei Verwendungen: bei Vocals sind die Pausen die Phrasengrenzen (dort und
 * nur dort darf geschnitten werden, sonst zerreisst ein Wort), und bei jedem
 * Schnipsel sagen sie, ob am Anfang oder Ende nur Luft im Sample-RAM liegt.
 *
 * `minSek` filtert das Atmen zwischen zwei Silben heraus; unter etwa 100 ms
 * ist eine Luecke keine Pause, sondern ein Teil des Sprechens.
 */
export function stilleBereiche(pcm: Float32Array, sr: number, minSek = 0.12): Bereich[] {
  const block = Math.max(1, Math.round(0.02 * sr));
  const schwelle = Math.pow(10, STILL_DB / 20);
  const out: Bereich[] = [];
  let start = -1;
  const minFrames = Math.round(minSek * sr);
  const schliesse = (ende: number): void => {
    if (start >= 0 && ende - start >= minFrames) out.push({ von: start, bis: ende });
    start = -1;
  };
  for (let s = 0; s + block <= pcm.length; s += block) {
    let e = 0;
    for (let i = s; i < s + block; i++) e += pcm[i] * pcm[i];
    if (Math.sqrt(e / block) < schwelle) {
      if (start < 0) start = s;
    } else schliesse(s);
  }
  schliesse(pcm.length);
  return out;
}

/**
 * Die Grenzen des klingenden Teils — Stille am Anfang und Ende abgeschnitten.
 *
 * Auf dem Geraet kostet fuehrende Stille zweimal: einmal Sample-RAM, und
 * einmal Timing, denn der Step triggert den Sample-Anfang und nicht den ersten
 * hoerbaren Ton. Ein Sample mit 80 ms Vorlauf liegt bei 180 BPM eine halbe
 * Sechzehntel zu spaet.
 */
export function klangGrenzen(pcm: Float32Array, sr: number): Bereich {
  const still = stilleBereiche(pcm, sr, 0.02);
  let von = 0;
  let bis = pcm.length;
  for (const b of still) {
    if (b.von <= von) von = Math.max(von, b.bis);
    if (b.bis >= bis) bis = Math.min(bis, b.von);
  }
  if (von >= bis) return { von: 0, bis: pcm.length };
  return { von, bis };
}

// ── Vergleiche ──────────────────────────────────────────────────────────────

/**
 * Wie stark verdecken sich zwei Klaenge? 0 = getrennte Bereiche, 1 = derselbe.
 *
 * Beide Bandvektoren summieren sich auf 1, also ist die Summe der jeweils
 * kleineren Anteile genau der gemeinsame Teil des Spektrums — der Teil, in dem
 * sich beide im Weg stehen. Das ist die Zahl hinter „klingt matschig": zwei
 * Samples mit Konflikt 0,8 belegen dasselbe Band, und wer beide gleichzeitig
 * spielt, hoert danach nur noch eines von beiden.
 *
 * Ohne Bandvektor (altes Projekt ohne Profil) gibt es 0 zurueck — keine
 * Aussage ist besser als eine erfundene.
 */
export function konflikt(a?: Klangprofil, b?: Klangprofil): number {
  const x = a?.baender;
  const y = b?.baender;
  if (!x?.length || !y?.length || x.length !== y.length) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += Math.min(x[i], y[i]);
  return klemm01(s);
}

/** Gegenstueck zu `konflikt` — hoch heisst: die beiden ergaenzen sich. */
export function ergaenzung(a?: Klangprofil, b?: Klangprofil): number {
  if (!a?.baender?.length || !b?.baender?.length) return 0;
  return 1 - konflikt(a, b);
}

/** Euklidischer Abstand der Bandvektoren — fuer „am weitesten weg von". */
export function klangAbstand(a?: Klangprofil, b?: Klangprofil): number {
  const x = a?.baender;
  const y = b?.baender;
  if (!x?.length || !y?.length || x.length !== y.length) return 0;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - y[i]) * (x[i] - y[i]);
  return Math.sqrt(s);
}

/**
 * Der groesste Konflikt gegen eine Gruppe schon gesetzter Klaenge.
 *
 * Bewusst das Maximum und nicht der Mittelwert: ein Sample, das mit sieben
 * Partnern gut kann und mit dem achten gar nicht, ist genauso unbrauchbar wie
 * eines, das mit allen mittelmaessig kann — nur faellt es beim Mittelwert
 * nicht auf.
 */
export function maxKonflikt(kandidat: Klangprofil | undefined, gesetzt: readonly (Klangprofil | undefined)[]): number {
  let max = 0;
  for (const g of gesetzt) {
    const k = konflikt(kandidat, g);
    if (k > max) max = k;
  }
  return max;
}

// ── Anzeige ─────────────────────────────────────────────────────────────────

const khz = (hz: number): string => (hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`);
const proz = (x: number): string => `${Math.round(x * 100)} %`;

/** Eine Zeile fuer die Oberflaeche: was gemessen wurde, in Worten. */
export function profilText(p?: Klangprofil): string {
  if (!p) return "nicht analysiert";
  const teile = [
    `Mitte ${khz(p.schwerpunktHz)}`,
    `Tiefe ${proz(p.tiefe)}`,
    p.rauschig >= 0.6 ? "rauschig" : p.rauschig <= 0.35 ? "tonal" : "gemischt",
    `${p.dichte.toFixed(1)} Anschläge/Takt`,
  ];
  if (p.stille > 0.15) teile.push(`${proz(p.stille)} Stille`);
  if (p.uebersteuert) teile.push("übersteuert");
  if (Math.abs(p.gleichanteil) > 0.01) teile.push("Gleichanteil");
  return teile.join(" · ");
}

/** Kurzer Satz zu einem Konfliktwert — dieselbe Schwelle wie in der Auswahl. */
export function konfliktText(wert: number): string {
  if (wert >= 0.8) return "verdecken sich fast vollständig";
  if (wert >= 0.65) return "liegen im selben Bereich";
  if (wert >= 0.45) return "überschneiden sich teilweise";
  return "ergänzen sich";
}
