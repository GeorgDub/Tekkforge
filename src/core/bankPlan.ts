/**
 * bankPlan — aus Scan-Eintraegen eine Sample-Bank planen: Budget/Volumes,
 * One-Shots trimmen/normalisieren, Loops per Varispeed auf ganze Takte und
 * GANZ lassen (<= 8 Takte), laengere in genau zwei Haelften; tekk4-Drums
 * optional auf ihren Originalnummern; Ergebnis = Projekt + .all-Bytes.
 */
import { type ScanEintrag, type Rolle, sauberName, rmsDb, peakVon, LANG_AB } from "./sampleScan";
import { taktPassung, tempoSchaetzen } from "./tempoAnalyse";
import { meloRaster, type MeloRaster } from "./meloRaster";
import { klangProfil, type Klangprofil } from "./klangProfil";
import { rateFuer } from "./rateWahl";
import { RAM_BUDGET_BYTES, ramBytesSumme } from "./sampleRam";
import { loopPunkteAufNull, wiederholtSich, taktFrames } from "./loopPunkte";
import { slicesFuer, sliceAnzahl } from "./sliceMarker";
import { LOOP_TYPE_FORWARD, LOOP_TYPE_ONESHOT } from "./constants";
import { stretchAufLaenge } from "./timeStretch";
import type { MeloLinie } from "./meloNoten";
import { tonartErkennen, TONART_SICHER, type TonartInfo } from "./keyAnalyse";
import { polyPhaseResample, peakNormalize, rmsNormalize, downmixToMono } from "./audioProcessor";
import { buildE2sBank, type E2sSlotInput } from "./e2sBankBuilder";
import { parseE2sBank } from "./e2sBankReader";
import { displayNumberToOsc, displayNumberToSlotIndex, oscToDisplayNumber } from "./e2sPatternSampleLink";

export const SR = 44100;
export const BUDGET_SEKUNDEN = 235;
const TAKT_TOLERANZ = 0.12;
const KAT: Record<Rolle, number> = { bass: 0, kick: 2, snare: 3, clap: 4, hat: 5, ton: 7, vox: 9, fx: 11, perc: 13, melo: 15, track: 15 };
/** Bewaehrte tekk4-Drums (Name-Praefixe) wie in make-folder-bank.mjs. */
export const TEKK_BASIS = ["HaimKind", "Jumpkick", "clydesna", "snarre-p", "closed 8", "707_hho", "ED Close", "ZaHnI_To", "Unison_Bass_C3", "Bassdrum-01fd"];
const TEKK_ROLLE: Record<string, Rolle> = {
  HaimKind: "kick", Jumpkick: "kick", "Bassdrum-01fd": "kick", clydesna: "snare", "snarre-p": "snare",
  "closed 8": "hat", "707_hho": "hat", "ED Close": "hat", ZaHnI_To: "ton", Unison_Bass_C3: "bass",
};

export interface ProjektSample {
  nr: number;
  name: string;
  rolle: Rolle;
  familie: string;
  kind: "oneshot" | "loop";
  takte: number;
  sekunden: number;
  rmsDb: number;
  quelle: string;
  /** "tekk", "<rolle>" oder "<rolle>:<familie>" fuer Loops (Haelften A/B teilen die Gruppe) */
  gruppe: string;
  chunk?: 0 | 1;
  chunks?: 2;
  /** Melo-Loops: Onset/Bass je 16tel-Step (64 Werte) fuer melo-passende Steps */
  raster?: MeloRaster;
  /** Lied-Kuerzel, wenn das Sample aus einer Lied-Analyse stammt (Multi-Select-Zuordnung) */
  lied?: string;
  /**
   * Abtastrate des Slots — normalerweise 44100, bei sparsamen Vocals 22050.
   * Optional, weil aeltere Projektdateien das Feld nicht haben; fehlt es,
   * gilt 44100.
   */
  sampleRate?: number;
  /**
   * Klangprofil des fertigen Slots — gemessen an dem, was WIRKLICH in der Bank
   * liegt (nach Varispeed und Ratenwechsel), nicht an der Quelldatei.
   *
   * Damit entscheidet der Rezept-Planer, welche Samples nebeneinander liegen
   * duerfen, ohne die Audiodaten noch einmal anzufassen — die sind zu diesem
   * Zeitpunkt schon in der Bank und nicht mehr im Speicher. Optional, weil
   * aeltere Projektdateien es nicht haben; dann faellt der Planer auf die
   * bisherige Reihum-Auswahl zurueck.
   */
  klang?: Klangprofil;
  /**
   * Tonart des Slots — nur fuer tonale Schleifen (Melodie, Vocals, Bass, Ton).
   *
   * Nicht fuer alles, weil die Erkennung teuer ist (Goertzel ueber 60 Halbtoene
   * je Fenster) und bei einem 0,3-s-Schlagzeugschlag ohnehin nichts liefert.
   * Optional, weil aeltere Projektdateien es nicht haben.
   */
  tonart?: TonartInfo;
  /**
   * Loop-Punkte einer Schleife (Frames bei `sampleRate`), forward-Loop im
   * Slot. `takte` ist die musikalische Laenge, `gespeicherteTakte` das, was
   * wirklich in der Bank liegt — halb, wenn sich die Schleife wiederholt.
   */
  loop?: { start: number; ende: number; takte: number; gespeicherteTakte: number };
  /** Bassline des Fensters (Melodie-Loops aus einem Lied): MIDI-Note je Viertel, null = Pause. */
  bassLinie?: (number | null)[];
  /** Melodie als Noten je 16tel (`meloNoten`) — Stab spielt sie mit, Bass und Kick richten sich danach. */
  meloLinie?: MeloLinie;
}
export interface Projekt {
  name: string;
  bpm: number;
  budgetSekunden: number;
  volume: number;
  volumes: number;
  tekkDrums: boolean;
  samples: ProjektSample[];
  status: "gebaut" | "exportiert" | "geladen";
  bankZeit: string;
}
export interface PlanOptionen {
  name: string;
  bpm: number;
  budgetSekunden?: number;
  volume?: number;
  tekkDrumsBank?: Uint8Array;
  bankZeit?: string;
  /**
   * Vocal-Loops mit halber Abtastrate ablegen — halbiert ihren Speicherbedarf
   * und verdoppelt damit die moegliche Abdeckung eines Lieds. Gesang traegt
   * kaum Anteile ueber 11 kHz, der Verlust faellt weit weniger auf als bei
   * Drums oder Melodien (die bleiben unangetastet).
   *
   * ⚠ Am Geraet noch nicht abgenommen: Das Bankformat speichert die Rate je
   * Slot, ob die Electribe sie beim Abspielen wirklich beachtet, ist ungeprueft.
   * Tut sie es nicht, klaengen betroffene Samples doppelt so schnell.
   */
  sparsameVocals?: boolean;
  /**
   * Rate nach Rolloff (Vorgabe an): Slots, deren Energie zu 95 % unter 9 kHz
   * liegt, bekommen 22 050 Hz — halber Speicher, kein hoerbarer Verlust.
   * Hats, Snare und Clap bleiben immer voll. Siehe `rateWahl.ts`.
   */
  rateNachRolloff?: boolean;
  /**
   * Byte-Grenze des Sample-RAM (Vorgabe RAM_BUDGET_BYTES). Liegt die Bank
   * darueber, halbiert der Wächter erst Vocals, dann FX, dann Bass, und
   * laesst zuletzt die hintersten Slots weg — mit Warnung.
   */
  ramBytes?: number;
  /** Loop-Punkte auf Taktgrenzen und forward-Loop fuer Schleifen (Vorgabe an); aus = One-Shot wie frueher. */
  loopPunkte?: boolean;
  /**
   * 64 Slice-Marker je Schleife (Vorgabe AUS). Am Geraet gehoert (2026-09-04):
   * mit Markern spielt es die Vocals kurz und abgehackt — Slice-Modus.
   * Nur setzen, wenn die Schleife als Slice-Sequenz gespielt werden soll.
   */
  slices?: boolean;
}
export interface Teil {
  name: string;
  pcm: Float32Array;
  kind: "oneshot" | "loop";
  takte: number;
  chunk?: 0 | 1;
}

function trimme(pcm: Float32Array, db = 50): Float32Array {
  const schwelle = Math.pow(10, -db / 20) * peakVon(pcm);
  let a = 0;
  let b = pcm.length;
  while (a < b && Math.abs(pcm[a]) < schwelle) a++;
  while (b > a && Math.abs(pcm[b - 1]) < schwelle) b--;
  return b - a > 64 ? pcm.slice(a, b) : pcm;
}

function fades(pcm: Float32Array, einS: number, ausS: number): Float32Array {
  const out = pcm.slice();
  const fi = Math.round(einS * SR);
  const fo = Math.round(ausS * SR);
  for (let i = 0; i < fi && i < out.length; i++) out[i] *= i / fi;
  for (let i = 0; i < fo && i < out.length; i++) out[out.length - 1 - i] *= i / fo;
  return out;
}

/** rate > 1 → kuerzer/hoeher (Varispeed). */
function varispeed(pcm: Float32Array, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 0.002) return pcm;
  return polyPhaseResample(pcm, Math.round(SR * rate), SR, 1);
}

function aufLaenge(pcm: Float32Array, frames: number): Float32Array {
  if (pcm.length === frames) return pcm;
  const out = new Float32Array(frames);
  out.set(pcm.subarray(0, Math.min(frames, pcm.length)));
  return out;
}

const LOOP_ROLLEN: Rolle[] = ["melo", "vox", "fx", "bass", "ton"];

/**
 * Off-Grid-Loop: Eigentempo messen, Faktor k ∈ {0.5, 1, 2} zum Bank-Tempo,
 * Taktzahl am eigenen Raster. null, wenn der Loop auch sein eigenes Raster
 * verfehlt oder der noetige Varispeed zu weit weg von 1 laege (> ±23 %).
 */
function eigentempoTakte(pcm: Float32Array, bpm: number): { takte: number; rate: number } | null {
  const dauer = pcm.length / SR;
  const b0 = tempoSchaetzen(pcm, SR);
  const k = [0.5, 1, 2].reduce((a, b) => (Math.abs(b0 * b - bpm) < Math.abs(b0 * a - bpm) ? b : a));
  const roh = dauer / (240 / (b0 * k));
  const takte = Math.min(16, Math.max(1, Math.round(roh)));
  if (Math.abs(roh - takte) / takte > 0.08) return null;
  return { takte, rate: dauer / (takte * (240 / bpm)) };
}

/** Bis hierhin zieht der Varispeed (Tonhoehe wandert mit, ±3,6 Halbtoene); darueber wird gedehnt. */
export const VARISPEED_MIN = 0.77;
export const VARISPEED_MAX = 1.3;
/** Ab dieser Abweichung vom Bank-Raster wird das Eigentempo der Schleife ueberhaupt gemessen. */
const EIGENTEMPO_AB = 0.03;

/**
 * Zielpegel fuer Vocal-Schleifen (RMS in dBFS).
 *
 * Gemessen an einem fertigen Set (2026-08-27): die Melodie lag bei -11,4 dB
 * und klang richtig, die Vocals bei -17,5 dB und gingen unter der Kick unter —
 * der Nutzerbefund lautete „erst nach dem Muten der Kick ging es". Dazu
 * streuten die Vocal-Segmente untereinander um 12,6 dB, weil die
 * Spitzen-Normalisierung eine Phrase mit viel Pause genauso behandelt wie
 * einen dichten Loop. Der Zielwert liegt daher bei der Melodie.
 */
const VOX_ZIEL_RMS_DB = -12;

/** Ein Scan-Eintrag → ein oder zwei Teile (Haelften) fuer die Bank. */
export function bereiteAuf(e: ScanEintrag, bpm: number): { teile: Teil[] } {
  const taktSek = 240 / bpm;
  const basis = sauberName(e.stem);
  /**
   * Vocals nach Lautheit, alles andere nach Spitze.
   *
   * Nur die Vocals: Schlagzeug und Melodie hat der Nutzer im selben Durchlauf
   * ausdruecklich als gut befunden („hat gut gekickt") — daran wird nichts
   * geaendert, damit die Korrektur eine Korrektur bleibt und keine neue
   * Mischung ist.
   */
  const pegel = (pcm: Float32Array): Float32Array =>
    e.rolle === "vox" ? rmsNormalize(pcm, VOX_ZIEL_RMS_DB, 0.95, { weich: true }) : peakNormalize(pcm, 0.95);
  const oneshot = (pcm: Float32Array): Teil => ({ name: basis, pcm: peakNormalize(fades(trimme(pcm), 0.002, 0.01), 0.95), kind: "oneshot", takte: 0 });
  if (e.sekunden < LANG_AB || !LOOP_ROLLEN.includes(e.rolle)) return { teile: [oneshot(e.pcm)] };
  // Melo- und Vocal-Fenster sind schon taktgenau geschnitten — ein Silence-Trim
  // wuerde das 8-Takt-Raster verschieben und Segmente aus der Abdeckung kegeln
  let y = e.rolle === "melo" || e.rolle === "vox" ? e.pcm : trimme(e.pcm, 45);
  let { takte, abweichung } = taktPassung(y.length / SR, bpm);
  let dehnen = false;
  // Eigentempo der Schleife — nur wenn sie das Bank-Raster nicht ohnehin
  // sauber trifft (Lied-Fenster sind schon gedehnt und liegen bei 0).
  const eigen = abweichung > EIGENTEMPO_AB ? eigentempoTakte(y, bpm) : null;
  if (eigen !== null && (eigen.rate < VARISPEED_MIN || eigen.rate > VARISPEED_MAX)) {
    // Der noetige Varispeed laege jenseits ±23 %: die Taktzahl-Rundung wuerde
    // die Schleife zwar irgendwie einpassen (ein 4-Takter bei 135 BPM als
    // „5 Takte“ mit 7 % Varispeed), aber musikalisch falsch. Also dehnen —
    // auf die eigene Taktzahl, in Originaltonhoehe.
    takte = eigen.takte;
    dehnen = true;
  } else if (abweichung > TAKT_TOLERANZ) {
    // Melos, die das Bank-Raster verfehlen, laufen sonst als One-Shot asynchron —
    // am Eigentempo festmachen und per Varispeed aufs Bank-Tempo ziehen
    if (eigen !== null) takte = eigen.takte;
    else if (y.length / SR / taktSek <= 8) {
      return { teile: [{ name: basis, pcm: pegel(fades(y, 0.002, 0.01)), kind: "oneshot", takte: 0 }] };
    }
  }
  const ziel = takte * taktSek;
  y = dehnen ? stretchAufLaenge(y, Math.round(ziel * SR)) : aufLaenge(varispeed(y, y.length / SR / ziel), Math.round(ziel * SR));
  // Vocals ab 5 Takten als zwei Haelften: die Vers-Parts 15/16 spielen A/B per
  // Alternate hintereinander und sind am Geraet einzeln entmutbar
  const ganzBis = e.rolle === "vox" ? 4 : 8;
  if (takte <= ganzBis) return { teile: [{ name: basis, pcm: pegel(fades(y, 0.002, 0.004)), kind: "loop", takte }] };
  const h = y.length >> 1;
  const kurz = sauberName(e.stem, 14);
  const haelfte = Math.round(takte / 2);
  return {
    teile: [
      { name: `${kurz} A`, pcm: pegel(fades(y.subarray(0, h), 0.002, 0.004)), kind: "loop", takte: haelfte, chunk: 0 },
      { name: `${kurz} B`, pcm: pegel(fades(y.subarray(h), 0.002, 0.004)), kind: "loop", takte: haelfte, chunk: 1 },
    ],
  };
}

function punkte(e: ScanEintrag, bpm: number): number {
  const { takte, abweichung } = taktPassung(e.sekunden, bpm);
  let sc = -abweichung * 10 + Math.min(e.rmsDb, -8) / 10;
  if (e.sekunden >= 2.5 && e.sekunden <= 11) sc += 2;
  if (takte === 4 || takte === 8) sc += 1;
  if (/melo/i.test(e.stem)) sc += 1;
  // Vocals zuerst ins Budget: die Patterns sollen die ganze Vocalspur abdecken
  if (e.rolle === "vox") sc += 2.5;
  return sc;
}

/** Rangliste (taktgenau, laut, "melo", je Familie erst das beste) in Budget-Scheiben. */
/**
 * Vocals reihum aus den beteiligten Liedern nehmen.
 *
 * Die Rangliste allein entscheidet nach Pegel und Taktpassung — und wenn ein
 * Lied durchweg lauter ist, gewinnt es sie durchgehend. Bei drei Rap-Tracks in
 * einem Set (2026-08-29) hatte ein Lied 7 Vocal-Abschnitte in der Bank, eines
 * 2, und das dritte KEINEN, obwohl noch 7 MB frei waren. Wer drei Lieder in ein
 * Set gibt, will aus jedem etwas hoeren.
 *
 * Die Reihenfolge INNERHALB eines Lieds bleibt die der Rangliste — es wird nur
 * abwechselnd zugegriffen. Bei einem einzigen Lied aendert sich dadurch nichts.
 */
function voxVerschraenkt(kand: ScanEintrag[]): ScanEintrag[] {
  const stellen: number[] = [];
  const nachLied = new Map<string, ScanEintrag[]>();
  kand.forEach((e, i) => {
    if (e.rolle !== "vox") return;
    stellen.push(i);
    const key = e.lied ?? "";
    const liste = nachLied.get(key) ?? [];
    liste.push(e);
    nachLied.set(key, liste);
  });
  if (nachLied.size < 2) return kand;
  const reihum: ScanEintrag[] = [];
  const listen = [...nachLied.values()];
  for (let runde = 0; reihum.length < stellen.length; runde++) {
    for (const l of listen) if (l[runde]) reihum.push(l[runde]);
  }
  const raus = [...kand];
  stellen.forEach((stelle, i) => (raus[stelle] = reihum[i]));
  return raus;
}

export function waehleVolumes(eintraege: ScanEintrag[], bpm: number, budgetSekunden: number): ScanEintrag[][] {
  const kand = voxVerschraenkt(
    eintraege.filter((e) => e.rolle !== "track").sort((a, b) => punkte(b, bpm) - punkte(a, bpm)),
  );
  const erste: ScanEintrag[] = [];
  const zweite: ScanEintrag[] = [];
  const gesehen = new Set<string>();
  for (const e of kand) {
    (gesehen.has(e.familie) ? zweite : erste).push(e);
    gesehen.add(e.familie);
  }
  // Vocals fressen sonst mit ihrem Punkte-Bonus das ganze Budget der ersten
  // Volume (vocal-lastiges Lied -> keine Melos/Drums -> null Patterns): je
  // Scheibe hoechstens ~45 % Vox (das erste Vocal darf immer), der Rest kommt
  // in eigene Folge-Scheiben.
  const voxDeckel = budgetSekunden * 0.45;
  const scheiben: ScanEintrag[][] = [];
  let akt: ScanEintrag[] = [];
  let summe = 0;
  let voxSumme = 0;
  const warten: ScanEintrag[] = [];
  const schliesse = (): void => {
    if (!akt.length) return;
    scheiben.push(akt);
    akt = [];
    summe = 0;
    voxSumme = 0;
  };
  const packe = (liste: ScanEintrag[], voxDeckeln: boolean): void => {
    for (const e of liste) {
      if (voxDeckeln && e.rolle === "vox" && voxSumme > 0 && voxSumme + e.sekunden > voxDeckel) {
        warten.push(e);
        continue;
      }
      if (summe + e.sekunden > budgetSekunden && akt.length) schliesse();
      akt.push(e);
      summe += e.sekunden;
      if (e.rolle === "vox") voxSumme += e.sekunden;
    }
  };
  packe([...erste, ...zweite], true);
  schliesse();
  packe(warten, false);
  schliesse();
  return scheiben;
}

function eindeutig(name: string, vergeben: Set<string>): string {
  let n = name;
  let i = 2;
  while (vergeben.has(n.toLowerCase())) {
    const s = String(i++);
    n = name.slice(0, 16 - s.length).trimEnd() + s;
  }
  vergeben.add(n.toLowerCase());
  return n;
}

const REIHENFOLGE: Rolle[] = ["kick", "snare", "clap", "hat", "perc", "ton", "bass", "fx", "vox", "melo", "track"];

/** Nur tonale Schleifen bekommen eine Tonart — bei allem anderen waere es Rechenzeit fuer nichts. */
const TONALE_ROLLEN: Rolle[] = ["melo", "vox", "bass", "ton"];

function tonartFalls(rolle: Rolle, kind: "oneshot" | "loop", pcm: Float32Array, rate: number): { tonart?: TonartInfo } {
  if (kind !== "loop" || !TONALE_ROLLEN.includes(rolle)) return {};
  const t = tonartErkennen(pcm, rate);
  if (t.konfidenz < TONART_SICHER) return {};
  return { tonart: { name: t.name, camelot: t.camelot, konfidenz: t.konfidenz } };
}

export function planeBank(eintraege: ScanEintrag[], opts: PlanOptionen): { projekt: Projekt; bank: ArrayBuffer; warnungen: string[]; hinweise: string[] } {
  const budget = opts.budgetSekunden ?? BUDGET_SEKUNDEN;
  const volumes = waehleVolumes(eintraege, opts.bpm, budget);
  const volume = opts.volume ?? 1;
  if (volume > volumes.length) throw new Error(`nur ${volumes.length} Volumes moeglich`);
  const auswahl = volumes[volume - 1] ?? [];
  const slots: E2sSlotInput[] = [];
  const samples: ProjektSample[] = [];
  const vergeben = new Set<string>();
  let tekk = false;
  if (opts.tekkDrumsBank) {
    const basis = parseE2sBank(opts.tekkDrumsBank, "tekk4.all");
    const genommen = new Set<string>();
    for (const s of basis.slots) {
      if (!s) continue;
      const praefix = TEKK_BASIS.find((b) => s.name.trim().toLowerCase().startsWith(b.toLowerCase()));
      if (!praefix || genommen.has(praefix)) continue;
      genommen.add(praefix);
      const nr = oscToDisplayNumber(s.sampleNumber);
      // Die Electribe legt ein Mono-Sample auf EINEN Part, ein Stereo-Sample auf
      // ZWEI — uebernommene Stereo-Slots werden darum gemischt (spart Part und RAM)
      const pcm = s.channels === 2 ? downmixToMono(s.pcmData).pcm : s.pcmData;
      slots.push({
        slotIndex: s.index, sampleNumber: s.sampleNumber, name: s.name, category: s.category,
        pcmData: pcm, sampleRate: s.sampleRate, channels: 1,
      });
      samples.push({
        nr, name: s.name.trim(), rolle: TEKK_ROLLE[praefix], familie: "tekk", kind: "oneshot", takte: 0,
        sekunden: pcm.length / s.sampleRate, rmsDb: rmsDb(pcm), quelle: `tekk4.all #${nr}`, gruppe: "tekk",
        sampleRate: s.sampleRate, klang: klangProfil(pcm, s.sampleRate, { bpm: opts.bpm }),
      });
      vergeben.add(s.name.trim().toLowerCase());
    }
    tekk = genommen.size > 0;
  }
  let nr = tekk ? 601 : 501;
  let halbiert = 0;
  let wiederholt = 0;
  const sortiert = auswahl.slice().sort((a, b) => REIHENFOLGE.indexOf(a.rolle) - REIHENFOLGE.indexOf(b.rolle) || a.datei.localeCompare(b.datei));
  for (const e of sortiert) {
    const { teile } = bereiteAuf(e, opts.bpm);
    for (const t of teile) {
      const name = eindeutig(t.name, vergeben);
      // Rate je Slot: Wunsch (sparsame Vocal-Loops) oder Messung (Rolloff unter
      // 9 kHz) — halbe Rate, halber Speicher, gleiche Spieldauer.
      const rate = rateFuer(t.pcm, SR, e.rolle, {
        sparsameVocals: !!opts.sparsameVocals && t.kind === "loop",
        messen: opts.rateNachRolloff !== false,
      });
      if (rate !== SR) halbiert++;
      // Schleifen, die sich nach der Haelfte wiederholen, werden nur zur Haelfte
      // gespeichert — der forward-Loop fuellt den Rest. Nicht bei Vocals.
      // Nur mit forward-Loop darf die Haelfte gespeichert werden — als One-Shot spielte sie sonst nur halb.
      const mitLoop = opts.loopPunkte !== false;
      const halbeTakte = mitLoop && t.kind === "loop" && e.rolle !== "vox" ? wiederholtSich(t.pcm, t.takte, SR, opts.bpm) : null;
      const quelle = halbeTakte ? t.pcm.subarray(0, Math.round(halbeTakte * taktFrames(SR, opts.bpm))) : t.pcm;
      if (halbeTakte) wiederholt++;
      const pcm = rate !== SR ? polyPhaseResample(quelle, SR, rate, 1) : quelle;
      // Loop-Punkte auf der Taktgrenze (Nulldurchgang) und 64 Slice-Marker —
      // damit das Geraet die Schleife rund spielt und selbst choppen kann.
      const gespeichert = halbeTakte ?? t.takte;
      const loop = mitLoop && t.kind === "loop" ? loopPunkteAufNull(pcm, gespeichert, rate, opts.bpm) : null;
      // Slice-Marker nur auf Wunsch: am Geraet gehoert (2026-09-04) spielt ein
      // Slot mit Markern die Vocals „ganz kurz und abgehackt“ — das Geraet
      // nimmt die Marker als Slice-Modus, nicht als Beigabe.
      const slice = opts.slices === true && t.kind === "loop" ? slicesFuer(pcm, sliceAnzahl(gespeichert)) : null;
      slots.push({
        slotIndex: displayNumberToSlotIndex(nr), sampleNumber: displayNumberToOsc(nr), name, category: KAT[e.rolle], pcmData: pcm, sampleRate: rate, channels: 1,
        loopType: loop ? LOOP_TYPE_FORWARD : LOOP_TYPE_ONESHOT,
        ...(loop ? { loopStartBytes: loop.start * 2, loopEndBytes: loop.ende * 2 } : {}),
        ...(slice ?? {}),
      });
      samples.push({
        nr, name, rolle: e.rolle, familie: e.familie, kind: t.kind, takte: t.takte, sekunden: pcm.length / rate, rmsDb: rmsDb(pcm), quelle: e.datei, sampleRate: rate,
        ...(loop ? { loop: { start: loop.start, ende: loop.ende, takte: t.takte, gespeicherteTakte: gespeichert } } : {}),
        gruppe: t.kind === "loop" ? `${e.rolle}:${e.familie}` : e.rolle,
        ...(t.chunk !== undefined ? { chunk: t.chunk, chunks: 2 as const } : {}),
        ...(e.rolle === "melo" && t.kind === "loop" ? { raster: meloRaster(t.pcm, SR, t.takte) } : {}),
        ...(e.bassLinie && t.kind === "loop" && t.chunk !== 1 ? { bassLinie: e.bassLinie } : {}),
        ...(e.meloLinie && t.kind === "loop" && t.chunk !== 1 ? { meloLinie: e.meloLinie } : {}),
        // Am fertigen Slot gemessen: der Varispeed hat die Tonhoehe schon
        // verschoben, und bei sparsamen Vocals steht die halbe Rate. Ein Profil
        // von der Quelldatei beschriebe etwas, das so nicht in der Bank liegt.
        klang: klangProfil(pcm, rate, { bpm: opts.bpm }),
        ...tonartFalls(e.rolle, t.kind, pcm, rate),
        ...(e.lied ? { lied: e.lied } : {}),
      });
      nr++;
    }
  }
  const hinweise: string[] = [];
  if (halbiert) hinweise.push(`${halbiert} Slot(s) mit 22 050 Hz (Rolloff unter 9 kHz oder sparsame Vocals) — halber Speicher`);
  if (wiederholt) hinweise.push(`${wiederholt} Schleife(n) wiederholt sich nach der Haelfte — nur die Haelfte gespeichert, der Loop fuellt den Rest`);
  // Budget-Waechter: erst Vocals, dann FX, dann Bass auf halbe Rate, zuletzt
  // die hintersten Slots weg. `waehleVolumes` rechnet in Sekunden bei voller
  // Rate und haelt das meist schon ein; hier zaehlen die BYTES, die wirklich
  // in der Bank liegen — die einzige Wahrheit ueber den Speicher.
  const grenze = opts.ramBytes ?? RAM_BUDGET_BYTES;
  const bytes = () => ramBytesSumme(slots.map((s) => ({ pcm: s.pcmData, sampleRate: s.sampleRate })));
  for (const rolle of ["vox", "fx", "bass"] as const) {
    if (bytes() <= grenze) break;
    let n = 0;
    samples.forEach((s, i) => {
      if (bytes() <= grenze || s.rolle !== rolle || s.sampleRate !== SR || s.gruppe === "tekk") return;
      const slot = slots[i];
      slot.pcmData = polyPhaseResample(slot.pcmData, SR, SR / 2, 1);
      slot.sampleRate = SR / 2;
      s.sampleRate = SR / 2;
      s.klang = klangProfil(slot.pcmData, SR / 2, { bpm: opts.bpm });
      // Loop-Punkte und Marker ziehen mit der halben Bildzahl mit
      if (s.loop) {
        const l = loopPunkteAufNull(slot.pcmData, s.loop.gespeicherteTakte, SR / 2, opts.bpm);
        s.loop = { ...s.loop, start: l.start, ende: l.ende };
        slot.loopStartBytes = l.start * 2;
        slot.loopEndBytes = l.ende * 2;
        Object.assign(slot, slicesFuer(slot.pcmData, slot.slicingNumActive ?? 0) ?? {});
      }
      n++;
    });
    if (n) hinweise.push(`Budget: ${n} ${rolle}-Slot(s) auf 22 050 Hz gesetzt`);
  }
  let weg = 0;
  while (bytes() > grenze && slots.length > (tekk ? 1 : 0) && samples.length && samples[samples.length - 1].gruppe !== "tekk") {
    slots.pop();
    samples.pop();
    weg++;
  }
  if (weg) hinweise.push(`⚠ Budget: ${weg} Slot(s) am Ende weggelassen — ${(bytes() / 1048576).toFixed(1)} MB von ${(grenze / 1048576).toFixed(1)} MB belegt`);
  const bank = buildE2sBank(slots);
  const projekt: Projekt = {
    name: opts.name, bpm: opts.bpm, budgetSekunden: budget, volume, volumes: volumes.length, tekkDrums: tekk,
    samples, status: "gebaut", bankZeit: opts.bankZeit ?? new Date().toISOString(),
  };
  return { projekt, bank: bank.buffer, warnungen: bank.warnings ?? [], hinweise };
}
