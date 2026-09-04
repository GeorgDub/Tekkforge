/**
 * besetzung — welches Sample auf welchen Part, EINMAL fuer alle Patterns.
 *
 * Nutzerwunsch 2026-09-05: nach dem Ordner-Scan eine Liste, in der man Kick,
 * Snare, Hats usw. fuer alle Patterns gemeinsam zuweist, statt hinterher in
 * jedem Pattern einzeln. Das Rezept traegt die Besetzung ohnehin (`Thema`):
 * hier wird sie aus Nutzerwahlen ueberschrieben, bevor die Patterns gebaut
 * werden. Leere Felder bleiben, was der Planer vorschlaegt.
 *
 * Reine Funktionen auf Rezept und Projekt, ohne DOM.
 */
import type { Projekt, ProjektSample } from "./bankPlan";
import { pools, type Rezept, type Thema } from "./rezept";
import type { Rolle } from "./sampleScan";

/** Ein Feld je Part-Rolle; Werte sind Sample-Namen aus dem Projekt, leer = automatisch. */
export interface Besetzung {
  kick?: string;
  snare?: string;
  clap?: string;
  hat1?: string;
  hat2?: string;
  perc1?: string;
  perc2?: string;
  bass?: string;
  stab?: string;
  shot1?: string;
  shot2?: string;
  riser?: string;
  melo?: string;
  vers?: string;
}

export interface BesetzungFeld {
  key: keyof Besetzung;
  label: string;
  /** Part-Nummer im festen Layout (1-basiert), zur Anzeige. */
  part: string;
  /** Rollen, die im Auswahlmenue zuerst stehen; alles andere folgt unter „andere“. */
  rollen: Rolle[];
  /** Nur Schleifen (Melodie, Vocal) bzw. nur One-Shots. */
  art?: "loop" | "oneshot";
}

export const BESETZUNG_FELDER: readonly BesetzungFeld[] = [
  { key: "kick", label: "Kick (Familie)", part: "1–2", rollen: ["kick"], art: "oneshot" },
  { key: "snare", label: "Snare", part: "3", rollen: ["snare", "perc"], art: "oneshot" },
  { key: "clap", label: "Clap", part: "4", rollen: ["clap", "snare"], art: "oneshot" },
  { key: "hat1", label: "Hat geschlossen", part: "5", rollen: ["hat"], art: "oneshot" },
  { key: "hat2", label: "Hat offen", part: "6", rollen: ["hat"], art: "oneshot" },
  { key: "perc1", label: "Perc 1", part: "7", rollen: ["perc", "hat", "ton"], art: "oneshot" },
  { key: "perc2", label: "Perc 2", part: "8", rollen: ["perc", "hat", "ton"], art: "oneshot" },
  { key: "bass", label: "Bass", part: "9", rollen: ["bass", "kick", "ton"] },
  { key: "stab", label: "Stab", part: "10", rollen: ["ton", "melo"] },
  { key: "shot1", label: "Shot A", part: "11", rollen: ["fx", "ton", "vox"] },
  { key: "shot2", label: "Shot B / Riser", part: "12", rollen: ["fx", "ton", "vox"] },
  { key: "melo", label: "Melodie", part: "13", rollen: ["melo"], art: "loop" },
  { key: "vers", label: "Vocal", part: "16", rollen: ["vox"], art: "loop" },
];

/** Kandidaten fuer ein Feld: passende Rollen zuerst, dann alles andere. */
export function besetzungKandidaten(projekt: Projekt, feld: BesetzungFeld): { passend: ProjektSample[]; andere: ProjektSample[] } {
  const passend: ProjektSample[] = [];
  const andere: ProjektSample[] = [];
  for (const s of projekt.samples) {
    const rolleOk = feld.rollen.includes(s.rolle);
    const artOk = !feld.art || s.kind === feld.art;
    (rolleOk && artOk ? passend : andere).push(s);
  }
  return { passend, andere };
}

/** Die Besetzung, die ein Rezept gerade traegt — zum Vorbelegen der Auswahl. */
export function besetzungAusThema(t: Thema, projekt: Projekt): Besetzung {
  const fam = pools(projekt).familien.find((f) => f.name === t.kickFamilie);
  return {
    kick: fam?.kicks[0]?.name,
    snare: t.snare,
    clap: t.clap,
    hat1: t.hats?.[0],
    hat2: t.hats?.[1],
    perc1: t.percs?.[0],
    perc2: t.percs?.[1],
    bass: t.bass,
    stab: t.stab,
    shot1: t.shots?.[0],
    shot2: t.shots?.[1],
    riser: t.riser,
    melo: t.melo,
    vers: t.vers,
  };
}

/**
 * Die Nutzerwahlen ins Rezept legen. Unbekannte Namen werden ignoriert (und
 * gemeldet), leere Felder lassen den Vorschlag stehen. Die Kick-Familie
 * ergibt sich aus dem gewaehlten Kick-Sample; hat es keine Familie mit zwei
 * Kicks, wird eine aus ihm allein gebildet (patternGen fuellt Kick 2 nach).
 */
export function wendeBesetzungAn(rezept: Rezept, besetzung: Besetzung, projekt: Projekt): { rezept: Rezept; unbekannt: string[] } {
  const unbekannt: string[] = [];
  const name = (n?: string): string | undefined => {
    if (!n) return undefined;
    const s = projekt.samples.find((x) => x.name === n);
    if (!s) unbekannt.push(n);
    return s?.name;
  };
  const t: Thema = { ...rezept.thema, hats: [...rezept.thema.hats] as [string, string] };
  const kick = name(besetzung.kick);
  if (kick) {
    const pl = pools(projekt);
    const fam = pl.familien.find((f) => f.kicks.some((k) => k.name === kick));
    t.kickFamilie = fam ? fam.name : (projekt.samples.find((s) => s.name === kick)?.familie ?? t.kickFamilie);
  }
  const snare = name(besetzung.snare);
  if (snare) t.snare = snare;
  const clap = name(besetzung.clap);
  if (clap) t.clap = clap;
  const h1 = name(besetzung.hat1);
  const h2 = name(besetzung.hat2);
  if (h1 || h2) t.hats = [h1 ?? t.hats[0], h2 ?? t.hats[1]];
  const p1 = name(besetzung.perc1);
  const p2 = name(besetzung.perc2);
  if (p1 || p2) t.percs = [p1 ?? t.percs?.[0] ?? "", p2 ?? t.percs?.[1] ?? ""];
  const bass = name(besetzung.bass);
  if (bass) t.bass = bass;
  const stab = name(besetzung.stab);
  if (stab) t.stab = stab;
  const s1 = name(besetzung.shot1);
  const s2 = name(besetzung.shot2);
  if (s1 || s2) t.shots = [s1 ?? t.shots?.[0] ?? "", s2 ?? t.shots?.[1] ?? ""];
  const riser = name(besetzung.riser);
  if (riser) t.riser = riser;
  const melo = name(besetzung.melo);
  if (melo) t.melo = melo;
  const vers = name(besetzung.vers);
  if (vers) t.vers = vers;
  return { rezept: { ...rezept, thema: t }, unbekannt };
}

/** Steht ueberhaupt etwas drin? */
export function besetzungLeer(b: Besetzung): boolean {
  return !Object.values(b).some((v) => !!v);
}
