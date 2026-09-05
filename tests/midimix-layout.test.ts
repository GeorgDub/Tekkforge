import { describe, it, expect } from "vitest";
import {
  MIDIMIX,
  layoutMixer,
  layoutFx,
  LAYOUT_VORGABEN,
  reglerOrt,
  tastenOrt,
  zielAnOrt,
  setzeZiel,
  reglerNachrichten,
  tastenNachrichten,
  beschreibeZiel,
  zielWert,
  reglerZielAus,
  tastenZielAus,
  serialisiereLayout,
  deserialisiereLayout,
} from "../src/core/midimixLayout";

describe("midimixLayout", () => {
  it("Werkseinstellung: jeder Regler und Fader ist genau einem Ort zugeordnet", () => {
    const alle = [...MIDIMIX.knobs.flat(), ...MIDIMIX.fader, MIDIMIX.master];
    expect(new Set(alle).size).toBe(alle.length);
    expect(reglerOrt(16)).toEqual({ spalte: 0, was: "knob1" });
    expect(reglerOrt(60)).toEqual({ spalte: 7, was: "knob3" });
    expect(reglerOrt(31)).toEqual({ spalte: 3, was: "fader" });
    expect(reglerOrt(62)).toEqual({ spalte: -1, was: "master" });
    expect(reglerOrt(74)).toBeNull();
    expect(tastenOrt(1)).toEqual({ spalte: 0, was: "mute" });
    expect(tastenOrt(24)).toEqual({ spalte: 7, was: "rec" });
    expect(tastenOrt(99)).toBeNull();
  });

  it("Mixer-Vorgabe: Spalte i → Part i, Fader = Level, Master = MFX X", () => {
    const l = layoutMixer(1);
    expect(l.spalten).toHaveLength(8);
    expect(zielAnOrt(l, reglerOrt(19)!)).toEqual({ art: "part", part: 1, key: "volume" });
    expect(zielAnOrt(l, reglerOrt(16)!)).toEqual({ art: "part", part: 1, key: "cutoff" });
    expect(zielAnOrt(l, reglerOrt(58)!)).toEqual({ art: "part", part: 8, key: "cutoff" });
    expect(l.master).toEqual({ art: "mfx", was: "x" });
    expect(layoutMixer(9).spalten[7].fader).toEqual({ art: "part", part: 16, key: "volume" });
    expect(LAYOUT_VORGABEN.map((v) => v.id)).toContain("fx9");
    expect(layoutFx(1).spalten[0].knobs[2]).toEqual({ art: "fx", part: 1, slot: 0, param: 2 });
  });

  it("reglerNachrichten: Part-Parameter als Stock-CC auf dem Part-Kanal, MFX auf dem Global-Kanal, FX als NRPN", () => {
    const cc = reglerNachrichten({ art: "part", part: 3, key: "cutoff" }, 100, 0);
    expect(cc).toHaveLength(1);
    expect([...cc[0]]).toEqual([0xb2, 74, 100]);
    const pitch = reglerNachrichten({ art: "part", part: 1, key: "oscPitch" }, 64, 0);
    expect([...pitch[0]]).toEqual([0xb0, 80, 64]);
    const mfx = reglerNachrichten({ art: "mfx", was: "y" }, 50, 4);
    expect([...mfx[0]]).toEqual([0xb4, 103, 50]);
    const fx = reglerNachrichten({ art: "fx", part: 2, slot: 1, param: 3 }, 77, 0);
    expect(fx.length).toBeGreaterThanOrEqual(4);
    expect(fx.every((m) => (m[0] & 0xf0) === 0xb0)).toBe(true);
    expect(reglerNachrichten(null, 10, 0)).toEqual([]);
    expect(reglerNachrichten({ art: "part", part: 1, key: "gibtEsNicht" }, 10, 0)).toEqual([]);
  });

  it("tastenNachrichten: Trigger spielt Note 60 auf dem Part-Kanal, Mute sendet nichts", () => {
    const an = tastenNachrichten({ art: "trigger", part: 5 }, true);
    expect([...an[0]]).toEqual([0x94, 60, 110]);
    const aus = tastenNachrichten({ art: "trigger", part: 5 }, false);
    expect(aus[0][0]).toBe(0x84);
    expect(tastenNachrichten({ art: "mute", part: 2 }, true)).toEqual([]);
  });

  it("Ziele als Text hin und zurueck, Beschreibungen lesbar", () => {
    for (const z of [{ art: "part", part: 4, key: "resonance" }, { art: "fx", part: 2, slot: 1, param: 5 }, { art: "mfx", was: "x" }, { art: "mfxParam", param: 2 }] as const) {
      expect(reglerZielAus(zielWert(z))).toEqual(z);
    }
    expect(tastenZielAus(zielWert({ art: "trigger", part: 7 }))).toEqual({ art: "trigger", part: 7 });
    expect(reglerZielAus("")).toBeNull();
    expect(beschreibeZiel({ art: "part", part: 4, key: "resonance" })).toBe("Part 4 · Resonance");
    expect(beschreibeZiel({ art: "mfx", was: "x" })).toBe("Master-FX X");
    expect(beschreibeZiel(null)).toBe("—");
  });

  it("setzen, speichern, laden — und Unbrauchbares wird zum Mixer", () => {
    const l = layoutMixer(1);
    setzeZiel(l, reglerOrt(17)!, { art: "part", part: 12, key: "pan" });
    setzeZiel(l, reglerOrt(62)!, { art: "mfxParam", param: 1 });
    const zurueck = deserialisiereLayout(serialisiereLayout(l));
    expect(zurueck).toEqual(l);
    expect(zurueck.spalten[0].knobs[1]).toEqual({ art: "part", part: 12, key: "pan" });
    expect(deserialisiereLayout("kaputt").name).toMatch(/Mixer/);
    expect(deserialisiereLayout({ version: 2 }).spalten).toHaveLength(8);
  });
});

import { MIDIMIX_BANK, naechsteVorgabeId, vorgabeIdVon, ledNachrichten } from "../src/core/midimixLayout";

describe("midimixLayout — Bank-Tasten und LEDs", () => {
  it("Bank rechts/links blaettert zyklisch durch die Vorgaben, eigenes Layout beginnt vorn", () => {
    expect(MIDIMIX_BANK).toEqual({ links: 25, rechts: 26 });
    expect(naechsteVorgabeId("mixer1", 1)).toBe("mixer9");
    expect(naechsteVorgabeId("fx9", 1)).toBe("mixer1");
    expect(naechsteVorgabeId("mixer1", -1)).toBe("fx9");
    expect(naechsteVorgabeId(null, 1)).toBe("mixer1");
    expect(naechsteVorgabeId("eigenes", -1)).toBe("fx9");
    expect(vorgabeIdVon(layoutMixer(9))).toBe("mixer9");
    const eigen = layoutMixer(1);
    eigen.name = "eigenes Layout";
    expect(vorgabeIdVon(eigen)).toBeNull();
  });

  it("ledNachrichten: Mute-LED folgt dem Part-Mute, Rec-LEDs aus", () => {
    const l = layoutMixer(1);
    const muted = [true, false, false, true, false, false, false, false];
    const msgs = ledNachrichten(l, muted);
    expect(msgs).toHaveLength(16);
    expect([...msgs[0]]).toEqual([0x90, 1, 127]);
    expect([...msgs[2]]).toEqual([0x90, 4, 0]);
    expect([...msgs[6]]).toEqual([0x90, 10, 127]);
    expect(msgs.filter((m, i) => i % 2 === 1).every((m) => m[2] === 0)).toBe(true);
    const l9 = layoutMixer(9);
    expect([...ledNachrichten(l9, [...muted, true])[0]]).toEqual([0x90, 1, 127]);
  });
});
