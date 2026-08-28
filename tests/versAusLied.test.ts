import { describe, it, expect } from "vitest";
import { regelRezeptProMelo } from "../src/core/rezept";
import type { Projekt, ProjektSample } from "../src/core/bankPlan";

let nr = 500;
function smp(teil: Partial<ProjektSample> & { rolle: ProjektSample["rolle"]; name: string }): ProjektSample {
  return {
    nr: ++nr,
    familie: teil.name,
    kind: "oneshot",
    takte: 0,
    sekunden: 0.4,
    rmsDb: -10,
    quelle: `${teil.name}.wav`,
    gruppe: teil.rolle,
    ...teil,
  } as ProjektSample;
}

const loop = (name: string, rolle: ProjektSample["rolle"], lied: string) =>
  smp({ name, rolle, lied, kind: "loop", takte: 8, sekunden: 10.67, gruppe: `${rolle}:${name}` });

/** Zwei Lieder, jedes mit Melodie und eigenen Vocals, dazu Schlagzeug. */
function projekt(): Projekt {
  const samples: ProjektSample[] = [
    smp({ name: "Kick A", rolle: "kick", familie: "kickfam" }),
    smp({ name: "Kick B", rolle: "kick", familie: "kickfam" }),
    smp({ name: "Snare", rolle: "snare" }),
    smp({ name: "Hat", rolle: "hat", sekunden: 0.12 }),
    loop("ALPHA MELO", "melo", "ALPHA"),
    loop("BETA MELO", "melo", "BETA"),
    loop("ALPHA V01", "vox", "ALPHA"),
    loop("ALPHA V02", "vox", "ALPHA"),
    loop("BETA V01", "vox", "BETA"),
    loop("BETA V02", "vox", "BETA"),
  ];
  return { name: "TEST", bpm: 180, budgetSekunden: 235, volume: 1, volumes: 1, tekkDrums: false, samples } as Projekt;
}

describe("Vers-Vocal folgt der Melodie ins Lied", () => {
  it("ein Thema mit ALPHA-Melodie bekommt ein ALPHA-Vocal", () => {
    // Nutzerbefund am Gerät (2026-08-29): „bei dem SpongeBob-Pattern ist ein
    // anderes Vocal". Der Vers wurde reihum aus dem GEMEINSAMEN Vocal-Topf
    // gezogen, ohne Rücksicht darauf, zu welchem Lied die Melodie gehört.
    const p = projekt();
    const rezepte = regelRezeptProMelo(p, 180);
    expect(rezepte.length).toBeGreaterThanOrEqual(2);
    for (const r of rezepte) {
      const melo = p.samples.find((s) => s.name === r.thema.melo);
      const vers = p.samples.find((s) => s.name === r.thema.vers);
      if (!melo || !vers) continue;
      expect(vers.lied).toBe(melo.lied);
    }
  });

  it("hat ein Lied keine eigenen Vocals, wird trotzdem eins vergeben", () => {
    // Lieber ein fremdes Vocal als ein stummer Vers — aber nur dann.
    const p = projekt();
    p.samples = p.samples.filter((s) => !(s.rolle === "vox" && s.lied === "BETA"));
    const rezepte = regelRezeptProMelo(p, 180);
    const beta = rezepte.find((r) => r.thema.melo === "BETA MELO");
    expect(beta?.thema.vers).toBeTruthy();
  });
});
