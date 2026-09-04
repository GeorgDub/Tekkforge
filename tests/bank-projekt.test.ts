import { describe, it, expect } from "vitest";
import { buildE2sBank, type E2sSlotInput } from "../src/core/e2sBankBuilder";
import { displayNumberToOsc, displayNumberToSlotIndex, e2PatternRefToBankNumber } from "../src/core/e2sPatternSampleLink";
import { projektAusBank, slotRolle } from "../src/core/bankProjekt";
import { regelRezept, pools } from "../src/core/rezept";
import { bauePaare, voxPaare } from "../src/core/patternGen";

const SR = 44100;
const BPM = 204;
const takt = (240 / BPM) * SR;
const ton = (hz: number, frames: number, amp = 0.6): Float32Array => new Float32Array(frames).map((_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR) * (1 - i / frames));
const kick = (frames: number): Float32Array => new Float32Array(frames).map((_, i) => 0.9 * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-i / 3000));
const slot = (nr: number, name: string, pcm: Float32Array, rate = SR): E2sSlotInput => ({ slotIndex: displayNumberToSlotIndex(nr), sampleNumber: displayNumberToOsc(nr), name, pcmData: pcm, sampleRate: rate, channels: 1 });

function bank(): Uint8Array {
  const vier = Math.round(4 * takt);
  const slots: E2sSlotInput[] = [
    slot(501, "HommO KicK 1", kick(15000)),
    slot(502, "HommO KicK 2", kick(16000)),
    slot(503, "snarre-p", ton(1800, 12000)),
    slot(504, "closed 8", ton(6000, 6000, 0.3)),
    slot(505, "Geraet DROP", ton(220, Math.round(8 * takt))),
    slot(506, "Geraet V01 A", ton(330, vier)),
    slot(507, "Geraet V01 B", ton(392, vier)),
    // halbe Rate: halb so viele Bilder fuer dieselben vier Takte
    slot(508, "Geraet VDROP A", ton(440, Math.round(vier / 2)), 22050),
    slot(509, "Geraet VDROP B", ton(494, vier)),
    slot(510, "Unison_Bass_C3", ton(65, 50000)),
  ];
  return new Uint8Array(buildE2sBank(slots).buffer);
}

describe("bankProjekt", () => {
  const projekt = projektAusBank(bank(), { name: "T", bpm: BPM, klang: false });

  it("slotRolle: Vocal-Kennungen vor den Namensregeln", () => {
    expect(slotRolle("Geraet V01 A", 4.7, -12)).toBe("vox");
    expect(slotRolle("Geraet VDROP B", 4.7, -12)).toBe("vox");
    expect(slotRolle("HommO KicK 1", 0.34, -6)).toBe("kick");
    // Fenster-Kennungen eines Lied-Sets sind Melodie — „BREAK“ traefe sonst die Kick-Regel
    expect(slotRolle("Geraet BREAK", 9.4, -12)).toBe("melo");
    expect(slotRolle("Geraet DROP", 9.4, -12)).toBe("melo");
  });

  it("jede tonale Schleife bekommt Raster und Melodie-Linie", () => {
    const drop = projekt.samples.find((s) => s.name === "Geraet DROP")!;
    expect(drop.meloLinie).toBeDefined();
    expect(drop.meloLinie!.anschlag.some(Boolean)).toBe(true);
    expect(projekt.samples.find((s) => s.name === "Geraet V01 A")!.meloLinie).toBeDefined();
    expect(projekt.samples.find((s) => s.name === "HommO KicK 1")!.meloLinie).toBeUndefined();
  });

  it("Nummern bleiben die der Bank, Rollen und Takte stimmen, Haelften bilden Paare", () => {
    const by = (n: string) => projekt.samples.find((s) => s.name === n)!;
    expect(by("HommO KicK 1").nr).toBe(501);
    expect(by("HommO KicK 1").rolle).toBe("kick");
    expect(by("HommO KicK 1").kind).toBe("oneshot");
    expect(by("Geraet DROP")).toMatchObject({ nr: 505, rolle: "melo", kind: "loop", takte: 8 });
    expect(by("Geraet DROP").raster).toBeDefined();
    expect(by("Geraet V01 A")).toMatchObject({ rolle: "vox", kind: "loop", takte: 4, chunk: 0, chunks: 2 });
    expect(by("Geraet V01 B")).toMatchObject({ chunk: 1, gruppe: by("Geraet V01 A").gruppe });
    expect(by("Geraet VDROP A").sampleRate).toBe(22050);
    expect(by("Geraet VDROP A").takte).toBe(4);
    expect(voxPaare(projekt).map((p) => p.nr)).toEqual([506, 508]);
    expect(pools(projekt).familien.some((f) => f.name === "hommo kick" && f.kicks.length === 2)).toBe(true);
  });

  it("daraus entstehen Paare A ↔ B plus KICK, die auf die Bank-Nummern zeigen", () => {
    const rezept = regelRezept(projekt, { modus: "jam", bpm: BPM, melo: "Geraet DROP" });
    rezept.thema.kickFamilie = "hommo kick";
    const { patterns } = bauePaare(rezept, projekt, { variation: false });
    expect(patterns).toHaveLength(6);
    expect(patterns.map((p) => p.name.trim().replace(/^.*\s/, ""))).toEqual(["V1A", "V1B", "KICK1", "V2A", "V2B", "KICK2"]);
    expect(e2PatternRefToBankNumber(patterns[0].parts[0].sampleId!)).toBe(501);
    expect(e2PatternRefToBankNumber(patterns[0].parts[15].sampleId!)).toBe(506);
    expect(e2PatternRefToBankNumber(patterns[1].parts[15].sampleId!)).toBe(507);
    expect(e2PatternRefToBankNumber(patterns[0].parts[12].sampleId!)).toBe(505);
    expect(patterns[0].parts[15].steps.filter((s) => s.active)).toHaveLength(1);
    expect(patterns[1].parts[15].steps.filter((s) => s.active)).toHaveLength(1);
    expect(patterns[0].parts[15].sampleId).not.toBe(patterns[1].parts[15].sampleId);
    expect(patterns[0].parts[12].steps.filter((s) => s.active)).toHaveLength(1);
    expect(patterns[1].parts[12].steps.filter((s) => s.active)).toHaveLength(0);
    expect(patterns[0].chainTo).toBe(2);
    expect(patterns[1].chainTo).toBe(1);
    expect(patterns[2].chainTo).toBe(0);
  });
});
