import { describe, it, expect } from "vitest";
import {
  MIDIMIX_FX_CCS,
  standardControllerMap,
  paramFuerCc,
  baueFxLiveNachricht,
  GLOBAL_MIDI_THRU,
  baueMidiThru,
  type FxLiveZiel,
} from "../src/core/fxLive";
import { MFX_SLOT, NRPN_CATEGORY, NRPN_CC } from "../src/core/hacktribeNrpn";

describe("fxLive", () => {
  it("MIDImix-Standardbelegung: 24 Regler auf die Parameter 0..23", () => {
    const map = standardControllerMap();
    expect(map).toHaveLength(24);
    expect(map).toEqual([...MIDIMIX_FX_CCS]);
    // Aus midi_map.py des ht-cli-Zweigs: erster Regler CC 16, letzter CC 60
    expect(map[0]).toBe(16);
    expect(map[23]).toBe(60);
  });

  it("paramFuerCc findet den Parameter-Index, sonst null", () => {
    const map = standardControllerMap();
    expect(paramFuerCc(map, 16)).toBe(0);
    expect(paramFuerCc(map, 17)).toBe(1);
    expect(paramFuerCc(map, 60)).toBe(23);
    expect(paramFuerCc(map, 19)).toBeNull(); // im MIDImix-Raster ausgelassen
    expect(paramFuerCc(map, 127)).toBeNull();
  });

  it("baut die NRPN-Folge fuer einen Part-Regler", () => {
    const ziel: FxLiveZiel = { art: "part", part: 3, slot: 0 };
    const msgs = baueFxLiveNachricht({ ziel, map: standardControllerMap(), cc: 18, wert: 100, kanal0: 0 });
    expect(msgs).not.toBeNull();
    const flach = msgs!.flat();
    // NRPN-MSB = Kategorie 1 (FX-Parameter setzen)
    expect(flach[1]).toBe(NRPN_CC.msb);
    expect(flach[2]).toBe(NRPN_CATEGORY.setFxParam);
    // NRPN-LSB = FX-Slot: Part 3, erster Insert-Slot -> (3-1)*2 = 4
    expect(flach[4]).toBe(NRPN_CC.lsb);
    expect(flach[5]).toBe(4);
    // DATA-MSB = Parameter-Index (CC 18 ist der dritte Regler -> 2)
    expect(flach[7]).toBe(NRPN_CC.dataMsb);
    expect(flach[8]).toBe(2);
    // DATA-LSB = Wert
    expect(flach[10]).toBe(NRPN_CC.dataLsb);
    expect(flach[11]).toBe(100);
  });

  it("Ziel Master-Effekt nutzt den MFX-Slot", () => {
    const msgs = baueFxLiveNachricht({ ziel: { art: "mfx" }, map: standardControllerMap(), cc: 16, wert: 64, kanal0: 0 });
    expect(msgs!.flat()[5]).toBe(MFX_SLOT);
  });

  it("unbekannter Regler ergibt keine Nachricht", () => {
    const msgs = baueFxLiveNachricht({ ziel: { art: "mfx" }, map: standardControllerMap(), cc: 19, wert: 64, kanal0: 0 });
    expect(msgs).toBeNull();
  });

  it("zweiter Insert-Slot eines Parts", () => {
    const msgs = baueFxLiveNachricht({ ziel: { art: "part", part: 1, slot: 1 }, map: standardControllerMap(), cc: 16, wert: 1, kanal0: 0 });
    expect(msgs!.flat()[5]).toBe(1); // (1-1)*2 + 1
  });

  it("MIDI-Thru: dokumentierte Global-Einstellung als NRPN", () => {
    // Aus Diskussion #189: NRPN-MSB 0x03, LSB 0x00, DATA-MSB 0x2C, DATA-LSB 0x01
    expect(GLOBAL_MIDI_THRU).toBe(0x2c);
    const flach = baueMidiThru(0, true).flat();
    expect(flach.filter((_, i) => i % 3 === 1)).toEqual([NRPN_CC.msb, NRPN_CC.lsb, NRPN_CC.dataMsb, NRPN_CC.dataLsb]);
    expect(flach.filter((_, i) => i % 3 === 2)).toEqual([0x03, 0x00, 0x2c, 0x01]);
    expect(baueMidiThru(0, false).flat()[11]).toBe(0x00);
  });
});
