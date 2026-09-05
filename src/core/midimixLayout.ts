/**
 * midimixLayout — ein Akai MIDImix als Mischpult fuer das Geraet: jeder
 * Regler und jeder Fader zeigt auf einen Part und einen Parameter (oder
 * einen Effekt), die Tasten spielen Parts an oder schalten sie stumm.
 *
 * Nutzerwunsch 2026-09-05: „das MIDImix-Layout, dass man die Knobs den
 * jeweiligen Parts und Effekten zuweisen kann“. Bisher gab es nur die
 * Live-FX-Belegung (24 Regler → 24 FX-Parameter EINES Ziels). Hier ist die
 * Belegung frei: acht Spalten mit je drei Reglern, einem Fader und zwei
 * Tasten, dazu der Master-Fader.
 *
 * Werkseinstellung des MIDImix (Kanal 1): Regler-Zeilen 16/17/18, 20/21/22,
 * 24/25/26, 28/29/30, 46/47/48, 50/51/52, 54/55/56, 58/59/60; Fader 19, 23,
 * 27, 31, 49, 53, 57, 61; Master 62; Mute-Tasten Noten 1, 4, 7 … 22;
 * Rec-Arm-Tasten 3, 6, 9 … 24 (Solo ueber Shift 2, 5 … 23).
 *
 * Was ans Geraet geht: Part-Parameter als Stock-CC auf dem Part-Kanal
 * (`e2KnobCc`, geraetegemessen), Master-FX X/Y als CC 102/103 auf dem
 * Global-Kanal, FX-Parameter als Hacktribe-NRPN (`hacktribeNrpn`). Mutes
 * nimmt das Geraet NICHT per Panel-NRPN — die laufen ueber den lokalen
 * Part-Mute und die Edit-Buffer-Uebertragung (siehe Pad-Deck).
 */
import { buildKnobCc, ccValueToParam, KNOB_CCS } from "./e2KnobCc";
import { buildMfxCc, buildNoteOn, buildNoteOff, buildSchalterCc } from "./e2Remote";
import { buildSetFxParam, fxSlotForPart, MFX_SLOT } from "./hacktribeNrpn";

export const MIDIMIX = {
  kanal0: 0,
  spalten: 8,
  knobs: [
    [16, 17, 18],
    [20, 21, 22],
    [24, 25, 26],
    [28, 29, 30],
    [46, 47, 48],
    [50, 51, 52],
    [54, 55, 56],
    [58, 59, 60],
  ] as readonly (readonly [number, number, number])[],
  fader: [19, 23, 27, 31, 49, 53, 57, 61] as readonly number[],
  master: 62,
  mute: [1, 4, 7, 10, 13, 16, 19, 22] as readonly number[],
  solo: [2, 5, 8, 11, 14, 17, 20, 23] as readonly number[],
  rec: [3, 6, 9, 12, 15, 18, 21, 24] as readonly number[],
} as const;

/** Wohin ein Regler zeigt. */
export type ReglerZiel =
  | { art: "part"; part: number; key: string }
  | { art: "fx"; part: number; slot: 0 | 1; param: number }
  | { art: "mfx"; was: "x" | "y" }
  | { art: "mfxParam"; param: number }
  | null;

/** Was eine Taste tut. */
export type TastenZiel = { art: "trigger"; part: number } | { art: "mute"; part: number } | { art: "ifx"; part: number } | null;

export interface MidimixSpalte {
  knobs: [ReglerZiel, ReglerZiel, ReglerZiel];
  fader: ReglerZiel;
  mute: TastenZiel;
  rec: TastenZiel;
}

export interface MidimixLayout {
  version: 1;
  name: string;
  spalten: MidimixSpalte[];
  master: ReglerZiel;
}

/** Regler-Keys, die das Geraet per Stock-CC annimmt (aus e2KnobCc). */
export const PART_KEYS: readonly { key: string; label: string }[] = [...KNOB_CCS.values()].map((k) => ({ key: k.key, label: k.label }));

const partZiel = (part: number, key: string): ReglerZiel => ({ art: "part", part, key });

/** Mischpult: Spalte i = Part vonPart+i; Regler Cutoff / Resonance / IFX Edit, Fader Level, Master = MFX X. */
export function layoutMixer(vonPart = 1, name = `Mixer Parts ${vonPart}–${vonPart + 7}`): MidimixLayout {
  return {
    version: 1,
    name,
    spalten: Array.from({ length: MIDIMIX.spalten }, (_, i) => {
      const part = vonPart + i;
      return {
        knobs: [partZiel(part, "cutoff"), partZiel(part, "resonance"), partZiel(part, "ifxEdit")],
        fader: partZiel(part, "volume"),
        mute: { art: "mute", part },
        rec: { art: "trigger", part },
      };
    }),
    master: { art: "mfx", was: "x" },
  };
}

/** Klang: Regler Cutoff / Mod Depth / Decay, Fader Level. */
export function layoutKlang(vonPart = 1): MidimixLayout {
  const l = layoutMixer(vonPart, `Klang Parts ${vonPart}–${vonPart + 7}`);
  l.spalten.forEach((s, i) => {
    const part = vonPart + i;
    s.knobs = [partZiel(part, "cutoff"), partZiel(part, "modDepth"), partZiel(part, "egDecay")];
  });
  return l;
}

/** FX: Regler = FX-Parameter 0/1/2 des IFX 1 je Part (Hacktribe-NRPN), Fader Level, Master = MFX-Parameter 0. */
export function layoutFx(vonPart = 1): MidimixLayout {
  const l = layoutMixer(vonPart, `FX Parts ${vonPart}–${vonPart + 7}`);
  l.spalten.forEach((s, i) => {
    const part = vonPart + i;
    s.knobs = [
      { art: "fx", part, slot: 0, param: 0 },
      { art: "fx", part, slot: 0, param: 1 },
      { art: "fx", part, slot: 0, param: 2 },
    ];
  });
  l.master = { art: "mfxParam", param: 0 };
  // Im FX-Layout schaltet die Mute-Taste den IFX des Parts, nicht den Part (Nutzerwunsch 2026-09-05)
  l.spalten.forEach((s, i) => (s.mute = { art: "ifx", part: vonPart + i }));
  return l;
}

export const LAYOUT_VORGABEN: readonly { id: string; name: string; bau: () => MidimixLayout }[] = [
  { id: "mixer1", name: "Mixer Parts 1–8", bau: () => layoutMixer(1) },
  { id: "mixer9", name: "Mixer Parts 9–16", bau: () => layoutMixer(9) },
  { id: "klang1", name: "Klang Parts 1–8", bau: () => layoutKlang(1) },
  { id: "klang9", name: "Klang Parts 9–16", bau: () => layoutKlang(9) },
  { id: "fx1", name: "FX Parts 1–8 (Hacktribe)", bau: () => layoutFx(1) },
  { id: "fx9", name: "FX Parts 9–16 (Hacktribe)", bau: () => layoutFx(9) },
];

export interface ReglerOrt {
  spalte: number;
  was: "knob1" | "knob2" | "knob3" | "fader" | "master";
}

/** Welcher Regler ist das? null, wenn die CC-Nummer keinem MIDImix-Regler gehoert. */
export function reglerOrt(cc: number): ReglerOrt | null {
  if (cc === MIDIMIX.master) return { spalte: -1, was: "master" };
  for (let s = 0; s < MIDIMIX.spalten; s++) {
    const k = MIDIMIX.knobs[s].indexOf(cc);
    if (k >= 0) return { spalte: s, was: (["knob1", "knob2", "knob3"] as const)[k] };
    if (MIDIMIX.fader[s] === cc) return { spalte: s, was: "fader" };
  }
  return null;
}

/** Welche Taste ist das? */
export function tastenOrt(note: number): { spalte: number; was: "mute" | "rec" | "solo" } | null {
  for (let s = 0; s < MIDIMIX.spalten; s++) {
    if (MIDIMIX.mute[s] === note) return { spalte: s, was: "mute" };
    if (MIDIMIX.rec[s] === note) return { spalte: s, was: "rec" };
    if (MIDIMIX.solo[s] === note) return { spalte: s, was: "solo" };
  }
  return null;
}

export function zielAnOrt(layout: MidimixLayout, ort: ReglerOrt): ReglerZiel {
  if (ort.was === "master") return layout.master;
  const sp = layout.spalten[ort.spalte];
  if (!sp) return null;
  if (ort.was === "fader") return sp.fader;
  return sp.knobs[ort.was === "knob1" ? 0 : ort.was === "knob2" ? 1 : 2];
}

export function setzeZiel(layout: MidimixLayout, ort: ReglerOrt, ziel: ReglerZiel): void {
  if (ort.was === "master") {
    layout.master = ziel;
    return;
  }
  const sp = layout.spalten[ort.spalte];
  if (!sp) return;
  if (ort.was === "fader") sp.fader = ziel;
  else sp.knobs[ort.was === "knob1" ? 0 : ort.was === "knob2" ? 1 : 2] = ziel;
}

/** MIDI-Bytes fuer einen Reglerwert 0…127 — leer, wenn das Ziel nichts sendet. */
export function reglerNachrichten(ziel: ReglerZiel, wert: number, globalKanal0: number): Uint8Array[] {
  const v = Math.max(0, Math.min(127, Math.round(wert)));
  if (!ziel) return [];
  switch (ziel.art) {
    case "part": {
      const m = buildKnobCc(ziel.part - 1, ziel.key, ccValueToParam(ziel.key, v));
      return m ? [m] : [];
    }
    case "mfx":
      return [buildMfxCc(globalKanal0, ziel.was, v)];
    case "fx":
      return buildSetFxParam(globalKanal0, fxSlotForPart(ziel.part, ziel.slot), ziel.param, v).map((t) => Uint8Array.from(t));
    case "mfxParam":
      return buildSetFxParam(globalKanal0, MFX_SLOT, ziel.param, v).map((t) => Uint8Array.from(t));
  }
}

/** Note-On/Off fuer eine Trigger-Taste (Part-Kanal, Note 60). */
export function tastenNachrichten(ziel: TastenZiel, an: boolean): Uint8Array[] {
  if (!ziel || ziel.art !== "trigger") return [];
  return [an ? buildNoteOn(ziel.part - 1, 60, 110) : buildNoteOff(ziel.part - 1, 60)];
}

/** IFX an/aus als Stock-CC auf dem Part-Kanal (Schalter-CC, geraetebestaetigt). */
export function ifxSchalterNachricht(ziel: TastenZiel, an: boolean): Uint8Array | null {
  if (!ziel || ziel.art !== "ifx") return null;
  return buildSchalterCc(ziel.part - 1, "ifxOn", an);
}

export function beschreibeZiel(z: ReglerZiel | TastenZiel): string {
  if (!z) return "—";
  switch (z.art) {
    case "part":
      return `Part ${z.part} · ${PART_KEYS.find((k) => k.key === z.key)?.label ?? z.key}`;
    case "fx":
      return `Part ${z.part} · IFX ${z.slot + 1} · Param ${z.param}`;
    case "mfx":
      return `Master-FX ${z.was.toUpperCase()}`;
    case "mfxParam":
      return `Master-FX · Param ${z.param}`;
    case "trigger":
      return `Part ${z.part} anspielen`;
    case "mute":
      return `Part ${z.part} stumm`;
    case "ifx":
      return `Part ${z.part} IFX an/aus`;
  }
}

/** Ziel als kurzer Text („p3:cutoff“, „fx3:0:2“, „mfx:x“, „mfxp:0“, „trig:3“, „mute:3“) — fuer Auswahlmenues. */
export function zielWert(z: ReglerZiel | TastenZiel): string {
  if (!z) return "";
  switch (z.art) {
    case "part":
      return `p${z.part}:${z.key}`;
    case "fx":
      return `fx${z.part}:${z.slot}:${z.param}`;
    case "mfx":
      return `mfx:${z.was}`;
    case "mfxParam":
      return `mfxp:${z.param}`;
    case "trigger":
      return `trig:${z.part}`;
    case "mute":
      return `mute:${z.part}`;
    case "ifx":
      return `ifx:${z.part}`;
  }
}

export function reglerZielAus(wert: string): ReglerZiel {
  let m: RegExpExecArray | null;
  if ((m = /^p(\d+):([A-Za-z]+)$/.exec(wert))) return { art: "part", part: Number(m[1]), key: m[2] };
  if ((m = /^fx(\d+):([01]):(\d+)$/.exec(wert))) return { art: "fx", part: Number(m[1]), slot: Number(m[2]) as 0 | 1, param: Number(m[3]) };
  if ((m = /^mfx:([xy])$/.exec(wert))) return { art: "mfx", was: m[1] as "x" | "y" };
  if ((m = /^mfxp:(\d+)$/.exec(wert))) return { art: "mfxParam", param: Number(m[1]) };
  return null;
}

export function tastenZielAus(wert: string): TastenZiel {
  let m: RegExpExecArray | null;
  if ((m = /^trig:(\d+)$/.exec(wert))) return { art: "trigger", part: Number(m[1]) };
  if ((m = /^mute:(\d+)$/.exec(wert))) return { art: "mute", part: Number(m[1]) };
  if ((m = /^ifx:(\d+)$/.exec(wert))) return { art: "ifx", part: Number(m[1]) };
  return null;
}

export function serialisiereLayout(l: MidimixLayout): string {
  return JSON.stringify(l);
}

/** Aus JSON, mit Pruefung — Unbrauchbares wird zum Mixer-Layout. */
export function deserialisiereLayout(quelle: string | unknown): MidimixLayout {
  try {
    const o = (typeof quelle === "string" ? JSON.parse(quelle) : quelle) as Partial<MidimixLayout> | null;
    if (!o || o.version !== 1 || !Array.isArray(o.spalten) || o.spalten.length !== MIDIMIX.spalten) return layoutMixer(1);
    const regler = (z: unknown): ReglerZiel => (z && typeof z === "object" ? reglerZielAus(zielWert(z as ReglerZiel)) : null);
    const taste = (z: unknown): TastenZiel => (z && typeof z === "object" ? tastenZielAus(zielWert(z as TastenZiel)) : null);
    return {
      version: 1,
      name: typeof o.name === "string" ? o.name.slice(0, 40) : "Layout",
      spalten: o.spalten.map((s) => ({
        knobs: [regler(s?.knobs?.[0]), regler(s?.knobs?.[1]), regler(s?.knobs?.[2])],
        fader: regler(s?.fader),
        mute: taste(s?.mute),
        rec: taste(s?.rec),
      })),
      master: regler(o.master),
    };
  } catch {
    return layoutMixer(1);
  }
}

/** Bank-Tasten des MIDImix (Noten): links 25, rechts 26 — sie blaettern durch die Vorgaben. */
export const MIDIMIX_BANK = { links: 25, rechts: 26 } as const;

/** Naechste bzw. vorige Vorgabe (zyklisch) — unbekannte oder eigene Layouts beginnen bei der ersten. */
export function naechsteVorgabeId(aktuell: string | null, richtung: 1 | -1): string {
  const ids = LAYOUT_VORGABEN.map((v) => v.id);
  const i = aktuell ? ids.indexOf(aktuell) : -1;
  if (i < 0) return richtung === 1 ? ids[0] : ids[ids.length - 1];
  return ids[(i + richtung + ids.length) % ids.length];
}

/** Vorgabe-ID zu einem Layout-Namen (fuer Bank-Tasten und Anzeige), null bei eigenem Layout. */
export function vorgabeIdVon(layout: MidimixLayout): string | null {
  return LAYOUT_VORGABEN.find((v) => v.name === layout.name)?.id ?? null;
}

/** Zustand je Part (Index = Part−1) fuer die LEDs. */
export interface LedZustand {
  muted: readonly boolean[];
  /** IFX an je Part — fuer Tasten mit Ziel „ifx“. */
  ifxOn?: readonly boolean[];
}

/**
 * LED-Nachrichten an den MIDImix: Mute-LED an, wenn der zugeordnete Part
 * stumm ist (bzw. sein IFX an ist, bei Ziel „ifx“) — Note-On 127, sonst
 * Note-On 0; Rec-LEDs aus.
 */
export function ledNachrichten(layout: MidimixLayout, zustand: LedZustand | readonly boolean[]): Uint8Array[] {
  const z: LedZustand = Array.isArray(zustand) ? { muted: zustand as readonly boolean[] } : (zustand as LedZustand);
  const out: Uint8Array[] = [];
  layout.spalten.forEach((sp, s) => {
    const m = sp.mute;
    const an = !!m && (m.art === "mute" ? !!z.muted[m.part - 1] : m.art === "ifx" ? !!z.ifxOn?.[m.part - 1] : false);
    out.push(new Uint8Array([0x90 | MIDIMIX.kanal0, MIDIMIX.mute[s], an ? 127 : 0]));
    out.push(new Uint8Array([0x90 | MIDIMIX.kanal0, MIDIMIX.rec[s], 0]));
  });
  return out;
}
