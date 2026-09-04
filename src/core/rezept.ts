/**
 * rezept — das Arrangement-Rezept zwischen Planer (Regeln oder KI) und
 * patternGen. Die KI liefert genau dieses JSON; pruefeRezept macht aus
 * jeder Antwort ein gueltiges Rezept (feldweise Ersatz + Korrekturliste).
 */
import type { Projekt, ProjektSample } from "./bankPlan";
import { klangWaehler, figurAusDichte, dichteText } from "./klangWahl";

export type Modus = "jam" | "miniset" | "promelo";
export type KickFigur = "vier" | "hart" | "roll" | "galopp";
export type BassFigur = "off" | "roll" | "acht";
export type StabFigur = "ruhig" | "stab" | "arp" | "frage";
export type Lage = "melo" | "vers" | "bass" | "stab" | "shot" | "riser";
export const KICK_FIGUREN: KickFigur[] = ["vier", "hart", "roll", "galopp"];
export const BASS_FIGUREN: BassFigur[] = ["off", "roll", "acht"];
export const STAB_FIGUREN: StabFigur[] = ["ruhig", "stab", "arp", "frage"];
export const LAGEN: Lage[] = ["melo", "vers", "bass", "stab", "shot", "riser"];

export interface Thema {
  melo?: string;
  vers?: string;
  kickFamilie: string;
  snare: string;
  clap?: string;
  hats: [string, string];
  percs?: [string, string];
  bass?: string;
  stab?: string;
  shots?: [string, string];
  riser?: string;
}
export interface Abschnitt {
  name: string;
  wiederholungen: number;
  intensitaet: 1 | 2 | 3 | 4 | 5;
  kick: KickFigur;
  lagen: Lage[];
}
/**
 * Wie voll ein Pattern gebaut wird.
 *
 * "schlank" ist die Vorgabe und entstand aus einem Nutzerbefund (2026-08-26):
 * die Patterns waren "ueberladen und anstrengend zu hoeren". Nachgemessen lag
 * auf JEDEM der 64 Sechzehntel mindestens ein Schlag — nirgends Luft. Schlank
 * duennt die offene HiHat aus, nimmt den Clap von der Snare herunter und gibt
 * der Kick einen eigenen vierten Takt.
 *
 * "voll" ist der alte, dichte Satz — als Rueckweg, falls es am Geraet doch
 * anders klingt als am Bildschirm gerechnet.
 */
export type Dichte = "schlank" | "voll";

export interface Rezept {
  modus: Modus;
  bpm: number;
  begruendung: string;
  thema: Thema;
  abschnitte: Abschnitt[];
  figuren: { bass: BassFigur; stab: StabFigur; hatsOffbeat: boolean; dichte?: Dichte };
}

// ── Pools ──────────────────────────────────────────────────────────────────
export interface Pools {
  kicks: ProjektSample[];
  familien: { name: string; kicks: ProjektSample[] }[];
  snares: ProjektSample[];
  claps: ProjektSample[];
  hatsClosed: ProjektSample[];
  hatsOpen: ProjektSample[];
  percs: ProjektSample[];
  stabs: ProjektSample[];
  basses: ProjektSample[];
  fxShots: ProjektSample[];
  fxLoops: ProjektSample[];
  voxShots: ProjektSample[];
  meloLoops: ProjektSample[];
  voxLoops: ProjektSample[];
}
const eigene = (l: ProjektSample[]) => (l.some((s) => s.gruppe !== "tekk") ? l.filter((s) => s.gruppe !== "tekk") : l);

export function pools(p: Projekt): Pools {
  const by = (r: ProjektSample["rolle"], kind?: "oneshot" | "loop") => p.samples.filter((s) => s.rolle === r && (!kind || s.kind === kind));
  const kicks = by("kick");
  const fam = new Map<string, ProjektSample[]>();
  for (const k of kicks) fam.set(k.familie, [...(fam.get(k.familie) ?? []), k]);
  const gross = [...fam.entries()]
    .filter(([, l]) => l.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, l]) => ({ name, kicks: l }));
  const einzel = [...fam.entries()].filter(([, l]) => l.length < 2).flatMap(([, l]) => l);
  for (let i = 0; i < einzel.length; i += 3) gross.push({ name: einzel[i].familie, kicks: einzel.slice(i, i + 3) });
  for (const f of gross) f.kicks.sort((a, b) => b.rmsDb - a.rmsDb);
  const snaresEigen = eigene(by("snare"));
  const snares = snaresEigen.length ? snaresEigen : by("perc");
  const hats = by("hat").slice().sort((a, b) => a.sekunden - b.sekunden);
  const hatsClosed = hats.filter((h) => h.sekunden < 0.3).length ? hats.filter((h) => h.sekunden < 0.3) : hats;
  const hatsOpen = hats.filter((h) => h.sekunden >= 0.18).length ? hats.filter((h) => h.sekunden >= 0.18).reverse() : hats;
  const tonsShort = by("ton").filter((t) => t.sekunden < 0.6);
  const tonsLong = by("ton").filter((t) => t.sekunden >= 0.6);
  const meloLoops = by("melo", "loop");
  const meloKurz = meloLoops.filter((m) => m.takte < 2 && !m.chunks);
  return {
    kicks,
    familien: gross,
    snares,
    claps: by("clap").length ? by("clap") : snares.slice(1).concat(snares.slice(0, 1)),
    hatsClosed,
    hatsOpen,
    percs: by("perc").concat(tonsShort, hats.slice(2)),
    stabs: tonsLong.concat(by("melo", "oneshot"), tonsShort, meloKurz),
    basses: by("bass"),
    fxShots: by("fx", "oneshot"),
    fxLoops: by("fx", "loop"),
    voxShots: by("vox", "oneshot"),
    meloLoops: meloLoops.filter((m) => m.takte >= 2 || m.chunks),
    voxLoops: by("vox", "loop"),
  };
}
const rot = <T>(l: T[], i: number): T | undefined => (l.length ? l[((i % l.length) + l.length) % l.length] : undefined);
const nm = (s?: ProjektSample) => s?.name;

/** Melodien als Themen-Kandidaten: Haelften A/B zaehlen als EIN Eintrag (A). */
export function meloKandidaten(pl: Pools): ProjektSample[] {
  return pl.meloLoops.filter((m) => m.chunk === undefined || m.chunk === 0);
}

// ── Regel-Planer ────────────────────────────────────────────────────────────
const MINISET: Abschnitt[] = [
  { name: "INTRO", wiederholungen: 2, intensitaet: 1, kick: "vier", lagen: ["melo"] },
  { name: "AUFBAU", wiederholungen: 2, intensitaet: 3, kick: "roll", lagen: ["melo", "bass", "riser"] },
  { name: "DROP 1", wiederholungen: 4, intensitaet: 5, kick: "hart", lagen: ["melo", "bass", "stab", "shot"] },
  { name: "BREAK", wiederholungen: 2, intensitaet: 2, kick: "vier", lagen: ["vers", "stab"] },
  { name: "DROP 2", wiederholungen: 4, intensitaet: 5, kick: "galopp", lagen: ["melo", "vers", "bass", "stab", "shot"] },
  { name: "OUTRO", wiederholungen: 2, intensitaet: 2, kick: "vier", lagen: ["melo", "bass"] },
];

/**
 * Aus einem Topf nur das nehmen, was zum selben Lied gehoert.
 *
 * Stammen die Samples aus mehreren Liedern, muessen Melodie und Vers aus
 * demselben stammen — sonst singt im SpongeBob-Block jemand anders. Genau das
 * ist passiert (Nutzerbefund am Geraet, 2026-08-29): der Vers wurde reihum aus
 * dem gemeinsamen Vocal-Topf gezogen, ohne Ruecksicht auf die Herkunft.
 *
 * Gibt es zum Lied nichts Passendes, bleibt der ganze Topf — ein fremdes Vocal
 * ist besser als ein stummer Vers, und bei einem Ein-Lied-Set aendert sich
 * ohnehin nichts.
 */
function ausLied(topf: ProjektSample[], melo?: ProjektSample): ProjektSample[] {
  if (!melo?.lied) return topf;
  const eigene = topf.filter((s) => s.lied === melo.lied);
  return eigene.length ? eigene : topf;
}

/**
 * Die Besetzung eines Themas — welche Kick, welche Snare, welche Hats.
 *
 * Der Zaehler `i` sorgt fuer Abwechslung von Pattern zu Pattern und bleibt das
 * Auswahlprinzip. NEU ist, dass er durch einen gefilterten Topf laeuft: was
 * dem schon Gesetzten klanglich im Weg steht, wird vorher aussortiert (siehe
 * `klangWahl`). Ohne Klangprofile — alte Projekte, Samples aus einer alten
 * Bank — filtert nichts, und es kommt genau dasselbe heraus wie vorher.
 *
 * Die Reihenfolge ist der Vorrang: die Melodie ist vorgegeben und schraenkt
 * alles ein, die Kick ist der Anker, der Bass teilt sich mit ihr den Keller
 * (dort entsteht der meiste Matsch), das Schlagzeug ordnet sich darueber ein.
 */
function themaFuer(pl: Pools, i: number, melo?: ProjektSample): Thema {
  const w = klangWaehler([melo?.klang], melo?.tonart);
  const nimm = <T extends ProjektSample>(topf: readonly T[], n: number): T | undefined => {
    const gewaehlt = rot(w.topf(topf), n);
    w.merke(gewaehlt);
    return gewaehlt;
  };
  /** Fuer Lagen, die gleichzeitig mit der Melodie KLINGEN: auch die Tonart muss passen. */
  const nimmTonal = <T extends ProjektSample>(topf: readonly T[], n: number): T | undefined => {
    const gewaehlt = rot(w.tonalerTopf(topf), n);
    w.merke(gewaehlt);
    return gewaehlt;
  };
  const vers = nimmTonal(ausLied(pl.voxLoops.filter((v) => v.chunk === undefined || v.chunk === 0), melo), i);
  // Die Kick-Familie wird als Ganzes gewaehlt (die Patterns brauchen zwei aus
  // derselben), darum wird sie ueber ihre lauteste Kick bewertet.
  const familien = pl.familien.map((f) => ({ ...f, klang: f.kicks[0]?.klang }));
  const fam = rot(w.topf(familien), i);
  w.merke(fam?.kicks[0]);
  const bassFallback = pl.kicks.filter((k) => k.sekunden >= 0.6).concat(pl.kicks);
  const bass = nimmTonal(pl.basses, i) ?? nimm(bassFallback, i);
  const snare = nimm(pl.snares, i);
  const clap = nimm(pl.claps, i + 1);
  const hatZu = nimm(pl.hatsClosed, i);
  const hatAuf = nimm(pl.hatsOpen, i + 1);
  const percs = pl.percs.length ? ([nimm(pl.percs, 2 * i), nimm(pl.percs, 2 * i + 1)] as const) : undefined;
  const stab = nimmTonal(pl.stabs, i);
  const voxShots = ausLied(pl.voxShots, melo);
  const shotPool = voxShots.length ? voxShots : pl.fxShots;
  const shotPoolB = pl.fxShots.length ? pl.fxShots : voxShots;
  return {
    melo: nm(melo),
    vers: nm(vers),
    kickFamilie: fam?.name ?? "",
    snare: nm(snare) ?? "",
    clap: nm(clap),
    hats: [nm(hatZu) ?? "", nm(hatAuf) ?? ""],
    percs: percs ? [nm(percs[0])!, nm(percs[1])!] : undefined,
    bass: nm(bass),
    stab: nm(stab),
    shots: shotPool.length ? [nm(rot(shotPool, 2 * i))!, nm(rot(shotPoolB, i))!] : undefined,
    riser: nm(rot(pl.fxLoops, i)),
  };
}

/**
 * Die Kick-Figur aus der Beschreibung — oder `undefined`, wenn keine drinsteht.
 *
 * Der Unterschied zu „gibt sonst 'vier' zurueck" ist der ganze Zweck: nur wenn
 * hier nichts gesagt wurde, darf die gemessene Melodie-Dichte entscheiden
 * (siehe `regelRezept`). Ein ausgesprochener Wunsch schlaegt jede Messung.
 */
export function kickAusBeschreibung(beschreibung = ""): KickFigur | undefined {
  const b = beschreibung.toLowerCase();
  if (/kicks?\W{0,3}(roll|wirbel)|(roll\w*|wirbel)\W{0,3}kick|wirbel/.test(b)) return "roll";
  if (/galopp|gallop|offbeat kick/.test(b)) return "galopp";
  if (/hart|hard|brett|druck/.test(b)) return "hart";
  return undefined;
}

function figurenAus(beschreibung = ""): { kick: KickFigur; bass: BassFigur; stab: StabFigur; hatsOffbeat: boolean; dichte: Dichte } {
  const b = beschreibung.toLowerCase();
  return {
    kick: kickAusBeschreibung(beschreibung) ?? "vier",
    bass: /bass\W{0,3}roll|roll\w*\W{0,3}bass/.test(b) ? "roll" : /bass\W{0,3}(acht|8tel|achtel)|(acht\w*|8tel)\W{0,3}bass|schnell/.test(b) ? "acht" : "off",
    stab: /arp/.test(b) ? "arp" : /frage|call/.test(b) ? "frage" : /ruhig|soft|weich|chill/.test(b) ? "ruhig" : "stab",
    hatsOffbeat: !/keine hats|ohne hats/.test(b),
    dichte: /voll|dicht|fett|brett|wall of/.test(b) ? "voll" : "schlank",
  };
}

function lagenFuer(thema: Thema): Lage[] {
  const alle: Lage[] = ["melo", "vers", "bass", "stab", "shot"];
  return alle.filter((l) =>
    l === "melo" ? !!thema.melo : l === "vers" ? !!thema.vers : l === "bass" ? !!thema.bass : l === "stab" ? !!thema.stab : !!thema.shots,
  );
}

export function regelRezept(projekt: Projekt, wunsch: { modus: Modus; bpm?: number; melo?: string; beschreibung?: string }): Rezept {
  const pl = pools(projekt);
  const kand = meloKandidaten(pl);
  const melo = (wunsch.melo ? kand.find((m) => m.name === wunsch.melo) : undefined) ?? kand[0];
  const idx = melo ? Math.max(0, kand.indexOf(melo)) : 0;
  const thema = themaFuer(pl, idx, melo);
  const fig = figurenAus(wunsch.beschreibung);
  // Sagt die Beschreibung nichts ueber die Kick, entscheidet die gemessene
  // Dichte der Melodie: eine dichte Melodie bekommt eine Kick, die Platz
  // laesst, eine ruhige eine, die Bewegung bringt. Ohne Profil (altes Projekt)
  // bleibt es bei der bisherigen Vorgabe.
  const meloDichte = melo?.klang && melo.takte >= 1 ? melo.klang.dichte : undefined;
  const kickFigur = kickAusBeschreibung(wunsch.beschreibung) ?? (meloDichte !== undefined ? figurAusDichte(meloDichte) : fig.kick);
  const bpm = wunsch.bpm ?? projekt.bpm;
  const lagenAlle = lagenFuer(thema);
  const abschnitte: Abschnitt[] =
    wunsch.modus === "miniset"
      ? MINISET.map((a) => ({
          ...a,
          kick: a.intensitaet >= 5 ? kickFigur : a.kick,
          lagen: a.lagen.filter((l) => lagenAlle.includes(l) || (l === "riser" && !!thema.riser)),
        }))
      : [{ name: "JAM", wiederholungen: 1, intensitaet: 5, kick: kickFigur, lagen: lagenAlle }];
  const begruendung =
    `${melo ? `Melodie "${melo.name}" (${melo.takte} Takte${melo.tonart ? `, ${melo.tonart.name} / ${melo.tonart.camelot}` : ""})` : "keine Melodie"} mit Kick-Familie "${thema.kickFamilie}"` +
    `${thema.vers ? `, Vocal-Loop "${thema.vers}"` : ""}; Tempo ${bpm} BPM${wunsch.bpm ? " (gewaehlt)" : " (Vorschlag aus der Taktanalyse)"}; ` +
    `Kick ${kickFigur}, Bass ${fig.bass}, Stab ${fig.stab}.` +
    (meloDichte !== undefined && !kickAusBeschreibung(wunsch.beschreibung) ? ` ${dichteText(meloDichte)}.` : "");
  return { modus: wunsch.modus, bpm, begruendung, thema, abschnitte, figuren: { bass: fig.bass, stab: fig.stab, hatsOffbeat: fig.hatsOffbeat, dichte: fig.dichte } };
}

export function regelRezeptProMelo(projekt: Projekt, bpm?: number): Rezept[] {
  const kand = meloKandidaten(pools(projekt));
  return kand.map((m) => ({ ...regelRezept(projekt, { modus: "promelo", bpm, melo: m.name }), modus: "promelo" as Modus }));
}

// ── Pruefung ────────────────────────────────────────────────────────────────
type RolleName = ProjektSample["rolle"];

export function pruefeRezept(r: unknown, projekt: Projekt): { rezept: Rezept; korrekturen: string[] } {
  const korr: string[] = [];
  const x = typeof r === "object" && r ? (r as Record<string, unknown>) : {};
  let modus: Modus = "jam";
  if ((["jam", "miniset", "promelo"] as Modus[]).includes(x.modus as Modus)) modus = x.modus as Modus;
  else korr.push("modus → jam");
  const tRoh = (typeof x.thema === "object" && x.thema ? x.thema : {}) as Partial<Thema>;
  const basis = regelRezept(projekt, { modus, melo: typeof tRoh.melo === "string" ? tRoh.melo : undefined });
  let bpm = basis.bpm;
  if (typeof x.bpm === "number" && x.bpm >= 60 && x.bpm <= 300) bpm = x.bpm;
  else korr.push(`bpm → ${basis.bpm}`);
  const hat = (name: unknown, rollen: RolleName[]) =>
    typeof name === "string" && projekt.samples.some((s) => s.name === name && rollen.includes(s.rolle));
  const feld = <K extends keyof Thema>(k: K, rollen: RolleName[], optional = false): Thema[K] => {
    const v = tRoh[k];
    if (v === undefined && optional) return basis.thema[k];
    if (hat(v, rollen)) return v as Thema[K];
    korr.push(`thema.${k} "${String(v)}" → "${String(basis.thema[k])}"`);
    return basis.thema[k];
  };
  const paar = <K extends "hats" | "percs" | "shots">(k: K, rollen: RolleName[]): Thema[K] => {
    const v = tRoh[k];
    if (v === undefined && k !== "hats") return basis.thema[k];
    if (Array.isArray(v) && v.length === 2 && v.every((n) => hat(n, rollen))) return v as Thema[K];
    korr.push(`thema.${k} → Regel`);
    return basis.thema[k];
  };
  const familien = pools(projekt).familien.map((f) => f.name);
  let kickFamilie = basis.thema.kickFamilie;
  if (typeof tRoh.kickFamilie === "string" && familien.includes(tRoh.kickFamilie)) kickFamilie = tRoh.kickFamilie;
  else korr.push(`thema.kickFamilie "${String(tRoh.kickFamilie)}" → "${basis.thema.kickFamilie}"`);
  const thema: Thema = {
    melo: feld("melo", ["melo"], true),
    vers: feld("vers", ["vox", "melo"], true),
    kickFamilie,
    snare: feld("snare", ["snare", "perc"]),
    clap: feld("clap", ["clap", "snare", "perc"], true),
    hats: paar("hats", ["hat", "perc"]),
    percs: paar("percs", ["perc", "ton", "hat"]),
    bass: feld("bass", ["bass", "kick"], true),
    stab: feld("stab", ["ton", "melo"], true),
    shots: paar("shots", ["vox", "fx", "ton"]),
    riser: feld("riser", ["fx"], true),
  };
  const abRoh = Array.isArray(x.abschnitte) ? (x.abschnitte as Partial<Abschnitt>[]) : [];
  const abschnitte: Abschnitt[] = abRoh.slice(0, 8).map((a, i) => ({
    name: typeof a.name === "string" ? a.name.slice(0, 8) : `TEIL ${i + 1}`,
    wiederholungen: typeof a.wiederholungen === "number" && a.wiederholungen >= 1 && a.wiederholungen <= 8 ? Math.round(a.wiederholungen) : 2,
    intensitaet: (typeof a.intensitaet === "number" && a.intensitaet >= 1 && a.intensitaet <= 5 ? Math.round(a.intensitaet) : 3) as 1 | 2 | 3 | 4 | 5,
    kick: KICK_FIGUREN.includes(a.kick as KickFigur) ? (a.kick as KickFigur) : "vier",
    lagen: Array.isArray(a.lagen) ? (a.lagen.filter((l) => LAGEN.includes(l as Lage)) as Lage[]) : ["melo"],
  }));
  if (!abschnitte.length) {
    korr.push("abschnitte leer → Regel");
    abschnitte.push(...basis.abschnitte);
  }
  if (modus === "jam" && abschnitte.length > 1) {
    korr.push("jam hat nur einen Abschnitt");
    abschnitte.splice(1);
  }
  const f = (typeof x.figuren === "object" && x.figuren ? x.figuren : {}) as Partial<Rezept["figuren"]>;
  let bass: BassFigur = "off";
  if (BASS_FIGUREN.includes(f.bass as BassFigur)) bass = f.bass as BassFigur;
  else korr.push("figuren.bass → off");
  let stab: StabFigur = "stab";
  if (STAB_FIGUREN.includes(f.stab as StabFigur)) stab = f.stab as StabFigur;
  else korr.push("figuren.stab → stab");
  const figuren = { bass, stab, hatsOffbeat: typeof f.hatsOffbeat === "boolean" ? f.hatsOffbeat : true, dichte: (f.dichte === "voll" ? "voll" : "schlank") as Dichte };
  const begruendung = typeof x.begruendung === "string" && x.begruendung.trim() ? x.begruendung.trim() : basis.begruendung;
  return { rezept: { modus, bpm, begruendung, thema, abschnitte, figuren }, korrekturen: korr };
}
