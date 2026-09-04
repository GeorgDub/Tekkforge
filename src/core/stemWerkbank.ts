/**
 * stemWerkbank — Spuren, Marken und Schnitte von Hand.
 *
 * Der Generator schneidet automatisch, und meistens ist das richtig. Wenn es
 * das nicht ist, brauchte man bisher ein anderes Programm. Hier liegen die
 * Spuren des getrennten Lieds untereinander auf EINER Zeitachse: anhoeren,
 * Marken setzen, schneiden — mit der Maus, nicht ueber Parameter.
 *
 * Zwei Entscheidungen stecken in diesem Modul und nicht in der Oberflaeche:
 *
 * - **Marken gehoeren zur Spur, nicht zur Zeitachse.** Naheliegend waere ein
 *   gemeinsames Raster, denn die Stems teilen sich ja die Zeit. Aber die
 *   Vocals will man in acht Phrasen zerlegen und die Melodie hoechstens
 *   halbieren — mit gemeinsamen Marken ginge beides nicht nebeneinander.
 * - **Jede Marke schnappt auf den naechsten Nulldurchgang.** Ein Schnitt
 *   mitten in der Halbwelle knackt hoerbar; auf dem Geraet faellt das erst auf,
 *   wenn die Bank schon drauf ist.
 * - **Vorgeschlagen wird nach Klang, nicht nach Rechenweg.** Das Taktraster
 *   (`rasterMarken`) legt Marken dorthin, wo die Arithmetik sie hinlegt — auch
 *   mitten in eine gehaltene Flaeche, und am Drop-Einsatz vorbei, wenn der
 *   einen Schlag zu frueh kommt. `vorschlagMarken` liest stattdessen die Spur:
 *   Vocals werden an ihren Pausen getrennt, Melodien nur dort, wo sich der
 *   Klang wirklich aendert, Drums am Anschlag statt am Rechenwert. Das Raster
 *   bleibt als Kandidatenliste erhalten — es hat recht, wo es recht hat.
 */

import type { PoolSample } from "./editorModel";
import { ramBytesFuer } from "./sampleRam";
import {
  anschlagStellen,
  klangGrenzen,
  klangProfil,
  novitaetsKurve,
  profilText,
  stilleBereiche,
  type Klangprofil,
} from "./klangProfil";

/** Wie nah zwei Klicks sein duerfen, bevor sie als dieselbe Marke gelten. */
export const MARKE_TOLERANZ_MS = 8;
/** Wie weit von der Klickstelle nach einem Nulldurchgang gesucht wird. */
export const SCHNAPP_FENSTER_MS = 12;
/** Kuerzer schneiden lohnt nicht — das ist ein Klick, kein Klang. */
export const MIN_ABSCHNITT_MS = 40;

/** Wofuer die Spur steht — entscheidet ueber Hinweise, nicht ueber Technik. */
export type SpurRolle = "melo" | "vox" | "drums" | "bass" | "mix" | "sonst";

export interface Spur {
  id: string;
  name: string;
  rolle: SpurRolle;
  pcm: Float32Array;
  sampleRate: number;
  /** Schnittstellen in Frames, aufsteigend, ohne Anfang und Ende. */
  marken: number[];
  stumm: boolean;
  solo: boolean;
  /** Wiedergabe-Lautstaerke der Werkbank (aendert die Daten nicht). */
  gain: number;
}

let laufendeNummer = 0;

export function neueSpur(name: string, pcm: Float32Array, sampleRate: number, rolle: SpurRolle = "sonst"): Spur {
  return {
    id: `spur-${++laufendeNummer}`,
    name,
    rolle,
    pcm,
    sampleRate,
    marken: [],
    stumm: false,
    solo: false,
    gain: 1,
  };
}

const msZuFrames = (ms: number, sr: number): number => Math.max(1, Math.round((ms * sr) / 1000));

/**
 * Naechster Nulldurchgang um `frame` herum.
 *
 * Gesucht wird in beide Richtungen und genommen, was zuerst kommt. Findet sich
 * im Fenster keiner (Rauschen ohne Nulldurchgang, Gleichanteil), bleibt die
 * Stelle wie geklickt — raten waere schlimmer als nicht schnappen.
 */
export function nullDurchgang(pcm: Float32Array, frame: number, fensterFrames: number): number {
  const mitte = Math.max(0, Math.min(pcm.length - 1, Math.round(frame)));
  for (let d = 0; d <= fensterFrames; d++) {
    for (const i of d === 0 ? [mitte] : [mitte - d, mitte + d]) {
      if (i <= 0 || i >= pcm.length) continue;
      // Vorzeichenwechsel zwischen i-1 und i: da liegt die Null.
      if ((pcm[i - 1] <= 0 && pcm[i] >= 0) || (pcm[i - 1] >= 0 && pcm[i] <= 0)) return i;
    }
  }
  return mitte;
}

/**
 * Marke setzen. Anfang und Ende sind keine Marken — sie begrenzen ohnehin.
 * Eine Stelle, an der schon eine Marke steht, setzt keine zweite.
 */
export function setzeMarke(spur: Spur, frame: number, opts: { schnappen?: boolean } = {}): void {
  const schnappen = opts.schnappen !== false;
  let f = Math.round(frame);
  // Erst die geklickte Stelle pruefen, dann schnappen: sonst zieht das
  // Schnappen einen Klick auf den Rand nach innen und legt dort eine Marke an,
  // die niemand gesetzt hat.
  if (f <= 0 || f >= spur.pcm.length) return;
  if (schnappen) f = nullDurchgang(spur.pcm, f, msZuFrames(SCHNAPP_FENSTER_MS, spur.sampleRate));
  if (f <= 0 || f >= spur.pcm.length) return;
  const tol = msZuFrames(MARKE_TOLERANZ_MS, spur.sampleRate);
  if (spur.marken.some((m) => Math.abs(m - f) <= tol)) return;
  spur.marken.push(f);
  spur.marken.sort((a, b) => a - b);
}

/** Marke in der Naehe entfernen; true, wenn eine getroffen wurde. */
export function entferneMarke(spur: Spur, frame: number, toleranzFrames?: number): boolean {
  const tol = toleranzFrames ?? msZuFrames(MARKE_TOLERANZ_MS * 4, spur.sampleRate);
  let beste = -1;
  let abstand = Infinity;
  spur.marken.forEach((m, i) => {
    const d = Math.abs(m - frame);
    if (d <= tol && d < abstand) {
      abstand = d;
      beste = i;
    }
  });
  if (beste < 0) return false;
  spur.marken.splice(beste, 1);
  return true;
}

export interface Abschnitt {
  von: number;
  bis: number;
  index: number;
}

/** Die Spur zwischen ihren Marken — lueckenlos und ohne Ueberlappung. */
export function abschnitte(spur: Spur): Abschnitt[] {
  const grenzen = [0, ...spur.marken, spur.pcm.length];
  const out: Abschnitt[] = [];
  for (let i = 0; i < grenzen.length - 1; i++) out.push({ von: grenzen[i], bis: grenzen[i + 1], index: i });
  return out;
}

/**
 * Marken auf die Taktgrenzen legen — der automatische Teil.
 *
 * `takte` sagt, wie grob: 1 schneidet jeden Takt, 8 die uebliche
 * Tekk-Phrase. Ohne brauchbares Tempo gibt es kein Raster statt einer
 * Endlosschleife.
 */
export function rasterMarken(laengeFrames: number, sampleRate: number, bpm: number, takte = 1): number[] {
  if (!Number.isFinite(bpm) || bpm <= 0 || takte <= 0) return [];
  const schritt = (takte * 4 * 60 * sampleRate) / bpm;
  if (!Number.isFinite(schritt) || schritt < 1) return [];
  const out: number[] = [];
  for (let f = schritt; f < laengeFrames - 1; f += schritt) out.push(Math.round(f));
  return out;
}

export interface SchnittErgebnis {
  samples: PoolSample[];
  hinweise: string[];
  /** Was die Schnipsel im Sample-RAM des Geraets belegen wuerden. */
  bytes: number;
  /** Klangprofil je Schnipsel, in derselben Reihenfolge wie `samples`. */
  profile: Klangprofil[];
}

/** Unter diesem Pegel ist ein Schnipsel kein Klang, sondern Luft im Sample-RAM. */
export const STILL_ABSCHNITT_DB = -50;

/**
 * Die Abschnitte einer Spur als Pool-Samples.
 *
 * Zu kurze Schnipsel fallen heraus: sie entstehen beim Danebenklicken und
 * waeren auf dem Geraet ein Knacken mit eigener Nummer.
 *
 * Dasselbe gilt fuer STILLE Schnipsel, und die entstehen nicht durch
 * Danebenklicken, sondern regelmaessig: schneidet man ein Lied im Taktraster,
 * faellt jede Pause zwischen zwei Phrasen als eigener Abschnitt an. Auf dem
 * Geraet ist das ein Slot mit einer Nummer, einem Namen und ein paar hundert
 * Kilobyte Nichts — und der Sample-RAM hat 24 MB.
 *
 * Alles Weitere wird gemeldet, nicht entschieden: uebersteuerte Schnipsel,
 * Gleichanteil und fuehrende Stille aendern den Klang, aber ob sie stoeren,
 * weiss nur, wer das Lied kennt.
 */
export function schneideSpur(
  spur: Spur,
  opts: { basisNummer: number; nurAbschnitt?: number },
): SchnittErgebnis {
  const hinweise: string[] = [];
  const minFrames = msZuFrames(MIN_ABSCHNITT_MS, spur.sampleRate);
  let alle = abschnitte(spur);
  if (opts.nurAbschnitt !== undefined) alle = alle.filter((a) => a.index === opts.nurAbschnitt);
  const langGenug = alle.filter((a) => a.bis - a.von >= minFrames);
  const verworfen = alle.length - langGenug.length;
  if (verworfen) hinweise.push(`${verworfen} Abschnitt(e) unter ${MIN_ABSCHNITT_MS} ms — zu kurz, weggelassen.`);

  // Erst messen, dann aussortieren: das Profil wird ohnehin gebraucht und
  // beantwortet die Stille-Frage nebenbei.
  const gemessen = langGenug.map((a) => ({
    a,
    profil: klangProfil(spur.pcm.subarray(a.von, a.bis), spur.sampleRate),
  }));
  const brauchbar = gemessen.filter((g) => g.profil.pegelDb > STILL_ABSCHNITT_DB);
  const stille = gemessen.length - brauchbar.length;
  if (stille) hinweise.push(`${stille} Abschnitt(e) ohne hoerbaren Inhalt — weggelassen, das waere nur Platz in der Bank.`);

  if (spur.rolle === "melo" && brauchbar.length > 2) {
    hinweise.push(
      `„${spur.name}" ist eine Melodie und zerfaellt in ${brauchbar.length} Teile. Melodien bleiben besser ganz, hoechstens zwei Haelften — von Hand geht es, aber es sollte Absicht sein.`,
    );
  }
  const samples: PoolSample[] = brauchbar.map((g, i) => ({
    number: opts.basisNummer + i,
    name: teilName(spur.name, i, brauchbar.length),
    sampleRate: spur.sampleRate,
    pcm: spur.pcm.slice(g.a.von, g.a.bis),
  }));
  const profile = brauchbar.map((g) => g.profil);
  profile.forEach((profil, i) => {
    const wer = samples[i]?.name ?? `Teil ${i + 1}`;
    if (profil.uebersteuert) hinweise.push(`„${wer}" klebt an der Vollaussteuerung — auf dem Geraet knackt das beim Quantisieren.`);
    if (Math.abs(profil.gleichanteil) > 0.02) hinweise.push(`„${wer}" hat einen Gleichanteil — der Klang sitzt einseitig und verschenkt Aussteuerung.`);
    const grenzen = klangGrenzen(spur.pcm.subarray(brauchbar[i].a.von, brauchbar[i].a.bis), spur.sampleRate);
    const vorlaufMs = (grenzen.von / spur.sampleRate) * 1000;
    if (vorlaufMs > 30) hinweise.push(`„${wer}" beginnt mit ${Math.round(vorlaufMs)} ms Stille — der Step triggert den Anfang, nicht den Ton.`);
  });
  let bytes = 0;
  for (const s of samples) bytes += ramBytesFuer(s);
  return { samples, hinweise, bytes, profile };
}

/** Name eines Schnipsels — kurz genug fuers Geraetefeld, mit Nummer bei mehreren. */
function teilName(spurName: string, index: number, gesamt: number): string {
  const basis = spurName.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "SPUR";
  if (gesamt <= 1) return basis.slice(0, 15);
  return `${basis.slice(0, 11)} ${String(index + 1).padStart(2, "0")}`;
}

/**
 * Laenge der gemeinsamen Zeitachse in Frames.
 *
 * Die laengste Spur gibt sie vor; eine kuerzere endet eben frueher. Nie null,
 * sonst teilt die Anzeige beim Zeichnen durch null.
 */
export function zeitachse(spuren: readonly Spur[]): number {
  let max = 1;
  for (const s of spuren) if (s.pcm.length > max) max = s.pcm.length;
  return max;
}

/** Welche Spuren beim Anhoeren wirklich klingen (Solo sticht Stumm). */
export function hoerbareSpuren(spuren: readonly Spur[]): Spur[] {
  const solo = spuren.filter((s) => s.solo);
  const kandidaten = solo.length ? solo : spuren;
  return kandidaten.filter((s) => !s.stumm || s.solo);
}

// ── Marken vorschlagen ──────────────────────────────────────────────────────

/** Wie weit eine vorgeschlagene Marke bis zu einem Anschlag laufen darf. */
export const ANSCHLAG_FENSTER_MS = 45;
/** Ein Hauch Vorlauf vor dem Anschlag — der Einschwinger beginnt vor der Spitze. */
export const VOR_ANSCHLAG_MS = 6;
/** Kuerzeste Lücke, die als Phrasengrenze zaehlt. */
export const MIN_PAUSE_MS = 120;
/** Wie weit vor dem Ende einer Pause geschnitten wird. */
export const PAUSE_VORLAUF_MS = 15;
/**
 * Wie viel sich aendern muss, damit es ein Uebergang ist.
 *
 * Die Novitaetskurve ist auf den Pegel bezogen: 0 heisst „nichts aendert
 * sich", 0,3 heisst „ein knappes Drittel des Klangs ist anders". 0,08 liegt
 * knapp ueber dem, was ein Vibrato oder ein Akkordwechsel innerhalb derselben
 * Flaeche erzeugt, und deutlich unter einem echten Wechsel (dort stehen Werte
 * um 1). Ohne diese ABSOLUTE Untergrenze findet ein rein relatives Mass auch
 * in einer voellig gleichfoermigen Spur noch „den staerksten Uebergang" —
 * naemlich Rechenrauschen.
 */
export const MIN_NOVITAET = 0.08;

/** Woher ein Vorschlag kommt — steht in der Statuszeile, damit man ihm ansieht, was er ist. */
export type Verfahren = "pausen" | "novitaet" | "raster";

export interface MarkenVorschlag {
  frames: number[];
  verfahren: Verfahren;
  hinweise: string[];
}

export interface VorschlagOptionen {
  bpm: number;
  /** Rasterweite in Takten; ohne Angabe entscheidet die Rolle. */
  takte?: number;
  /** Hoechstzahl Marken; ohne Angabe entscheidet die Rolle. */
  maxMarken?: number;
}

/**
 * Was eine Spur ihrer Rolle nach braucht.
 *
 * Die Zahlen sind keine Vorlieben, sondern das, was am Geraet gebraucht wird:
 * eine Vocalspur wird ueber die Part-Kette verteilt und darf darum in viele
 * Phrasen zerfallen; eine Melodie bleibt ganz oder halb (feste Regel, siehe
 * `schneideSpur`); ein Drums-Stem wird taktweise geschnitten, weil daraus
 * Loops und keine Phrasen werden.
 */
const ROLLEN_VORGABE: Record<SpurRolle, { takte: number; maxMarken: number; verfahren: Verfahren }> = {
  vox: { takte: 4, maxMarken: 15, verfahren: "pausen" },
  melo: { takte: 4, maxMarken: 1, verfahren: "novitaet" },
  drums: { takte: 1, maxMarken: 63, verfahren: "raster" },
  bass: { takte: 4, maxMarken: 3, verfahren: "novitaet" },
  mix: { takte: 8, maxMarken: 7, verfahren: "novitaet" },
  sonst: { takte: 4, maxMarken: 7, verfahren: "novitaet" },
};

/**
 * Eine Stelle auf den echten Klang legen: erst auf den Anschlag, dann auf die Null.
 *
 * Die Reihenfolge ist wichtig und nicht umkehrbar. Der Anschlag sagt, WO
 * geschnitten wird (musikalisch), der Nulldurchgang sagt, WIE (ohne Knacken).
 * Umgekehrt wuerde der Nulldurchgang die Stelle um ein paar Samples verschieben
 * und der Anschlag sie danach wieder wegziehen.
 *
 * Der kleine Vorlauf vor dem Anschlag ist der Einschwinger: die Onset-Kurve hat
 * ihre Spitze dort, wo die Energie am staerksten STEIGT, also ein Stueck nach
 * dem eigentlichen Anfang. Ohne Vorlauf faengt jeder Schnipsel mit einem schon
 * halb offenen Klang an.
 */
function aufKlangLegen(spur: Spur, frame: number, anschlaege: readonly number[]): number {
  const fenster = msZuFrames(ANSCHLAG_FENSTER_MS, spur.sampleRate);
  let ziel = frame;
  let abstand = Infinity;
  for (const a of anschlaege) {
    const d = Math.abs(a - frame);
    if (d <= fenster && d < abstand) {
      abstand = d;
      ziel = a;
    }
  }
  if (abstand < Infinity) ziel = Math.max(0, ziel - msZuFrames(VOR_ANSCHLAG_MS, spur.sampleRate));
  return nullDurchgang(spur.pcm, ziel, msZuFrames(SCHNAPP_FENSTER_MS, spur.sampleRate));
}

/** Marken sortieren, Duplikate und Randlagen entfernen, Mindestlaenge einhalten. */
function bereinige(spur: Spur, roh: readonly number[]): number[] {
  const min = msZuFrames(MIN_ABSCHNITT_MS, spur.sampleRate);
  const out: number[] = [];
  for (const f of [...roh].sort((a, b) => a - b)) {
    if (f <= min || f >= spur.pcm.length - min) continue;
    if (out.length && f - out[out.length - 1] < min) continue;
    out.push(f);
  }
  return out;
}

/**
 * Marken an den Pausen — das Verfahren fuer Vocals.
 *
 * Eine gesungene Zeile hoert irgendwo auf, und dort und nur dort darf getrennt
 * werden. Ein Taktraster trifft diese Stelle nur zufaellig: es schneidet mitten
 * durch ein gehaltenes Wort, und auf dem Geraet endet die Phrase dann abrupt
 * und die naechste beginnt mit einer halben Silbe.
 *
 * Geschnitten wird kurz VOR dem Ende der Pause, nicht in ihrer Mitte: so
 * beginnt der naechste Schnipsel mit einem Hauch Luft und nicht direkt auf der
 * Silbe — das haelt den Einsatz sauber, auch wenn der Step ein paar
 * Millisekunden frueh kommt.
 */
export function pausenMarken(spur: Spur, opts: { minPauseMs?: number; maxMarken?: number } = {}): number[] {
  const minSek = (opts.minPauseMs ?? MIN_PAUSE_MS) / 1000;
  const vorlauf = msZuFrames(PAUSE_VORLAUF_MS, spur.sampleRate);
  const pausen = stilleBereiche(spur.pcm, spur.sampleRate, minSek)
    // Stille ganz am Anfang oder Ende ist kein Uebergang, sondern Rand.
    .filter((b) => b.von > 0 && b.bis < spur.pcm.length);
  const max = opts.maxMarken ?? ROLLEN_VORGABE.vox.maxMarken;
  // Bei zu vielen Pausen zaehlen die LAENGSTEN — eine lange Pause trennt zwei
  // Teile, eine kurze trennt zwei Woerter.
  const gewaehlt = pausen
    .slice()
    .sort((a, b) => b.bis - b.von - (a.bis - a.von))
    .slice(0, max)
    .map((b) => Math.max(b.von, b.bis - vorlauf));
  return bereinige(spur, gewaehlt.map((f) => nullDurchgang(spur.pcm, f, msZuFrames(SCHNAPP_FENSTER_MS, spur.sampleRate))));
}

/**
 * Marken dort, wo sich der Klang aendert — das Verfahren fuer Melodien und Mixe.
 *
 * Das Taktraster liefert die Kandidaten (ein Uebergang liegt fast immer auf
 * einer Taktgrenze), die Novitaetskurve entscheidet, WELCHE davon einer sind.
 * Ohne diese zweite Stufe schneidet ein 8-Takt-Raster eine gehaltene Flaeche in
 * gleich lange Stuecke, die einzeln nichts bedeuten.
 *
 * Jeder Kandidat darf sich noch ein Stueck bewegen — hoechstens einen Takt weit
 * und hoechstens ein Viertel der Rasterweite. Das faengt den haeufigen Fall,
 * dass der Drop einen Schlag vor der gerechneten Taktgrenze einsetzt, ohne dass
 * eine Marke in den uebernaechsten Takt wandert.
 */
export function novitaetsMarken(spur: Spur, opts: VorschlagOptionen & { takte: number; maxMarken: number }): number[] {
  const kandidaten = rasterMarken(spur.pcm.length, spur.sampleRate, opts.bpm, opts.takte);
  if (!kandidaten.length) return [];
  const nov = novitaetsKurve(spur.pcm, spur.sampleRate);
  if (nov.werte.length < 3) return bereinige(spur, kandidaten.slice(0, opts.maxMarken));
  const taktFrames = (4 * 60 * spur.sampleRate) / opts.bpm;
  const schritt = taktFrames * opts.takte;
  const suchFenster = Math.max(1, Math.round(Math.min(taktFrames, schritt / 4)));
  const anschlaege = anschlagStellen(spur.pcm, spur.sampleRate);

  const bewertet = kandidaten.map((k) => {
    const von = Math.max(0, Math.floor((k - suchFenster) / nov.hop));
    const bis = Math.min(nov.werte.length - 1, Math.ceil((k + suchFenster) / nov.hop));
    let besterIndex = Math.min(nov.werte.length - 1, Math.round(k / nov.hop));
    let bester = -Infinity;
    for (let i = von; i <= bis; i++) {
      if (nov.werte[i] > bester) {
        bester = nov.werte[i];
        besterIndex = i;
      }
    }
    return { frame: besterIndex * nov.hop, wert: bester };
  });

  // Nur die deutlichen Uebergaenge. Gemessen wird gegen den STAERKSTEN im
  // Stueck und nicht gegen einen festen Wert: wie gross ein Ausschlag ausfaellt,
  // haengt an Material und Aussteuerung, das Verhaeltnis untereinander nicht.
  const staerkster = bewertet.reduce((a, b) => (b.wert > a ? b.wert : a), 0);
  const schwelle = Math.max(MIN_NOVITAET, staerkster * 0.35);
  const gewaehlt = bewertet
    .filter((b) => b.wert >= schwelle)
    .sort((a, b) => b.wert - a.wert)
    .slice(0, opts.maxMarken)
    .map((b) => aufKlangLegen(spur, b.frame, anschlaege));
  return bereinige(spur, gewaehlt);
}

/**
 * Marken auf dem Taktraster, aber auf dem echten Anschlag — das Verfahren fuer Drums.
 *
 * Ein Drums-Stem wird taktweise geschnitten, da gibt es nichts zu bewerten.
 * Was es gibt, ist der Versatz zwischen gerechneter und gespielter Taktgrenze:
 * die Analyse liefert das Tempo auf 0,25 BPM genau, und nach acht Takten sind
 * daraus schon ein paar Millisekunden geworden. Ohne Anschlag-Schnappen faengt
 * jeder Loop mit einem angeschnittenen Kick an.
 */
export function anschlagRaster(spur: Spur, opts: VorschlagOptionen & { takte: number }): number[] {
  const kandidaten = rasterMarken(spur.pcm.length, spur.sampleRate, opts.bpm, opts.takte);
  const anschlaege = anschlagStellen(spur.pcm, spur.sampleRate);
  return bereinige(spur, kandidaten.map((k) => aufKlangLegen(spur, k, anschlaege)));
}

/**
 * Der Vorschlag fuer eine Spur — welches Verfahren, entscheidet die Rolle.
 *
 * Das ersetzt `rasterMarken` nicht, es sortiert es ein: das Raster bleibt der
 * Kandidatenlieferant und bei Drums sogar das Verfahren. Was hinzukommt, ist
 * die Frage, ob an der gerechneten Stelle ueberhaupt etwas passiert.
 */
export function vorschlagMarken(spur: Spur, opts: VorschlagOptionen): MarkenVorschlag {
  const hinweise: string[] = [];
  const vorgabe = ROLLEN_VORGABE[spur.rolle];
  const takte = Math.max(1, Math.round(opts.takte ?? vorgabe.takte));
  const maxMarken = Math.max(0, Math.round(opts.maxMarken ?? vorgabe.maxMarken));
  if (!Number.isFinite(opts.bpm) || opts.bpm <= 0) {
    return { frames: [], verfahren: vorgabe.verfahren, hinweise: ["Ohne Tempo gibt es kein Raster — erst das Lied analysieren."] };
  }

  if (vorgabe.verfahren === "pausen") {
    const frames = pausenMarken(spur, { maxMarken });
    if (frames.length) {
      hinweise.push(`${frames.length} Phrasengrenze(n) an den Pausen gefunden.`);
      return { frames, verfahren: "pausen", hinweise };
    }
    // Ein durchgesungener Vocal-Stem hat keine Pausen. Dann ist das Raster
    // nicht falsch, es ist nur das Einzige, was bleibt — und das gehoert gesagt.
    hinweise.push("Keine Pausen gefunden — die Spur klingt durch. Geschnitten wird nach Klangwechsel.");
    const frames2 = novitaetsMarken(spur, { ...opts, takte, maxMarken });
    return { frames: frames2, verfahren: "novitaet", hinweise };
  }

  if (vorgabe.verfahren === "raster") {
    const frames = anschlagRaster(spur, { ...opts, takte });
    hinweise.push(`${frames.length} Marke(n) auf dem Taktraster, auf den Anschlag gelegt.`);
    return { frames, verfahren: "raster", hinweise };
  }

  const frames = novitaetsMarken(spur, { ...opts, takte, maxMarken });
  if (!frames.length) hinweise.push("Kein deutlicher Klangwechsel gefunden — die Spur bleibt am Stueck.");
  else hinweise.push(`${frames.length} Klangwechsel gefunden (von ${rasterMarken(spur.pcm.length, spur.sampleRate, opts.bpm, takte).length} Taktgrenzen).`);
  return { frames, verfahren: "novitaet", hinweise };
}

/** Mehrere Marken auf einmal setzen — jede geht durch dieselbe Pruefung wie ein Klick. */
export function setzeMarken(spur: Spur, frames: readonly number[], opts: { ersetzen?: boolean } = {}): void {
  if (opts.ersetzen) spur.marken = [];
  for (const f of frames) setzeMarke(spur, f, { schnappen: false });
}

/** Das Klangprofil einer ganzen Spur — fuer die Zeile unter dem Spurnamen. */
export function spurProfil(spur: Spur, bpm?: number): Klangprofil {
  return klangProfil(spur.pcm, spur.sampleRate, bpm ? { bpm } : {});
}

/** Was unter der Spur steht: gemessene Kennzahlen in Worten. */
export function spurText(spur: Spur, bpm?: number): string {
  return profilText(spurProfil(spur, bpm));
}
