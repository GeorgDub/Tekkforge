import { describe, it, expect } from "vitest";
import {
  analysiere,
  crossgrade,
  unterschiedsBytes,
  VARIANTEN,
  VSB_TOTAL,
  VSB_HEADER,
  OFF_SUFFIX,
  OFF_ID_LOW,
  OFF_ID_HIGH,
  OFF_TAG,
  type Variante,
} from "../src/core/crossgrade";

/** Schnelle Byte-Gleichheit — toEqual auf 2-MB-Arrays ist in Vitest zu langsam. */
function bytesGleich(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Das Umkoepfen einer electribe-2-SYSTEM.VSB zwischen Synth und Sampler.
 * Getestet gegen ein synthetisches Minimal-VSB (die echten Korg-Abbilder
 * liegen nicht im Repo). Die Byte-Logik ist dieselbe wie im Python-Werkzeug
 * tools/crossgrade/e2_crossgrade.py in Omnitribe.
 */
function macheVsb(variante: Variante, fuell = 0xab): Uint8Array {
  const v = VARIANTEN[variante];
  const b = new Uint8Array(VSB_TOTAL).fill(fuell);
  const asc = (s: string, off: number) => {
    for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i);
  };
  // Kopf zuerst nullen, dann Felder setzen
  for (let i = 0; i < VSB_HEADER; i++) b[i] = 0;
  asc("KORG SYSTEM FILE", 0);
  asc(variante === "sampler" ? "E2S" : "E2", 0x10);
  asc("SYSTEM", OFF_TAG);
  b[OFF_ID_HIGH] = 0x01;
  b[OFF_ID_LOW] = v.idLow;
  b[OFF_SUFFIX] = v.suffix;
  return b;
}

describe("crossgrade — analysieren", () => {
  it("erkennt beide Varianten und ihre Device-ID", () => {
    expect(analysiere(macheVsb("synth")).variante).toBe("synth");
    expect(analysiere(macheVsb("sampler")).variante).toBe("sampler");
    expect(analysiere(macheVsb("synth")).deviceId).toBe(0x0123);
    expect(analysiere(macheVsb("sampler")).deviceId).toBe(0x0124);
    expect(analysiere(macheVsb("synth")).ok).toBe(true);
  });

  it("lehnt falsche Größe, fehlendes Magic, falschen Tag und fremde Device-ID ab", () => {
    expect(analysiere(new Uint8Array(100)).ok).toBe(false);
    const keinMagic = macheVsb("synth");
    keinMagic[0] = 0x58;
    expect(analysiere(keinMagic).ok).toBe(false);
    const falscherTag = macheVsb("synth");
    "PCM\0\0\0".split("").forEach((c, i) => (falscherTag[OFF_TAG + i] = c.charCodeAt(0)));
    expect(analysiere(falscherTag).ok).toBe(false);
    const fremdeId = macheVsb("synth");
    fremdeId[OFF_ID_LOW] = 0x30;
    fremdeId[OFF_SUFFIX] = 0x00;
    expect(analysiere(fremdeId).ok).toBe(false);
  });
});

describe("crossgrade — umkoepfen", () => {
  it("ändert genau die zwei Kopf-Bytes und lässt den Payload unangetastet", () => {
    const syn = macheVsb("synth");
    const r = crossgrade(syn, "sampler");
    expect(r.geaendert).toEqual([OFF_SUFFIX, OFF_ID_LOW]);
    expect(r.bytes[OFF_SUFFIX]).toBe(0x53);
    expect(r.bytes[OFF_ID_LOW]).toBe(0x24);
    expect(r.sdPfad).toBe("KORG/electribe sampler/System/SYSTEM.VSB");
    expect(bytesGleich(r.bytes.slice(VSB_HEADER), syn.slice(VSB_HEADER))).toBe(true);
    expect(analysiere(r.bytes).variante).toBe("sampler");
  });

  it("Roundtrip Synth → Sampler → Synth ist byte-identisch", () => {
    const syn = macheVsb("synth");
    const zurueck = crossgrade(crossgrade(syn, "sampler").bytes, "synth").bytes;
    expect(bytesGleich(zurueck, syn)).toBe(true);
  });

  it("wirft bei Müll und wenn die Datei schon die Zielvariante ist", () => {
    expect(() => crossgrade(new Uint8Array(10), "sampler")).toThrow(/abgelehnt/);
    expect(() => crossgrade(macheVsb("sampler"), "sampler")).toThrow(/bereits/);
  });

  it("die Eingabe wird nicht mutiert", () => {
    const syn = macheVsb("synth");
    const kopie = new Uint8Array(syn);
    crossgrade(syn, "sampler");
    expect(bytesGleich(syn, kopie)).toBe(true);
  });

  it("unterschiedsBytes findet Abweichungen und Längendifferenz", () => {
    expect(unterschiedsBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]))).toEqual([1]);
    expect(unterschiedsBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toEqual([1]);
  });
});
