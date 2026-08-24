/**
 * midiImport.ts — Standard-MIDI-Dateien (SMF 0/1) lesen und auf
 * Editor-Patterns rastern (MKM-Angleich Paket 3).
 *
 * Der Parser wirft bei kaputten Dateien mit Byte-Position, statt halbe
 * Ergebnisse zu liefern. Rastern: 16tel-Quantisierung, bis zu 4 Toene je
 * Step (Akkord-Plaetze des Geraets), 4-Takt-Fenster als einzelne Patterns.
 */

import {
  createPattern,
  EDITOR_DEFAULT_GATE,
  EDITOR_GATE_MAX,
  type EditorPattern,
} from "./editorModel";

export interface SmfNote {
  tick: number;
  dauer: number;
  /** MIDI 0..127. */
  note: number;
  velocity: number;
  /** 0-basiert (Kanal 10 der Praxis = 9). */
  kanal: number;
}

export interface SmfSpur {
  name: string;
  /** Haeufigster Kanal der Spur (0-basiert). */
  kanal: number;
  programm: number | null;
  noten: SmfNote[];
}

export interface SmfLied {
  format: number;
  ticksProViertel: number;
  /** Erstes Tempo der Datei (Standard 120). */
  bpm: number;
  spuren: SmfSpur[];
}

class Leser {
  pos = 0;
  constructor(private b: Uint8Array) {}
  fehlt(n: number): boolean {
    return this.pos + n > this.b.length;
  }
  u8(): number {
    if (this.fehlt(1)) throw new Error(`SMF endet unerwartet bei Byte ${this.pos}`);
    return this.b[this.pos++];
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u32(): number {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  vlq(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error(`SMF: Laengenangabe zu lang bei Byte ${this.pos}`);
  }
  text(n: number): string {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
  magic(erwartet: string): void {
    const start = this.pos;
    if (this.fehlt(4) || this.text(4) !== erwartet)
      throw new Error(`SMF: "${erwartet}" fehlt bei Byte ${start}`);
  }
}

/** SMF 0/1 lesen; Format 0 mit mehreren Kanaelen wird in Pseudo-Spuren geteilt. */
export function parseSmf(bytes: Uint8Array): SmfLied {
  const r = new Leser(bytes);
  r.magic("MThd");
  const kopfLen = r.u32();
  if (kopfLen < 6) throw new Error(`SMF: Header-Laenge ${kopfLen} bei Byte ${r.pos}`);
  const format = r.u16();
  const spurZahl = r.u16();
  const division = r.u16();
  r.pos += kopfLen - 6;
  if (division & 0x8000) throw new Error("SMF: SMPTE-Zeitbasis wird nicht unterstuetzt");
  if (division === 0) throw new Error("SMF: Zeitbasis 0");
  let bpm = 120;
  let bpmGefunden = false;
  const spuren: SmfSpur[] = [];

  for (let t = 0; t < spurZahl; t++) {
    r.magic("MTrk");
    const len = r.u32();
    const ende = r.pos + len;
    if (ende > bytes.length) throw new Error(`SMF: Spur ${t} laenger als die Datei (Byte ${r.pos})`);
    let tick = 0;
    let status = 0;
    let name = "";
    let programm: number | null = null;
    const noten: SmfNote[] = [];
    const offen = new Map<string, { tick: number; velocity: number }>();
    const kanalZaehler = new Map<number, number>();

    const notenEnde = (kanal: number, note: number, endTick: number): void => {
      const key = `${kanal}:${note}`;
      const start = offen.get(key);
      if (!start) return;
      offen.delete(key);
      noten.push({ tick: start.tick, dauer: Math.max(1, endTick - start.tick), note, velocity: start.velocity, kanal });
    };

    while (r.pos < ende) {
      tick += r.vlq();
      let b = r.u8();
      if (b === 0xff) {
        const typ = r.u8();
        const dl = r.vlq();
        if (typ === 0x51 && dl === 3) {
          const us = (r.u8() << 16) | (r.u8() << 8) | r.u8();
          if (!bpmGefunden && us > 0) {
            bpm = 60000000 / us;
            bpmGefunden = true;
          }
        } else if (typ === 0x03 && !name) {
          name = r.text(dl).replace(/[^\x20-\x7e]/g, "").trim();
        } else {
          r.pos += dl;
        }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        r.pos += r.vlq();
        continue;
      }
      if (b & 0x80) {
        status = b;
        b = r.u8();
      } else if (!status) {
        throw new Error(`SMF: Datenbyte ohne Status bei Byte ${r.pos - 1}`);
      }
      const art = status & 0xf0;
      const kanal = status & 0x0f;
      kanalZaehler.set(kanal, (kanalZaehler.get(kanal) ?? 0) + 1);
      if (art === 0x90) {
        const vel = r.u8();
        if (vel > 0) offen.set(`${kanal}:${b}`, { tick, velocity: vel });
        else notenEnde(kanal, b, tick);
      } else if (art === 0x80) {
        r.u8();
        notenEnde(kanal, b, tick);
      } else if (art === 0xc0) {
        if (programm === null) programm = b;
      } else if (art === 0xd0) {
        // Channel Pressure: nur das eine Datenbyte
      } else if (art === 0xa0 || art === 0xb0 || art === 0xe0) {
        r.u8();
      } else {
        throw new Error(`SMF: unbekannter Status 0x${status.toString(16)} bei Byte ${r.pos - 1}`);
      }
    }
    // haengende Noten am Spurende schliessen
    for (const key of [...offen.keys()]) {
      const [k, n] = key.split(":").map(Number);
      notenEnde(k, n, tick);
    }
    r.pos = ende;
    noten.sort((a, b2) => a.tick - b2.tick || a.note - b2.note);
    let kanalTop = 0;
    let max = -1;
    for (const [k, z] of kanalZaehler) if (z > max) [kanalTop, max] = [k, z];
    spuren.push({ name, kanal: kanalTop, programm, noten });
  }

  // Format 0: eine Spur, viele Kanaele -> je Kanal eine Pseudo-Spur
  const roh = { format, ticksProViertel: division, bpm, spuren };
  if (format === 0 && spuren.length === 1) {
    const kanaele = [...new Set(spuren[0].noten.map((n) => n.kanal))].sort((a, b) => a - b);
    if (kanaele.length > 1) {
      roh.spuren = kanaele.map((k) => ({
        name: spuren[0].name ? `${spuren[0].name} K${k + 1}` : `Kanal ${k + 1}`,
        kanal: k,
        programm: spuren[0].programm,
        noten: spuren[0].noten.filter((n) => n.kanal === k),
      }));
    }
  }
  return roh;
}

// ─── Rastern ─────────────────────────────────────────────────────────────────

export interface RasterNote {
  /** 16tel-Step ab Liedanfang. */
  step: number;
  note: number;
  velocity: number;
  /** Editor-Gate 1..96 (96 = Tie). */
  gate: number;
}

/**
 * Noten auf 16tel quantisieren. Gate: ein Step entspricht 24 Gate-Einheiten
 * (Standard-Gate 72 = 3 Steps Ausklang); ab 4 Steps Dauer wird gebunden (96).
 */
export function rasterisiere(noten: readonly SmfNote[], ticksProViertel: number): RasterNote[] {
  const t16 = ticksProViertel / 4;
  return noten.map((n) => {
    const steps = n.dauer / t16;
    const gate = steps >= 4 ? EDITOR_GATE_MAX : Math.min(EDITOR_GATE_MAX, Math.max(6, Math.round(steps * 24)) || EDITOR_DEFAULT_GATE);
    return { step: Math.round(n.tick / t16), note: n.note, velocity: Math.max(1, Math.min(127, n.velocity)), gate };
  });
}

/** Note im Piano Roll verschieben: Steps im 16tel-Raster, Halbtoene geklemmt. */
export function verschiebeNote(n: SmfNote, dSteps: number, dHalbtoene: number, ticksProViertel: number): void {
  const t16 = ticksProViertel / 4;
  n.tick = Math.max(0, n.tick + Math.round(dSteps) * t16);
  n.note = Math.max(0, Math.min(127, n.note + Math.round(dHalbtoene)));
}

// ─── Fenster → Editor-Patterns ───────────────────────────────────────────────

export interface SpurZuordnung {
  spurIndex: number;
  /** Ziel-Part 0..15. */
  part: number;
}

export interface MidiBauOptionen {
  bpm: number;
  stepLength: 16 | 32 | 64;
  namensBasis: string;
}

export const MIDI_PATTERN_MAX = 16;

/** Zugeordnete Spuren in 16tel rastern und in Pattern-Fenster schneiden. */
export function baueMidiPatterns(
  lied: Pick<SmfLied, "ticksProViertel" | "spuren">,
  zuordnung: readonly SpurZuordnung[],
  opts: MidiBauOptionen,
): { patterns: EditorPattern[]; hinweise: string[] } {
  const hinweise: string[] = [];
  const raster = zuordnung
    .filter((z) => z.part >= 0 && z.part < 16 && lied.spuren[z.spurIndex])
    .map((z) => ({ ...z, noten: rasterisiere(lied.spuren[z.spurIndex].noten, lied.ticksProViertel) }));
  const letzterStep = Math.max(-1, ...raster.flatMap((r) => r.noten.map((n) => n.step)));
  if (letzterStep < 0) return { patterns: [], hinweise: ["keine Noten in den zugeordneten Spuren"] };

  let fensterZahl = Math.floor(letzterStep / opts.stepLength) + 1;
  if (fensterZahl > MIDI_PATTERN_MAX) {
    hinweise.push(
      `Lied ist laenger als ${MIDI_PATTERN_MAX} Pattern-Fenster — auf ${MIDI_PATTERN_MAX} gekuerzt (Rest faellt weg).`,
    );
    fensterZahl = MIDI_PATTERN_MAX;
  }

  const patterns: EditorPattern[] = [];
  for (let f = 0; f < fensterZahl; f++) {
    const p = createPattern(`${opts.namensBasis} ${f + 1}`.slice(0, 16));
    p.bpm = opts.bpm;
    p.stepLength = opts.stepLength;
    let leer = true;
    for (const r of raster) {
      const part = p.parts[r.part];
      part.label = (lied.spuren[r.spurIndex].name || part.label).slice(0, 12);
      for (const n of r.noten) {
        const lokal = n.step - f * opts.stepLength;
        if (lokal < 0 || lokal >= opts.stepLength) continue;
        leer = false;
        const step = part.steps[lokal];
        if (!step.on) {
          step.on = true;
          step.note = n.note;
          step.velocity = n.velocity;
          step.gate = n.gate;
        } else {
          const weitere = step.notes ?? [];
          if (weitere.length < 3 && step.note !== n.note && !weitere.includes(n.note)) {
            step.notes = [...weitere, n.note];
          }
          step.velocity = Math.max(step.velocity, n.velocity);
        }
      }
    }
    if (!leer || f < fensterZahl - 1) patterns.push(p);
  }
  const drums = zuordnung.filter((z) => lied.spuren[z.spurIndex]?.kanal === 9);
  if (drums.length) hinweise.push("Kanal-10-Spur(en) landen einstimmig auf ihrem Part — im Editor weiterverteilen.");
  return { patterns, hinweise };
}
