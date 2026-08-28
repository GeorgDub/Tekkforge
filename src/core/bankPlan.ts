/**
 * bankPlan — aus Scan-Eintraegen eine Sample-Bank planen: Budget/Volumes,
 * One-Shots trimmen/normalisieren, Loops per Varispeed auf ganze Takte und
 * GANZ lassen (<= 8 Takte), laengere in genau zwei Haelften; tekk4-Drums
 * optional auf ihren Originalnummern; Ergebnis = Projekt + .all-Bytes.
 */
import { type ScanEintrag, type Rolle, sauberName, rmsDb, peakVon, LANG_AB } from "./sampleScan";
import { taktPassung, tempoSchaetzen } from "./tempoAnalyse";
import { meloRaster, type MeloRaster } from "./meloRaster";
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
function eigentempoTakte(pcm: Float32Array, bpm: number): number | null {
  const dauer = pcm.length / SR;
  const b0 = tempoSchaetzen(pcm, SR);
  const k = [0.5, 1, 2].reduce((a, b) => (Math.abs(b0 * b - bpm) < Math.abs(b0 * a - bpm) ? b : a));
  const roh = dauer / (240 / (b0 * k));
  const takte = Math.min(16, Math.max(1, Math.round(roh)));
  if (Math.abs(roh - takte) / takte > 0.08) return null;
  const rate = dauer / (takte * (240 / bpm));
  return rate >= 0.77 && rate <= 1.3 ? takte : null;
}

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
  if (abweichung > TAKT_TOLERANZ) {
    // Melos, die das Bank-Raster verfehlen, laufen sonst als One-Shot asynchron —
    // erst am Eigentempo festmachen und per Varispeed aufs Bank-Tempo ziehen
    const eigen = eigentempoTakte(y, bpm);
    if (eigen !== null) takte = eigen;
    else if (y.length / SR / taktSek <= 8) {
      return { teile: [{ name: basis, pcm: pegel(fades(y, 0.002, 0.01)), kind: "oneshot", takte: 0 }] };
    }
  }
  const ziel = takte * taktSek;
  y = aufLaenge(varispeed(y, y.length / SR / ziel), Math.round(ziel * SR));
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

export function planeBank(eintraege: ScanEintrag[], opts: PlanOptionen): { projekt: Projekt; bank: ArrayBuffer; warnungen: string[] } {
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
        sampleRate: s.sampleRate,
      });
      vergeben.add(s.name.trim().toLowerCase());
    }
    tekk = genommen.size > 0;
  }
  let nr = tekk ? 601 : 501;
  const sortiert = auswahl.slice().sort((a, b) => REIHENFOLGE.indexOf(a.rolle) - REIHENFOLGE.indexOf(b.rolle) || a.datei.localeCompare(b.datei));
  for (const e of sortiert) {
    const { teile } = bereiteAuf(e, opts.bpm);
    for (const t of teile) {
      const name = eindeutig(t.name, vergeben);
      // Sparsame Vocals: halbe Rate, halber Speicher, gleiche Spieldauer
      const sparsam = opts.sparsameVocals && e.rolle === "vox" && t.kind === "loop";
      const rate = sparsam ? SR / 2 : SR;
      const pcm = sparsam ? polyPhaseResample(t.pcm, SR, rate, 1) : t.pcm;
      slots.push({ slotIndex: displayNumberToSlotIndex(nr), sampleNumber: displayNumberToOsc(nr), name, category: KAT[e.rolle], pcmData: pcm, sampleRate: rate, channels: 1, loopType: 1 });
      samples.push({
        nr, name, rolle: e.rolle, familie: e.familie, kind: t.kind, takte: t.takte, sekunden: pcm.length / rate, rmsDb: rmsDb(pcm), quelle: e.datei, sampleRate: rate,
        gruppe: t.kind === "loop" ? `${e.rolle}:${e.familie}` : e.rolle,
        ...(t.chunk !== undefined ? { chunk: t.chunk, chunks: 2 as const } : {}),
        ...(e.rolle === "melo" && t.kind === "loop" ? { raster: meloRaster(t.pcm, SR, t.takte) } : {}),
        ...(e.lied ? { lied: e.lied } : {}),
      });
      nr++;
    }
  }
  const bank = buildE2sBank(slots);
  const projekt: Projekt = {
    name: opts.name, bpm: opts.bpm, budgetSekunden: budget, volume, volumes: volumes.length, tekkDrums: tekk,
    samples, status: "gebaut", bankZeit: opts.bankZeit ?? new Date().toISOString(),
  };
  return { projekt, bank: bank.buffer, warnungen: bank.warnings ?? [] };
}
