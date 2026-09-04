import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { klangProfil, konflikt, type Klangprofil } from "../src/core/klangProfil";
import { vertraeglich, harmonisch, klangWaehler, figurAusDichte, dichteText, KONFLIKT_GRENZE } from "../src/core/klangWahl";
import { tonartenPassen } from "../src/core/keyAnalyse";
import { regelRezept } from "../src/core/rezept";
import type { Projekt, ProjektSample } from "../src/core/bankPlan";

const KORG3 = path.resolve("examples/e2s/korg3");
const profilVon = (datei: string): Klangprofil => {
  const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, datei))));
  return klangProfil(w.pcm, w.sampleRate);
};

const KICK = profilVon("KeTTeR KicK.wav");
const KICK2 = profilVon("RoBBaFFerT KicK4.wav");
const HAT = profilVon("RoBBaFFerT HaT 1.wav");
const TON = profilVon("MoRaL ToN2.wav");

interface Kandidat {
  name: string;
  klang?: Klangprofil;
}

describe("vertraeglich: was sich im Weg steht, faellt raus", () => {
  it("eine zweite Kick faellt aus dem Snare-Topf, Hat und Ton bleiben", () => {
    const topf: Kandidat[] = [
      { name: "kick-artig", klang: KICK2 },
      { name: "hat", klang: HAT },
      { name: "ton", klang: TON },
    ];
    // Voraussetzung des Tests: die beiden Kicks sind sich wirklich zu aehnlich.
    expect(konflikt(KICK, KICK2)).toBeGreaterThan(KONFLIKT_GRENZE);
    const ok = vertraeglich(topf, [KICK]).map((t) => t.name);
    expect(ok).toEqual(["hat", "ton"]);
  });

  it("die Reihenfolge bleibt — der Zaehler soll weiter Abwechslung finden", () => {
    const topf: Kandidat[] = [
      { name: "a", klang: HAT },
      { name: "b", klang: TON },
      { name: "c", klang: HAT },
    ];
    expect(vertraeglich(topf, [KICK]).map((t) => t.name)).toEqual(["a", "b", "c"]);
  });

  it("Rueckfall 1: ohne gemessene Nachbarn bleibt der Topf, wie er ist", () => {
    const topf: Kandidat[] = [{ name: "a" }, { name: "b" }];
    expect(vertraeglich(topf, [])).toHaveLength(2);
    expect(vertraeglich(topf, [undefined])).toHaveLength(2);
  });

  it("Rueckfall 2: Samples ohne eigenes Profil fallen nie heraus", () => {
    const topf: Kandidat[] = [{ name: "unbekannt" }, { name: "kick", klang: KICK2 }];
    expect(vertraeglich(topf, [KICK]).map((t) => t.name)).toEqual(["unbekannt"]);
  });

  it("Rueckfall 3: steht alles im Weg, kommt der am wenigsten schlimme statt gar keiner", () => {
    const topf: Kandidat[] = [
      { name: "k1", klang: KICK },
      { name: "k2", klang: KICK2 },
      { name: "k3", klang: KICK },
    ];
    const ok = vertraeglich(topf, [KICK]);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(ok.length).toBeLessThan(topf.length);
  });

  it("ein leerer Topf bleibt leer", () => {
    expect(vertraeglich([], [KICK])).toEqual([]);
  });
});

describe("klangWaehler: gesetzte Klaenge engen die naechste Wahl ein", () => {
  it("merkt sich, was gewaehlt wurde", () => {
    const w = klangWaehler();
    expect(w.anzahl).toBe(0);
    expect(w.topf([{ klang: KICK2 }])).toHaveLength(1);
    w.merke({ klang: KICK });
    expect(w.anzahl).toBe(1);
    expect(w.topf([{ klang: KICK2 }, { klang: HAT }])).toHaveLength(1);
  });

  it("Vorbelegung zaehlt sofort — die Melodie steht vor allem anderen", () => {
    const w = klangWaehler([KICK]);
    expect(w.anzahl).toBe(1);
    expect(w.topf([{ klang: KICK2 }, { klang: HAT }]).map((x) => x.klang)).toEqual([HAT]);
  });

  it("merke ignoriert, was kein Profil hat", () => {
    const w = klangWaehler();
    w.merke(undefined);
    w.merke({});
    expect(w.anzahl).toBe(0);
  });
});

describe("figurAusDichte: die Kick richtet sich nach der Melodie", () => {
  it("ruhige Melodie → Bewegung in der Kick, dichte Melodie → Viertel", () => {
    expect(figurAusDichte(1.5)).toBe("galopp");
    expect(figurAusDichte(6.75)).toBe("hart");
    expect(figurAusDichte(10.5)).toBe("vier");
  });

  it("roll kommt nie heraus — das ist die Aufbau-Figur", () => {
    for (const d of [0, 0.5, 2, 4, 9.9, 10, 40, 1000]) expect(figurAusDichte(d)).not.toBe("roll");
  });

  it("unsinnige Werte geben die ruhigste Figur", () => {
    expect(figurAusDichte(0)).toBe("vier");
    expect(figurAusDichte(-3)).toBe("vier");
    expect(figurAusDichte(NaN)).toBe("vier");
  });

  it("dichteText nennt Zahl und Folge", () => {
    expect(dichteText(1.5)).toMatch(/ruhig.*1\.5.*galopp/);
    expect(dichteText(12)).toMatch(/dicht.*vier/);
  });
});

describe("regelRezept: die Messung greift nur, wo nichts gesagt wurde", () => {
  const s = (nr: number, name: string, rolle: ProjektSample["rolle"], extra: Partial<ProjektSample> = {}): ProjektSample => ({
    nr, name, rolle, familie: name.toLowerCase().replace(/\d+$/, "").trim(), kind: "oneshot", takte: 0,
    sekunden: 0.3, rmsDb: -6, quelle: name, gruppe: rolle, ...extra,
  });
  const projektMit = (meloKlang?: Klangprofil): Projekt => ({
    name: "t", bpm: 180, budgetSekunden: 235, volume: 1, volumes: 1, tekkDrums: false, status: "gebaut", bankZeit: "x",
    samples: [
      s(501, "Kick A1", "kick"), s(502, "Kick A2", "kick"),
      s(503, "Snare", "snare"), s(504, "Hat close", "hat", { sekunden: 0.1 }), s(505, "Hat open", "hat", { sekunden: 0.4 }),
      s(506, "Melo Eins", "melo", { kind: "loop", takte: 4, sekunden: 5.33, gruppe: "melo:melo eins", klang: meloKlang }),
    ],
  });

  it("ohne Profil bleibt es bei der bisherigen Vorgabe", () => {
    const r = regelRezept(projektMit(undefined), { modus: "jam" });
    expect(r.abschnitte[0].kick).toBe("vier");
    expect(r.begruendung).not.toMatch(/Anschläge/);
  });

  it("mit gemessener, ruhiger Melodie wird die Kick beweglicher", () => {
    const ruhig: Klangprofil = { ...KICK, dichte: 1.5 };
    const r = regelRezept(projektMit(ruhig), { modus: "jam" });
    expect(r.abschnitte[0].kick).toBe("galopp");
    expect(r.begruendung).toMatch(/1\.5 Anschläge\/Takt/);
  });

  it("mit dichter Melodie haelt sich die Kick zurueck", () => {
    const dicht: Klangprofil = { ...KICK, dichte: 12 };
    expect(regelRezept(projektMit(dicht), { modus: "jam" }).abschnitte[0].kick).toBe("vier");
  });

  it("ein ausgesprochener Wunsch schlaegt die Messung", () => {
    const ruhig: Klangprofil = { ...KICK, dichte: 1.5 };
    const r = regelRezept(projektMit(ruhig), { modus: "jam", beschreibung: "hart und schnell" });
    expect(r.abschnitte[0].kick).toBe("hart");
    expect(r.begruendung).not.toMatch(/Anschläge/);
  });
});

describe("harmonisch: die tonalen Lagen muessen zur Melodie passen", () => {
  const t = (camelot: string, konfidenz = 0.3) => ({ name: camelot, camelot, konfidenz });
  const topf = [
    { name: "gleich", tonart: t("8A") },
    { name: "nachbar", tonart: t("9A") },
    { name: "parallele", tonart: t("8B") },
    { name: "fremd", tonart: t("2A") },
    { name: "unsicher", tonart: t("2A", 0.01) },
    { name: "unbekannt" },
  ];

  it("nimmt gleiche, benachbarte und parallele Tonart — nicht die fremde", () => {
    expect(harmonisch(topf, t("8A")).map((x) => x.name)).toEqual(["gleich", "nachbar", "parallele", "unsicher", "unbekannt"]);
  });

  it("das Rad ist rund — 1 und 12 sind Nachbarn", () => {
    expect(tonartenPassen(t("1A"), t("12A"))).toBe(true);
    expect(tonartenPassen(t("12A"), t("1A"))).toBe(true);
    expect(tonartenPassen(t("1A"), t("3A"))).toBe(false);
  });

  it("ein Nachbar auf der anderen Seite des Rads passt nicht", () => {
    expect(tonartenPassen(t("8A"), t("9B"))).toBe(false);
    expect(tonartenPassen(t("8A"), t("8B"))).toBe(true);
  });

  it("Rueckfall: ohne oder mit unsicherer Angabe wird nicht aussortiert", () => {
    expect(tonartenPassen(undefined, t("8A"))).toBe(true);
    expect(tonartenPassen(t("8A"), undefined)).toBe(true);
    expect(tonartenPassen(t("8A"), t("2A", 0.01))).toBe(true);
    expect(tonartenPassen(t("8A"), t("kaputt"))).toBe(true);
    expect(harmonisch(topf, undefined)).toHaveLength(topf.length);
  });

  it("passt gar nichts, bleibt der ganze Topf — ein stummer Part ist schlechter", () => {
    expect(harmonisch([{ name: "fremd", tonart: t("2A") }], t("8A"))).toHaveLength(1);
  });

  it("der tonale Topf des Waehlers filtert nach Klang UND Tonart", () => {
    const w = klangWaehler([KICK], t("8A"));
    const kandidaten = [
      { name: "kick-artig, passende Tonart", klang: KICK2, tonart: t("8A") },
      { name: "vertraeglich, fremde Tonart", klang: HAT, tonart: t("2A") },
      { name: "vertraeglich, passende Tonart", klang: TON, tonart: t("9A") },
    ];
    expect(w.tonalerTopf(kandidaten).map((x) => x.name)).toEqual(["vertraeglich, passende Tonart"]);
    // Ohne Tonart-Filter bliebe auch die fremde Tonart drin.
    expect(w.topf(kandidaten)).toHaveLength(2);
  });
});
