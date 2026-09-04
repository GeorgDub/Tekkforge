/**
 * pattern-aus-bank.mjs — Patterns zu einer FERTIGEN Sample-Bank (.all).
 *
 *   npx tsx scripts/pattern-aus-bank.mjs --bank <BANK.all> --bpm <n> --ziel <out.e2sallpat>
 *        [--kick "<Name>"] [--melo "<Name>"] [--snare "<Name>"] [--clap "<Name>"]
 *        [--hat "<Name>" --hat2 "<Name>"] [--bass "<Name>"] [--stab "<Name>"]
 *        [--shot "<Name>" --shot2 "<Name>"] [--riser "<Name>"] [--jam] [--start <slot>]
 *
 * Liest die Bank, gibt jedem Slot Rolle und Taktzahl (core/bankProjekt.ts),
 * erkennt Vocal-Haelften „… V01 A/B“ als Paare und baut je Paar A ↔ B plus
 * KICK (patternGen.bauePaare). Die Patterns zeigen auf die Nummern der
 * Bank — nichts wird umnummeriert. `--kick` waehlt die Kick-Familie ueber
 * einen Slot-Namen; die uebrigen Wahlen ersetzen einzelne Thema-Eintraege.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { projektAusBank } from "../src/core/bankProjekt.ts";
import { regelRezept, pools } from "../src/core/rezept.ts";
import { bauePaare, baueRezept, alsAllPat } from "../src/core/patternGen.ts";

const argv = process.argv.slice(2);
const opt = (k) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (k) => argv.includes(`--${k}`);
const bankPfad = opt("bank");
const bpm = Number(opt("bpm"));
const ziel = opt("ziel");
if (!bankPfad || !Number.isFinite(bpm) || !ziel) {
  console.error("Aufruf: --bank <BANK.all> --bpm <n> --ziel <out.e2sallpat> [--kick …] [--melo …] …");
  process.exit(2);
}
const name = path.basename(bankPfad).replace(/\.[^.]+$/, "");
const projekt = projektAusBank(new Uint8Array(fs.readFileSync(bankPfad)), { name, bpm });
const finde = (wunsch, rolle) => {
  if (!wunsch) return undefined;
  const s = projekt.samples.find((x) => x.name.toLowerCase() === wunsch.toLowerCase()) ?? projekt.samples.find((x) => x.name.toLowerCase().includes(wunsch.toLowerCase()));
  if (!s) {
    console.error(`„${wunsch}“ ist nicht in der Bank`);
    process.exit(1);
  }
  if (rolle && s.rolle !== rolle) {
    // Der Nutzer weiss es besser als der Name: Rolle umsetzen, damit die Pools ihn fuehren
    s.rolle = rolle;
    s.gruppe = s.kind === "loop" ? `${rolle}:${s.familie}` : rolle;
  }
  return s;
};
const kick = finde(opt("kick"), "kick");
const melo = finde(opt("melo"), "melo");
const rezept = regelRezept(projekt, { modus: "jam", bpm, melo: melo?.name });
if (kick) {
  const pl = pools(projekt);
  const fam = pl.familien.find((f) => f.kicks.some((k) => k.nr === kick.nr));
  rezept.thema.kickFamilie = fam ? fam.name : kick.familie;
}
for (const [k, rolle] of [["snare", "snare"], ["clap", "clap"], ["bass", "bass"], ["stab", "ton"], ["riser", "fx"]]) {
  const s = finde(opt(k), rolle);
  if (s) rezept.thema[k] = s.name;
}
const hats = [finde(opt("hat"), "hat"), finde(opt("hat2"), "hat")].filter(Boolean);
if (hats.length) rezept.thema.hats = [hats[0].name, (hats[1] ?? hats[0]).name];
const shots = [finde(opt("shot"), "fx"), finde(opt("shot2"), "fx")].filter(Boolean);
if (shots.length) rezept.thema.shots = shots.map((s) => s.name);

const start = Number(opt("start") ?? 1);
const gebaut = flag("jam") ? baueRezept(rezept, projekt, { startSlot: start }) : bauePaare(rezept, projekt, { startSlot: start });
fs.mkdirSync(path.dirname(ziel), { recursive: true });
fs.writeFileSync(ziel, new Uint8Array(alsAllPat(gebaut.patterns, start)));
const t = rezept.thema;
console.log(`${ziel}: ${gebaut.patterns.length} Patterns ab Slot ${start}, ${bpm} BPM`);
console.log(`Thema: Kick-Familie „${t.kickFamilie}“, Snare „${t.snare}“, Clap „${t.clap}“, Hats „${t.hats?.join("“ / „")}“, Bass „${t.bass}“, Stab „${t.stab}“, Melo „${t.melo}“, Shots „${t.shots?.join("“ / „")}“`);
for (const h of gebaut.hinweise) console.log(`  ! ${h}`);
console.log(gebaut.patterns.map((p) => p.name.trim()).join(", "));
