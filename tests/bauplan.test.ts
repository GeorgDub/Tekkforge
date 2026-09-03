import { describe, it, expect } from "vitest";
import { baueBauplan, leseBauplan, wendeBauplanAn, BAUPLAN_VERSION } from "../src/core/bauplan";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";
import { initGrooveBytes, decodeGroove, encodeGroove, GROOVE_SIZE } from "../src/core/e2Groove";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam";
import { IFX_ZAEHLER } from "../src/core/ifxErweiterung";
import {
  VSB_GROESSE,
  dateiOffset,
  GROOVE_ZAEHLER,
  INIT_PATTERN_OFFSET,
  INIT_PATTERN_GROESSE,
  SPLASH_OFFSET,
  INIT_GLOBAL_OFFSET,
  INIT_GLOBAL_GROESSE,
  liesInitPattern,
} from "../src/core/firmwareBau";
import { leererSplash, pixelZuSplash, SPLASH_BREITE, SPLASH_HOEHE } from "../src/core/splash";
import { LDR_START, hexZuBytes, type DspPatch } from "../src/core/dspPatch";

const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
const grooveMap = E2_RAM_MAP.find((e) => e.key === "groove")!;

function presetBytes(name: string, mfx = false): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), mfx);
  p.name = name;
  return encodeFxPreset(p);
}
function grooveBytes(name: string): Uint8Array {
  const g = decodeGroove(initGrooveBytes());
  g.name = name;
  return encodeGroove(g);
}
function globalBlock(clock: number): Uint8Array {
  const g = new Uint8Array(INIT_GLOBAL_GROESSE);
  g.set(new TextEncoder().encode("GLST"), 0);
  g[0x28] = clock;
  g.set(new TextEncoder().encode("GLED"), 0xfc);
  return g;
}
function fakeFirmware(): Uint8Array {
  const fw = new Uint8Array(VSB_GROESSE);
  fw.set(new TextEncoder().encode("KORG SYSTEM FILE"), 0);
  fw.set(new TextEncoder().encode("E2S"), 0x10);
  for (let s = 0; s < ifxMap.count; s++) fw.set(s < 49 ? presetBytes(`Werk ${s + 1}`) : presetBytes(""), dateiOffset(addressForSlot(ifxMap, s)));
  for (const z of IFX_ZAEHLER) fw[dateiOffset(z.addr)] = z.plusEins ? 49 : 48;
  for (let s = 0; s < grooveMap.count; s++) {
    const off = dateiOffset(addressForSlot(grooveMap, s));
    if (s < 62) fw.set(grooveBytes(`G${s + 1}`), off);
    else fw.fill(0xff, off, off + GROOVE_SIZE);
  }
  for (const z of GROOVE_ZAEHLER) fw[dateiOffset(z.addr)] = z.plusEins ? 62 : 61;
  fw.set(new TextEncoder().encode("PTST"), INIT_PATTERN_OFFSET);
  fw.set(new TextEncoder().encode("PTED"), INIT_PATTERN_OFFSET + INIT_PATTERN_GROESSE - 4);
  fw.set(leererSplash(), SPLASH_OFFSET);
  fw.set(globalBlock(0), INIT_GLOBAL_OFFSET);
  return fw;
}

const initBlock = (): Uint8Array => {
  const b = new Uint8Array(INIT_PATTERN_GROESSE);
  b.set(new TextEncoder().encode("PTST"), 0);
  b.set(new TextEncoder().encode("MEIN INIT"), 0x10);
  b.set(new TextEncoder().encode("PTED"), INIT_PATTERN_GROESSE - 4);
  return b;
};

describe("bauplan", () => {
  it("Round-Trip: Eintraege, Init-Pattern, Startbild, Init-Global und Basis-Hash ueberleben", () => {
    const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
    px[5] = 1;
    const text = baueBauplan({
      titel: "Mein Umbau",
      autor: "Georg",
      basisSha256: "7cb4825c",
      eintraege: [
        { art: "ifx", name: "Ring LFO", bytes: presetBytes("Ring LFO"), platz: 50 },
        { art: "groove", name: "Swing", bytes: grooveBytes("Swing"), platz: 63 },
      ],
      initPattern: initBlock(),
      splash: pixelZuSplash(px),
      initGlobal: globalBlock(2),
    });
    const p = leseBauplan(text);
    expect(p.version).toBe(BAUPLAN_VERSION);
    expect(p.titel).toBe("Mein Umbau");
    expect(p.basisSha256).toBe("7cb4825c");
    expect(p.eintraege.map((e) => `${e.art}:${e.platz}`)).toEqual(["ifx:50", "groove:63"]);
    expect(p.initPattern?.length).toBe(INIT_PATTERN_GROESSE);
    expect(p.splash?.length).toBe(1024);
    expect(p.initGlobal?.[0x28]).toBe(2);
  });

  it("lehnt Unbrauchbares ab: kein JSON, falsche Version, Eintrag ohne Platz, falsche Groessen, leer", () => {
    expect(() => leseBauplan("nix")).toThrow(/JSON/);
    expect(() => leseBauplan(JSON.stringify({ version: 9, eintraege: [] }))).toThrow(/Version/);
    const ohnePlatz = JSON.parse(baueBauplan({ titel: "x", autor: "", eintraege: [{ art: "ifx", name: "A", bytes: presetBytes("A") }] }));
    expect(() => leseBauplan(JSON.stringify(ohnePlatz))).toThrow(/Platz/);
    const kaputt = JSON.parse(baueBauplan({ titel: "x", autor: "", eintraege: [], splash: leererSplash() }));
    kaputt.splash = "AAAA";
    expect(() => leseBauplan(JSON.stringify(kaputt))).toThrow(/Bytes/);
    expect(() => leseBauplan(JSON.stringify({ version: 1, titel: "x", eintraege: [] }))).toThrow(/leer/);
    const falschesGlobal = JSON.parse(baueBauplan({ titel: "x", autor: "", eintraege: [], initGlobal: new Uint8Array(INIT_GLOBAL_GROESSE) }));
    expect(() => leseBauplan(JSON.stringify(falschesGlobal))).toThrow(/GLST/);
  });

  it("wendeBauplanAn legt alles in die Basis — dieselben Schritte wie die Werkbank", () => {
    const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
    px[0] = 1;
    const plan = leseBauplan(
      baueBauplan({
        titel: "x",
        autor: "",
        eintraege: [
          { art: "ifx", name: "Ring LFO", bytes: presetBytes("Ring LFO"), platz: 50 },
          { art: "groove", name: "Swing", bytes: grooveBytes("Swing"), platz: 63 },
        ],
        initPattern: initBlock(),
        splash: pixelZuSplash(px),
        initGlobal: globalBlock(3),
      }),
    );
    const r = wendeBauplanAn(fakeFirmware(), plan);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const off = dateiOffset(addressForSlot(ifxMap, 49));
    expect(decodeFxPreset(r.bytes.subarray(off, off + FX_PRESET_SIZE)).name).toBe("Ring LFO");
    for (const z of IFX_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 50 : 49);
    for (const z of GROOVE_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 63 : 62);
    expect(String.fromCharCode(...liesInitPattern(r.bytes).subarray(0x110, 0x119))).toBe("MEIN INIT");
    expect(r.bytes[SPLASH_OFFSET]).toBe(0x80);
    expect(r.bytes[INIT_GLOBAL_OFFSET + 0x28]).toBe(3);
    expect(r.zeilen).toEqual(["Presets: 1 IFX, 0 MFX, 1 Grooves", "IFX-Menü: bis 49 → bis 50", "Groove-Menü: bis 62 → bis 63", "Init-Pattern gesetzt", "Init-Global gesetzt", "Startbild gesetzt"]);
  });

  it("DSP-Patches reisen mit alten und neuen Bytes im Plan und werden beim Anwenden gesetzt — oder klar abgelehnt", () => {
    const patch: DspPatch = { id: "p", titel: "Probe", beschreibung: "", quelle: "t", status: "diskriminator", edits: [{ vaddr: 0x2000, alt: hexZuBytes("a0a1"), neu: hexZuBytes("ffff") }] };
    const text = baueBauplan({ titel: "D", autor: "", eintraege: [], dsp: [patch] });
    const plan = leseBauplan(text);
    expect(plan.dsp).toEqual([patch]);
    // Basis mit kleiner LDR-Kette: ein SDRAM-Block bei 0x2000 mit 0xA0…
    const fw = fakeFirmware();
    const kopf = (flags: number, ziel: number, laenge: number): Uint8Array => {
      const h = new Uint8Array(16);
      const dv = new DataView(h.buffer);
      dv.setUint32(0, ((0xad << 24) | flags) >>> 0, true);
      dv.setUint32(4, ziel >>> 0, true);
      dv.setUint32(8, laenge >>> 0, true);
      let x = 0;
      for (const b of h) x ^= b;
      h[2] = x;
      return h;
    };
    fw.set(kopf(0x0001, 0x2000, 8), LDR_START);
    fw.set([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7], LDR_START + 16);
    fw.set(kopf(0x0100 | 0x8000, 0x10000, 16), LDR_START + 24);
    const r = wendeBauplanAn(fw, plan);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.from(r.bytes.subarray(LDR_START + 16, LDR_START + 20))).toEqual([0xff, 0xff, 0xa2, 0xa3]);
    expect(r.zeilen).toContain("DSP-Patch „Probe“ gesetzt");
    // Basis ohne Kette: abgelehnt, mit Grund
    const ohne = wendeBauplanAn(fakeFirmware(), plan);
    expect(ohne.ok).toBe(false);
    if (!ohne.ok) expect(ohne.reason).toMatch(/DSP-Kette/);
    // Unbrauchbarer Patch im Plan
    expect(() => leseBauplan(text.replace('"dsp": [', '"dsp": [{"edits":[{"old":"00","new":"0000"}]},'))).toThrow(/DSP-Patch 1/);
  });

  it("ein Plan nur mit Startbild braucht keine Eintraege", () => {
    const plan = leseBauplan(baueBauplan({ titel: "nur Bild", autor: "", eintraege: [], splash: leererSplash() }));
    const r = wendeBauplanAn(fakeFirmware(), plan);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bericht).toBeNull();
    expect(r.zeilen).toEqual(["Startbild gesetzt"]);
  });
});
