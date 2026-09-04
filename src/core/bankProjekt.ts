/**
 * bankProjekt — ein Projekt aus einer FERTIGEN Sample-Bank (.all), ohne die
 * Samples anzufassen.
 *
 * Der Generator baute Projekt und Bank bisher immer zusammen (`planeBank`).
 * Wer aber eine Bank schon hat — etwa die eigene Bibliothek plus die
 * Geraet-Vocals, am Geraet zusammengestellt —, will dazu nur noch Patterns.
 * Hier bekommt jeder Slot Rolle (Name, sonst Klang), Familie, Taktzahl am
 * Bank-Tempo und sein Klangprofil; Vocal-Haelften „… V01 A“ / „… V01 B“
 * (auch VDROP/VBREAK) werden als Paar erkannt, damit `bauePaare` sie findet.
 * Die Nummern bleiben die der Bank — die Patterns zeigen auf das, was auf
 * dem Geraet liegt.
 */
import { parseE2sBank } from "./e2sBankReader";
import { oscToDisplayNumber } from "./e2sPatternSampleLink";
import { rolleFuer, familie, rmsDb, LANG_AB, type Rolle } from "./sampleScan";
import { klangProfil } from "./klangProfil";
import { taktPassung } from "./tempoAnalyse";
import { meloRaster } from "./meloRaster";
import { downmixToMono } from "./audioProcessor";
import type { Projekt, ProjektSample } from "./bankPlan";

const LOOP_ROLLEN: Rolle[] = ["melo", "vox", "fx", "bass", "ton"];
/** „Geraet V01 A“, „Geraet VDROP B“, „Geraet VAR“ — die Vocal-Slots eines Lied-Sets. */
const VOX_HAELFTE = /^(.*?)\s+(V\d\d|VDROP|VBREAK|VVAR|VAR)\s+([AB])$/i;
const VOX_GANZ = /^(.*?)\s+(V\d\d|VDROP|VBREAK|VVAR|VAR)$/i;

export interface BankProjektOptionen {
  name: string;
  bpm: number;
  /** Klangprofile rechnen (Vorgabe an) — fuer die Rezept-Wahl; aus spart Zeit. */
  klang?: boolean;
}

/** Rolle aus dem Slot-Namen: Vocal-Kennungen zuerst, dann die Scan-Regeln. */
export function slotRolle(name: string, sekunden: number, pegelDb: number, klang?: ReturnType<typeof klangProfil>): Rolle {
  if (VOX_HAELFTE.test(name) || VOX_GANZ.test(name)) return "vox";
  return rolleFuer(name, sekunden, pegelDb, klang);
}

export function projektAusBank(bytes: Uint8Array, opts: BankProjektOptionen): Projekt {
  const bank = parseE2sBank(bytes, `${opts.name}.all`);
  const samples: ProjektSample[] = [];
  for (const s of bank.slots) {
    if (!s) continue;
    const pcm = s.channels === 2 ? downmixToMono(s.pcmData).pcm : s.pcmData;
    const rate = s.sampleRate;
    const sekunden = pcm.length / rate;
    const name = s.name.trim();
    const pegel = rmsDb(pcm);
    const klang = opts.klang === false ? undefined : klangProfil(pcm, rate, { bpm: opts.bpm });
    const rolle = slotRolle(name, sekunden, pegel, klang);
    const nr = oscToDisplayNumber(s.sampleNumber);
    const { takte, abweichung } = taktPassung(sekunden, opts.bpm);
    const loop = LOOP_ROLLEN.includes(rolle) && sekunden >= LANG_AB && abweichung <= 0.12;
    const haelfte = VOX_HAELFTE.exec(name);
    const ganz = VOX_GANZ.exec(name);
    const stamm = haelfte ? `${haelfte[1]} ${haelfte[2]}` : ganz ? `${ganz[1]} ${ganz[2]}` : null;
    const fam = stamm ? stamm.toLowerCase() : familie(name);
    samples.push({
      nr,
      name,
      rolle,
      familie: fam,
      kind: loop ? "loop" : "oneshot",
      takte: loop ? takte : 0,
      sekunden,
      rmsDb: pegel,
      quelle: `${opts.name}.all #${nr}`,
      gruppe: loop ? `${rolle}:${fam}` : rolle,
      sampleRate: rate,
      ...(haelfte && loop ? { chunk: (haelfte[3].toUpperCase() === "A" ? 0 : 1) as 0 | 1, chunks: 2 as const } : {}),
      ...(rolle === "melo" && loop ? { raster: meloRaster(pcm, rate, takte) } : {}),
      ...(klang ? { klang } : {}),
    });
  }
  samples.sort((a, b) => a.nr - b.nr);
  return { name: opts.name, bpm: opts.bpm, budgetSekunden: 0, volume: 1, volumes: 1, tekkDrums: false, samples, status: "geladen", bankZeit: new Date(0).toISOString() };
}
