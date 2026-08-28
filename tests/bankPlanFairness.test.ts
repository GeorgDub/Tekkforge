import { describe, it, expect } from "vitest";
import { waehleVolumes } from "../src/core/bankPlan";
import type { ScanEintrag } from "../src/core/sampleScan";

/** Vocal-Eintrag eines bestimmten Lieds, mit steuerbarem Pegel. */
function vox(lied: string, nr: number, rmsDb: number): ScanEintrag {
  const stem = `${lied} V${String(nr).padStart(2, "0")}`;
  return {
    datei: `${stem}.wav`,
    stem,
    rolle: "vox",
    familie: `${lied}-vox-${nr}`,
    sekunden: 10.67,
    rmsDb,
    peak: 0.9,
    pcm: new Float32Array(Math.round(10.67 * 44100)),
    sampleRate: 44100,
    lied,
  } as ScanEintrag;
}

function melo(lied: string, rmsDb = -12): ScanEintrag {
  const stem = `${lied} DROP`;
  return {
    datei: `${stem}.wav`,
    stem,
    rolle: "melo",
    familie: `${lied}-melo`,
    sekunden: 10.67,
    rmsDb,
    peak: 0.9,
    pcm: new Float32Array(Math.round(10.67 * 44100)),
    sampleRate: 44100,
    lied,
  } as ScanEintrag;
}

const lieder = (liste: ScanEintrag[]) => [...new Set(liste.filter((e) => e.rolle === "vox").map((e) => e.lied))].sort();

describe("Vocal-Verteilung über mehrere Lieder", () => {
  it("jedes Lied kommt zum Zug, bevor eines doppelt drankommt", () => {
    // Der Anlass (2026-08-29): drei Rap-Tracks in einem Set. Ein Lied lieferte
    // 7 Vocal-Abschnitte, eines 2 — und das dritte KEINEN, obwohl 7 MB frei
    // waren. Die Rangliste war rein nach Pegel sortiert, und ein Lied gewann
    // sie durchgehend.
    const eintraege = [
      melo("A"),
      melo("B"),
      melo("C"),
      // Lied A ist durchweg lauter und würde die Rangliste sonst anführen
      ...[1, 2, 3, 4, 5].map((i) => vox("A", i, -8)),
      ...[1, 2, 3].map((i) => vox("B", i, -20)),
      ...[1, 2, 3].map((i) => vox("C", i, -22)),
    ];
    const scheiben = waehleVolumes(eintraege, 180, 80);
    expect(lieder(scheiben[0])).toEqual(["A", "B", "C"]);
  });

  it("bei einem einzigen Lied ändert sich nichts", () => {
    const eintraege = [melo("A"), ...[1, 2, 3, 4].map((i) => vox("A", i, -10))];
    const scheiben = waehleVolumes(eintraege, 180, 80);
    expect(scheiben[0].some((e) => e.rolle === "vox")).toBe(true);
    expect(lieder(scheiben[0])).toEqual(["A"]);
  });

  it("kein Eintrag geht verloren — was nicht in die erste Scheibe passt, kommt in die nächste", () => {
    const eintraege = [
      melo("A"),
      melo("B"),
      ...[1, 2, 3, 4, 5, 6].map((i) => vox("A", i, -10)),
      ...[1, 2, 3, 4, 5, 6].map((i) => vox("B", i, -11)),
    ];
    const scheiben = waehleVolumes(eintraege, 180, 60);
    const alle = scheiben.flat();
    expect(alle.length).toBe(eintraege.length);
    expect(new Set(alle.map((e) => e.datei)).size).toBe(eintraege.length);
  });
});
