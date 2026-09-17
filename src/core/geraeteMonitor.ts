/**
 * geraeteMonitor — liest die benannten Zustandsstrukturen der Sampler-Firmware (e2Symbole)
 * über den RAM-Lesepfad und macht daraus einen Bericht: welche der 24 Oszillator-Slots spielen
 * gerade für welchen Part mit welchem Oszillator, wie die Batterie-Stufe steht (und ob das Gerät
 * ein SD-Update zuließe), wie viele User-Samples geladen sind.
 *
 * Der Lesepfad kommt von außen (`Lesen`), damit das Modul ohne MIDI testbar ist und die GUI
 * denselben geprüften 0x52-Weg wie das RAM-Panel benutzt. Nur Lesen — nichts hier schreibt.
 *
 * ⚠ Gilt nur bei gestopptem Sequencer: bei laufendem Gerät kommen RAM-Lesungen stumm
 * verschoben zurück (run-tekkforge-Skill). Der Bericht sagt das im Kopf.
 */
import { validateRamRange } from "./hacktribeRam";
import {
  STIMMEN,
  BATTERIE,
  SAMPLE_LAUFZEIT,
  dekodiereStimmen,
  dekodiereBatterie,
  dekodiereSampleStand,
  type StimmenSlot,
  type BatterieStand,
  type SampleStand,
} from "./e2Symbole";

export type Lesen = (addr: number, len: number) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }>;

export interface MonitorBericht {
  maske: number;
  generation: number;
  stimmen: StimmenSlot[];
  batterie: BatterieStand | null;
  batterieHinweis: string;
  fehler: string[];
}

const u16 = (b: Uint8Array): number => b[0] | (b[1] << 8);
const u32 = (b: Uint8Array): number => (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;

export async function liesMonitor(lesen: Lesen): Promise<MonitorBericht> {
  const fehler: string[] = [];
  let maske = 0;
  let generation = 0;
  let stimmen: StimmenSlot[] = [];
  const m = await lesen(STIMMEN.maske, 4);
  if (m.ok) maske = u32(m.bytes);
  else fehler.push(`Slot-Maske: ${m.reason}`);
  const g = await lesen(STIMMEN.generation, 2);
  if (g.ok) generation = u16(g.bytes);
  else fehler.push(`Generation: ${g.reason}`);
  const s = await lesen(STIMMEN.slots, STIMMEN.anzahl * STIMMEN.slotGroesse);
  const n = await lesen(STIMMEN.noten, STIMMEN.anzahl);
  const r = await lesen(STIMMEN.release, STIMMEN.anzahl);
  if (s.ok && n.ok && r.ok) stimmen = dekodiereStimmen(maske, s.bytes, n.bytes, r.bytes);
  else fehler.push(`Slots: ${[s, n, r].filter((x) => !x.ok).map((x) => (x as { reason: string }).reason).join("; ")}`);

  let batterie: BatterieStand | null = null;
  let batterieHinweis = "";
  const z = await lesen(BATTERIE.zeigerVariable, 4);
  if (!z.ok) batterieHinweis = `Batterie-Zeiger nicht lesbar: ${z.reason}`;
  else {
    const ptr = u32(z.bytes);
    if (ptr === 0) batterieHinweis = "Batterie-Client noch nicht angelegt — das Gerät legt ihn erst beim ersten Batterie-/Update-Ereignis an.";
    else {
      const fenster = ptr + BATTERIE.fensterOffset;
      const range = validateRamRange(fenster, BATTERIE.fensterGroesse);
      if (!range.ok) batterieHinweis = `Batterie-Zeiger 0x${ptr.toString(16).toUpperCase()} zeigt nicht in den DDR2 — Firmware-Layout passt nicht (Synth?).`;
      else {
        const f = await lesen(fenster, BATTERIE.fensterGroesse);
        if (!f.ok) batterieHinweis = `Batterie-Fenster nicht lesbar: ${f.reason}`;
        else {
          batterie = dekodiereBatterie(f.bytes);
          if (!batterie.plausibel) batterieHinweis = "Batterie-Werte unplausibel (Schwellen-Zeiger fremd oder Stufe > 4) — Client vermutlich noch nicht initialisiert.";
        }
      }
    }
  }
  return { maske, generation, stimmen, batterie, batterieHinweis, fehler };
}

/** Liest `anzahl` Laufzeit-Sample-Records ab Katalog-Index `abIndex` (500 = User-Sample 501). */
export async function liesSampleStand(lesen: Lesen, abIndex = 500, anzahl = 32): Promise<{ stand: SampleStand[]; fehler?: string }> {
  const max = Math.max(0, Math.min(anzahl, SAMPLE_LAUFZEIT.count - abIndex));
  if (max === 0) return { stand: [], fehler: "Index außerhalb des Katalogs" };
  const r = await lesen(SAMPLE_LAUFZEIT.base + abIndex * SAMPLE_LAUFZEIT.stride, max * SAMPLE_LAUFZEIT.stride);
  if (!r.ok) return { stand: [], fehler: r.reason };
  return { stand: dekodiereSampleStand(r.bytes, max, abIndex) };
}

/**
 * Liest den User-Katalog blockweise (je `block` Records) ab `abIndex`, bis ein Block ohne geladenes
 * Sample kommt oder der Katalog endet — so kommt die ganze belegte User-Bank ohne 999 Records zu lesen.
 */
export async function liesSampleStandBisLeer(lesen: Lesen, abIndex = 500, block = 32, fortschritt?: (gelesenBis: number) => void): Promise<{ stand: SampleStand[]; fehler?: string; geladen: number; bytes: number }> {
  const stand: SampleStand[] = [];
  let i = abIndex;
  while (i < SAMPLE_LAUFZEIT.count) {
    const r = await liesSampleStand(lesen, i, block);
    if (r.fehler) return { stand, fehler: r.fehler, geladen: stand.filter((s) => s.geladen).length, bytes: stand.reduce((a, s) => a + (s.geladen ? s.laengeBytes : 0), 0) };
    stand.push(...r.stand);
    i += r.stand.length;
    fortschritt?.(i);
    if (!r.stand.some((s) => s.geladen) || r.stand.length < block) break;
  }
  return { stand, geladen: stand.filter((s) => s.geladen).length, bytes: stand.reduce((a, s) => a + (s.geladen ? s.laengeBytes : 0), 0) };
}

/** Nicht geladene Nummern zwischen dem ersten und dem letzten geladenen Sample, als Bereiche („512, 530–533“). */
export function sampleLuecken(stand: SampleStand[]): { luecken: string; anzahl: number } {
  const geladen = stand.filter((s) => s.geladen).map((s) => s.anzeige);
  if (geladen.length < 2) return { luecken: "", anzahl: 0 };
  const von = geladen[0];
  const bis = geladen[geladen.length - 1];
  const set = new Set(geladen);
  const fehlend: number[] = [];
  for (let n = von; n <= bis; n++) if (!set.has(n)) fehlend.push(n);
  const bereiche: string[] = [];
  for (let i = 0; i < fehlend.length; i++) {
    let j = i;
    while (j + 1 < fehlend.length && fehlend[j + 1] === fehlend[j] + 1) j++;
    bereiche.push(j > i ? `${fehlend[i]}–${fehlend[j]}` : `${fehlend[i]}`);
    i = j;
  }
  return { luecken: bereiche.join(", "), anzahl: fehlend.length };
}

const pad = (s: string | number, n: number): string => String(s).padStart(n, " ");

/** Der Bericht als Text fürs `<pre>`; `oszName` liefert den Anzeigenamen zur Oszillator-Nummer (ID + 1). */
export function monitorText(b: MonitorBericht, oszName: (nummer: number) => string): string {
  const z: string[] = [];
  const aktive = b.stimmen.filter((s) => s.aktiv || s.inBenutzung);
  z.push(`Stimmen: ${b.stimmen.filter((s) => s.aktiv).length}/24 am DSP aktiv, ${b.stimmen.filter((s) => s.inBenutzung).length} in Benutzung (Maske 0x${b.maske.toString(16).toUpperCase().padStart(6, "0")}, Generation ${b.generation})`);
  if (aktive.length) {
    z.push(" Slot  Part  DSP  Oszillator                  Note  Zustand");
    for (const s of aktive) {
      const nr = s.oszId + 1;
      const name = s.oszId >= 500 ? `User-Sample ${nr}` : oszName(nr);
      const zustand = s.gedrueckt ? "gedrückt" : s.release === "oneshot" ? "One-Shot läuft aus" : s.release === "normal" ? "Release" : s.aktiv ? "aktiv (DSP)" : "—";
      z.push(` ${pad(s.slot + 1, 3)}   ${pad(s.part === null ? "?" : s.part + 1, 3)}  ${pad(s.dspSlot, 3)}  ${pad(nr, 3)} ${name.padEnd(22).slice(0, 22)}  ${pad(s.note, 3)}  ${zustand}`);
    }
  } else z.push(" (kein Slot belegt — Sequencer steht, keine Note gehalten)");
  z.push("");
  if (b.batterie) {
    const bt = b.batterie;
    z.push(`Batterie: Stufe ${bt.stufe}/4 (${bt.chemie}, Rohwert ${bt.roh}, Schwellen ${bt.schwellen.join("/")})${bt.latch ? ", „Battery Low“ gemeldet" : ""}`);
    z.push(bt.updateErlaubt ? ` SD-Update erlaubt (Stufe ≥ ${BATTERIE.updateAbStufe}).` : ` ⚠ SD-Update würde das Gerät verweigern (Status 0x1A) — Stufe < ${BATTERIE.updateAbStufe}. Am Netzteil zählt der Listener-State statt der Stufe.`);
  } else z.push(`Batterie: ${b.batterieHinweis || "nicht gelesen"}`);
  if (b.fehler.length) z.push("", ...b.fehler.map((f) => `Fehler: ${f}`));
  return z.join("\n");
}

export function sampleStandText(stand: SampleStand[]): string {
  if (!stand.length) return "(keine Records)";
  const geladen = stand.filter((s) => s.geladen);
  const z = [`User-Samples ${stand[0].anzeige}–${stand[stand.length - 1].anzeige}: ${geladen.length} geladen`];
  for (const s of geladen) z.push(` ${pad(s.anzeige, 3)}  ${pad(s.laengeBytes, 9)} Bytes  ${pad(s.rate, 5)} Hz${s.stereoRolle ? `  Stereo-Rolle ${s.stereoRolle}` : ""}`);
  return z.join("\n");
}
