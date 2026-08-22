import { describe, it, expect } from "vitest";
import type { Projekt, ProjektSample } from "../src/core/bankPlan";
import { REZEPT_SCHEMA, projektZusammenfassung, promptFuer, antwortZuRezept } from "../src/core/kiPlaner";
import { regelRezept } from "../src/core/rezept";

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
  ],
};

describe("kiPlaner", () => {
  it("Schema verlangt alle sechs Rezept-Felder und verbietet Fremdfelder", () => {
    const sch = REZEPT_SCHEMA as { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> };
    expect(sch.required.sort()).toEqual(["abschnitte", "begruendung", "bpm", "figuren", "modus", "thema"]);
    expect(sch.additionalProperties).toBe(false);
    expect(Object.keys(sch.properties.thema as object)).toContain("properties");
  });
  it("projektZusammenfassung nennt Melodien, Kick-Familien und Tempo", () => {
    const z = projektZusammenfassung(P);
    expect(z).toContain("Melo Eins");
    expect(z).toContain("Melo Zwei");
    expect(z).toContain("kick a");
    expect(z).toContain("kick b");
    expect(z).toContain("180");
    expect(z).toContain("Vox Loop");
  });
  it("promptFuer traegt Beschreibung, Modus, BPM und Figuren-Woerter", () => {
    const { system, user } = promptFuer(P, { modus: "miniset", bpm: 176, beschreibung: "duester, Vocal nur im Break" });
    expect(system).toMatch(/vier|hart|roll|galopp/);
    expect(system).toContain("arp");
    expect(user).toContain("duester, Vocal nur im Break");
    expect(user).toContain("miniset");
    expect(user).toContain("176");
    expect(user).toContain("Melo Zwei");
  });
  it("antwortZuRezept: gueltiges JSON → keine Korrekturen", () => {
    const r = regelRezept(P, { modus: "miniset", bpm: 176 });
    const { rezept, korrekturen } = antwortZuRezept(JSON.stringify(r), P);
    expect(korrekturen).toEqual([]);
    expect(rezept.bpm).toBe(176);
  });
  it("antwortZuRezept: Quatsch-JSON wird feldweise ersetzt", () => {
    const { rezept, korrekturen } = antwortZuRezept('{"modus":"jam","bpm":5,"thema":{"melo":"gibts nicht"}}', P);
    expect(korrekturen.length).toBeGreaterThan(0);
    expect(rezept.thema.melo).toBe("Melo Eins");
  });
  it("antwortZuRezept: kein JSON → Regel-Rezept mit Korrektur", () => {
    const { rezept, korrekturen } = antwortZuRezept("Hier ist dein Rezept: …", P);
    expect(korrekturen[0]).toContain("kein JSON");
    expect(rezept.modus).toBe("jam");
  });
});

describe("kiPlaner Pro Melo", () => {
  it("REZEPT_LISTE_SCHEMA verlangt rezepte", async () => {
    const { REZEPT_LISTE_SCHEMA } = await import("../src/core/kiPlaner");
    const sch = REZEPT_LISTE_SCHEMA as { required: string[]; properties: { rezepte: { type: string } } };
    expect(sch.required).toEqual(["rezepte"]);
    expect(sch.properties.rezepte.type).toBe("array");
  });
  it("promptFuerProMelo nennt jede Melodie und verlangt je eins", async () => {
    const { promptFuerProMelo } = await import("../src/core/kiPlaner");
    const { user } = promptFuerProMelo(P, { bpm: 180, beschreibung: "hart" });
    expect(user).toContain("Melo Eins");
    expect(user).toContain("Melo Zwei");
    expect(user).toMatch(/genau ein Rezept/);
  });
  it("antwortZuRezepte: Liste wird je Melodie zugeordnet, Fehlende per Regel ergaenzt", async () => {
    const { antwortZuRezepte } = await import("../src/core/kiPlaner");
    const eins = regelRezept(P, { modus: "jam", melo: "Melo Eins" });
    const { rezepte, korrekturen } = antwortZuRezepte(JSON.stringify({ rezepte: [eins] }), P);
    expect(rezepte.map((r) => r.thema.melo)).toEqual(["Melo Eins", "Melo Zwei"]);
    expect(rezepte.every((r) => r.modus === "promelo")).toBe(true);
    expect(korrekturen.some((k) => k.includes("Melo Zwei"))).toBe(true);
  });
  it("antwortZuRezepte: kein JSON → komplett Regel", async () => {
    const { antwortZuRezepte } = await import("../src/core/kiPlaner");
    const { rezepte, korrekturen } = antwortZuRezepte("nix", P);
    expect(rezepte).toHaveLength(2);
    expect(korrekturen[0]).toContain("kein JSON");
  });
});
