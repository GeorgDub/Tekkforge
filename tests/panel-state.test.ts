/**
 * tests/panel-state.test.ts — LED-/Step-Abbildung fürs E2S-Panel.
 *
 * Die Zuordnungen spiegeln die am Gerät gemessenen Bedeutungen aus
 * partParams.ts: ampEgOn/mfxSend/ifxOn sind 0/1-Schalter, filterType
 * gruppiert sich in 0=off, 1–6 LPF, 7–11 HPF, 12–16 BPF (Stock nutzt
 * {0, 1, 7, 12}).
 */

import { describe, it, expect } from "vitest";
import { createPattern } from "../src/core/editorModel";
import {
  displayInfo,
  filterBand,
  partLeds,
  stepStates,
  taktAnzahl,
} from "../src/core/panelState";

function pattern() {
  const p = createPattern("TESTMUSTER");
  p.bpm = 172;
  p.stepLength = 64;
  return p;
}

describe("filterBand — gemessene Gruppierung", () => {
  it("ordnet die vier Stock-Typen den Band-LEDs zu", () => {
    expect(filterBand(0)).toBe("off");
    expect(filterBand(1)).toBe("lpf");
    expect(filterBand(7)).toBe("hpf");
    expect(filterBand(12)).toBe("bpf");
  });

  it("kennt die Familien-Grenzen und Hacktribe-Erweiterungen", () => {
    expect(filterBand(6)).toBe("lpf");
    expect(filterBand(11)).toBe("hpf");
    expect(filterBand(16)).toBe("bpf");
    expect(filterBand(17)).toBe("ext");
    expect(filterBand(undefined)).toBe("off");
  });
});

describe("partLeds", () => {
  it("liest Mute und die drei Schalter-LEDs aus dem Part", () => {
    const p = pattern();
    p.parts[2].muted = true;
    p.parts[2].params = { ampEgOn: 1, mfxSend: 0, ifxOn: 1, filterType: 7 };
    const leds = partLeds(p, 2);
    expect(leds).toEqual({ mute: true, ampEg: true, mfxSend: false, ifxOn: true, band: "hpf" });
  });

  it("ist ohne params komplett dunkel", () => {
    const p = pattern();
    expect(partLeds(p, 0)).toEqual({
      mute: false,
      ampEg: false,
      mfxSend: false,
      ifxOn: false,
      band: "off",
    });
  });
});

describe("stepStates", () => {
  it("liefert die 16 Steps des gewaehlten Takts", () => {
    const p = pattern();
    p.parts[0].steps[0].on = true;
    p.parts[0].steps[18].on = true; // Takt 2, Step 3
    expect(stepStates(p, 0, 0)[0]).toBe(true);
    expect(stepStates(p, 0, 0)[2]).toBe(false);
    expect(stepStates(p, 0, 1)[2]).toBe(true);
  });

  it("zeigt jenseits der Steplaenge nichts an — wie das Geraet", () => {
    const p = pattern();
    p.stepLength = 16;
    p.parts[0].steps[20].on = true; // liegt hinter der Steplaenge
    expect(stepStates(p, 0, 1).every((s) => s === false)).toBe(true);
  });
});

describe("Display + Taktwahl", () => {
  it("displayInfo traegt Name, BPM und die Part-Zeile", () => {
    const p = pattern();
    p.parts[0].sampleNumber = 501;
    const d = displayInfo(p, 0);
    expect(d.name).toBe("TESTMUSTER");
    expect(d.bpm).toBe(172);
    expect(d.partNo).toBe(1);
    expect(d.sampleNumber).toBe(501);
  });

  it("taktAnzahl folgt der Steplaenge (16/32/64 → 1/2/4)", () => {
    const p = pattern();
    p.stepLength = 16;
    expect(taktAnzahl(p)).toBe(1);
    p.stepLength = 32;
    expect(taktAnzahl(p)).toBe(2);
    p.stepLength = 64;
    expect(taktAnzahl(p)).toBe(4);
  });
});
