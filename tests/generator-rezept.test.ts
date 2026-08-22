import { describe, it, expect } from "vitest";
import type { Projekt, ProjektSample } from "../src/core/bankPlan";
import { regelRezept, regelRezeptProMelo, pruefeRezept } from "../src/core/rezept";

function s(nr: number, name: string, rolle: ProjektSample["rolle"], extra: Partial<ProjektSample> = {}): ProjektSample {
  return {
    nr, name, rolle, familie: name.toLowerCase().replace(/\d+$/, "").trim(), kind: "oneshot", takte: 0,
    sekunden: 0.3, rmsDb: -6, quelle: name, gruppe: rolle, ...extra,
  };
}
const P: Projekt = {
  name: "t", bpm: 180, budgetSekunden: 235, volume: 1, volumes: 1, tekkDrums: false, status: "gebaut", bankZeit: "x",
  samples: [
    s(501, "Kick A1", "kick"), s(502, "Kick A2", "kick"), s(503, "Kick B1", "kick", { familie: "kick b" }),
    s(504, "Snare", "snare"), s(505, "Clap", "clap"), s(506, "Hat close", "hat", { sekunden: 0.1 }), s(507, "Hat open", "hat", { sekunden: 0.4 }),
    s(508, "Ton 1", "ton"), s(509, "Bass", "bass"), s(510, "Sweep", "fx", { sekunden: 2 }),
    s(511, "Melo Eins", "melo", { kind: "loop", takte: 4, sekunden: 5.33, gruppe: "melo:melo eins" }),
    s(512, "Melo Zwei", "melo", { kind: "loop", takte: 8, sekunden: 10.67, gruppe: "melo:melo zwei" }),
    s(513, "Vox Loop", "vox", { kind: "loop", takte: 4, sekunden: 5.33, gruppe: "vox:vox loop" }),
    s(514, "Vox Shot", "vox", { sekunden: 1 }),
  ],
};

describe("rezept", () => {
  it("regelRezept jam: ein Abschnitt, alle Lagen, Thema vollstaendig", () => {
    const r = regelRezept(P, { modus: "jam" });
    expect(r.modus).toBe("jam");
    expect(r.bpm).toBe(180);
    expect(r.abschnitte).toHaveLength(1);
    expect(r.abschnitte[0].lagen).toEqual(expect.arrayContaining(["melo", "bass", "stab", "shot", "vers"]));
    expect(r.thema.melo).toBe("Melo Eins");
    expect(r.thema.vers).toBe("Vox Loop");
    expect(r.thema.kickFamilie).toBe("kick a");
    expect(r.thema.hats).toEqual(["Hat close", "Hat open"]);
    expect(r.begruendung.length).toBeGreaterThan(10);
  });
  it("regelRezept miniset: 6 Abschnitte Intro→Drop→Break→Drop→Outro, Melo waehlbar", () => {
    const r = regelRezept(P, { modus: "miniset", melo: "Melo Zwei", bpm: 176 });
    expect(r.bpm).toBe(176);
    expect(r.thema.melo).toBe("Melo Zwei");
    expect(r.abschnitte.map((a) => a.name)).toEqual(["INTRO", "AUFBAU", "DROP 1", "BREAK", "DROP 2", "OUTRO"]);
    expect(r.abschnitte[2].intensitaet).toBe(5);
    expect(r.abschnitte[3].intensitaet).toBeLessThanOrEqual(2);
  });
  it("regelRezept: Beschreibung mit Schluesselwoertern beeinflusst Figuren", () => {
    const r = regelRezept(P, { modus: "jam", beschreibung: "hart und schnell, rollende bass, arp stab" });
    expect(r.abschnitte[0].kick).toBe("hart");
    expect(r.figuren.bass).toBe("roll");
    expect(r.figuren.stab).toBe("arp");
  });
  it("regelRezeptProMelo: ein Rezept je Melodie, Kick-Familien rotieren", () => {
    const rs = regelRezeptProMelo(P);
    expect(rs.map((r) => r.thema.melo)).toEqual(["Melo Eins", "Melo Zwei"]);
    expect(rs[0].thema.kickFamilie).not.toBe(rs[1].thema.kickFamilie);
  });
  it("pruefeRezept: unbekannte Namen und falsche Werte werden ersetzt und gemeldet", () => {
    const kaputt = {
      modus: "jam", bpm: 999, begruendung: "",
      thema: { melo: "gibts nicht", kickFamilie: "snare", snare: "Melo Eins", hats: ["Hat close"] },
      abschnitte: [], figuren: { bass: "xyz" },
    };
    const { rezept, korrekturen } = pruefeRezept(kaputt, P);
    expect(rezept.bpm).toBe(180);
    expect(rezept.thema.melo).toBe("Melo Eins");
    expect(rezept.thema.kickFamilie).toBe("kick a");
    expect(rezept.thema.snare).toBe("Snare");
    expect(rezept.thema.hats).toHaveLength(2);
    expect(rezept.abschnitte.length).toBeGreaterThanOrEqual(1);
    expect(rezept.figuren.bass).toBe("off");
    expect(korrekturen.length).toBeGreaterThanOrEqual(5);
  });
  it("pruefeRezept: gueltiges Rezept bleibt unveraendert", () => {
    const r = regelRezept(P, { modus: "miniset" });
    const { rezept, korrekturen } = pruefeRezept(JSON.parse(JSON.stringify(r)), P);
    expect(korrekturen).toEqual([]);
    expect(rezept).toEqual(r);
  });
});
