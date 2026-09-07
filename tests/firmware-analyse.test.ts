import { describe, it, expect } from "vitest";
import { analysiereFirmware, uebernehmeErweiterungen, unterschiedsLaeufe, bekannteBereiche, type FirmwareAnalyse } from "../src/core/firmwareAnalyse";
import { erkenneKarte, dateiOffset, presetOffset, presetName, KARTE_HACKTRIBE, KARTE_SAMPLER_STOCK, KARTE_SYNTH_STOCK, leseZaehler } from "../src/core/firmwareKarte";
import { fakeHacktribe, fakeSamplerStock, fakeSynthStock, presetBytes, grooveBytes, oszEintrag, modEintrag, asc } from "./helpers/fakeFirmware";
import { decodeGroove, GROOVE_SIZE } from "../src/core/e2Groove";
import { liesModTabelle } from "../src/core/modTabelle";
import { liesOsz, decodeOsz } from "../src/core/oszTabelle";

/**
 * Analyse einer modifizierten Firmware gegen ihre Stock-Referenz und die
 * Uebernahme der Erweiterungen in andere Karten — an nachgebauten Abbildern.
 */

/** Eine „modifizierte Hacktribe“: zwei neue IFX, ein umbenanntes Werks-IFX, ein neues MFX, ein Groove, ein Osz, ein Mod, ein Code-Byte, ein DSP-Byte. */
function modifizierteHacktribe(): Uint8Array {
  const fw = fakeHacktribe({ ifxBelegt: 51 });
  const k = KARTE_HACKTRIBE;
  fw.set(presetBytes("Tekk Drive"), presetOffset(k, fw, "ifx", 49)!);
  fw.set(presetBytes("Tekk Wash"), presetOffset(k, fw, "ifx", 50)!);
  fw.set(presetBytes("Punch 2"), presetOffset(k, fw, "ifx", 0)!);
  fw.set(presetBytes("Mein Master", true), presetOffset(k, fw, "mfx", 2)!);
  const gb = k.grooveBank!;
  fw.set(grooveBytes("Swing X"), dateiOffset(gb.base + 62 * gb.stride));
  for (const z of k.grooveZaehler!) fw[dateiOffset(z.addr)] = z.plusEins ? 63 : 62;
  const o = k.oszTabelle!;
  fw.set(oszEintrag("X-SAW +7"), dateiOffset(o.base) + 12 * o.stride);
  const m = k.modTabelle!;
  fw.set(modEintrag("SawUp Filter"), dateiOffset(m.base) + 4 * m.stride);
  fw[0x20000] ^= 0x5a; // Code
  fw[k.ldrStart! + 16 + 5] ^= 0x01; // DSP-Byte im L1-Block
  return fw;
}

describe("firmwareAnalyse — Inhalt", () => {
  it("Hacktribe: Presets aus den Bänken, Grooves, Tabellen, Init, Startbild, DSP", () => {
    const a = analysiereFirmware(fakeHacktribe()) as FirmwareAnalyse;
    expect(a.ok).toBe(true);
    expect(a.karte.id).toBe("hacktribe");
    expect(a.ifx.length).toBe(100);
    expect(a.ifx[0].name).toBe("Punch");
    expect(a.ifx[48].name).toBe("Hack IFX 49");
    expect(a.ifx[49].leer).toBe(true);
    expect(a.ifxMaxIndex).toBe(48);
    expect(a.mfx[0].name).toBe("Mod Delay");
    expect(a.grooves.filter((g) => !g.leer).length).toBe(62);
    expect(a.grooveMaxIndex).toBe(61);
    expect(a.osz.length).toBe(12);
    expect(a.osz[0].name).toBe("SAW");
    expect(a.mod.length).toBe(4);
    expect(a.initPatternName).toBe("Init Pattern");
    expect(a.initGlobal.clock).toBe(1);
    expect(a.splash?.dunkel).toBe(0);
    expect(a.dsp?.ok).toBe(true);
    expect(a.dsp?.bloecke).toBe(3);
    expect(a.erweiterungen).toEqual([]);
    expect(a.zeilen.join("\n")).toMatch(/IFX: 49 belegt von 100, Menü bis 49/);
  });

  it("Stock-Sampler und Stock-Synth: Presets über die Zeigertabellen, keine Grooves, kein Startbild beim Synth", () => {
    const s = analysiereFirmware(fakeSamplerStock()) as FirmwareAnalyse;
    expect(s.karte.id).toBe("sampler-stock");
    expect(s.ifx.length).toBe(38);
    expect(s.ifx[1].name).toBe("Overdrive");
    expect(s.mfx[3].name).toBe("Hall Reverb");
    expect(s.grooves).toEqual([]);
    expect(s.ifxMaxIndex).toBe(37);
    expect(s.splash).toBeDefined();
    const y = analysiereFirmware(fakeSynthStock()) as FirmwareAnalyse;
    expect(y.karte.id).toBe("synth-stock");
    expect(y.ifx[7].name).toBe("Limiter");
    expect(y.splash).toBeUndefined();
    expect(y.dsp?.ok).toBe(true);
    expect(y.zeilen[0]).toMatch(/Synth/);
  });

  it("lehnt Müll ab und meldet eine Referenz anderer Bauart", () => {
    expect(analysiereFirmware(new Uint8Array(5)).ok).toBe(false);
    const a = analysiereFirmware(fakeHacktribe(), fakeSynthStock()) as FirmwareAnalyse;
    expect(a.referenz?.gleicheBauart).toBe(false);
    expect(a.erweiterungen).toEqual([]);
    expect(a.zeilen.join("\n")).toMatch(/andere Bauart/);
  });
});

describe("firmwareAnalyse — Erweiterungen gegen die Referenz", () => {
  it("ordnet jeden Byte-Lauf seinem Bereich zu", () => {
    const a = analysiereFirmware(modifizierteHacktribe(), fakeHacktribe()) as FirmwareAnalyse;
    const ids = a.erweiterungen.map((e) => e.id);
    expect(ids).toContain("ifx:1");
    expect(ids).toContain("ifx:50");
    expect(ids).toContain("ifx:51");
    expect(ids).toContain("mfx:3");
    expect(ids).toContain("groove:63");
    expect(ids).toContain("osz:13");
    expect(ids).toContain("mod:5");
    expect(ids).toContain("code:0x20000");
    expect(ids.some((i) => i.startsWith("dsp:"))).toBe(true);
    // Zaehler tauchen nicht als Erweiterung auf
    expect(ids.some((i) => i.startsWith("zaehler"))).toBe(false);
    const ifx50 = a.erweiterungen.find((e) => e.id === "ifx:50")!;
    expect(ifx50.name).toBe("IFX 50: Tekk Drive");
    expect(ifx50.beschreibung).toMatch(/^neu/);
    expect(a.erweiterungen.find((e) => e.id === "ifx:1")!.beschreibung).toMatch(/^geändert/);
    // Uebertragbarkeit
    expect(ifx50.nach.hacktribe.ok).toBe(true);
    expect(ifx50.nach["sampler-stock"].ok).toBe(false);
    expect(a.erweiterungen.find((e) => e.id === "ifx:1")!.nach["synth-stock"]).toEqual({ ok: true, hinweis: "ersetzt Werks-IFX 1" });
    expect(a.erweiterungen.find((e) => e.id === "groove:63")!.nach["synth-stock"].ok).toBe(false);
    expect(a.erweiterungen.find((e) => e.id === "osz:13")!.nach["sampler-stock"].ok).toBe(false);
    expect(a.erweiterungen.find((e) => e.id === "code:0x20000")!.nach["synth-stock"].ok).toBe(false);
    expect(a.erweiterungen.find((e) => e.id === "code:0x20000")!.nach.hacktribe.ok).toBe(true);
    expect(a.zeilen.at(-1)).toMatch(/Erweiterung\(en\)/);
  });

  it("Hacktribe gegen Stock-Sampler: die 11 Hacktribe-IFX, 62 Grooves und die angehängten Mod-Typen sind Erweiterungen", () => {
    const a = analysiereFirmware(fakeHacktribe({ modAnzahl: 6 }), fakeSamplerStock()) as FirmwareAnalyse;
    const je = (art: string) => a.erweiterungen.filter((e) => e.art === art);
    // Slot 0..37 sind byte-gleich mit den gezeigten Stock-Bloecken (gleiche Namen) — nur 39..49 sind neu
    expect(je("ifx").map((e) => e.platz)).toEqual(Array.from({ length: 11 }, (_, i) => 39 + i));
    expect(je("ifx").every((e) => e.beschreibung.startsWith("neu"))).toBe(true);
    expect(je("mfx").length).toBe(0); // gleiche 32 MFX, andere Lage — platzweise gleich
    expect(je("groove").length).toBe(62);
    // Mod-Tabelle: 4 Stock-Typen sind auch bei Hacktribe die ersten vier (verlegt, aber gleich) — nur 5 und 6 sind neu
    expect(je("mod").map((e) => e.platz)).toEqual([5, 6]);
    expect(je("osz").length).toBe(0);
    expect(a.referenz?.diffBytes).toBeGreaterThan(0);
  });

  it("unterschiedsLaeufe verschmilzt kleine Lücken; bekannteBereiche deckt Zeiger-Presets ab", () => {
    const a = new Uint8Array(0x200);
    const b = new Uint8Array(0x200);
    b[0x110] = 1;
    b[0x118] = 1;
    b[0x150] = 1;
    expect(unterschiedsLaeufe(a, b, 8)).toEqual([
      { von: 0x110, bis: 0x119 },
      { von: 0x150, bis: 0x151 },
    ]);
    const s = fakeSamplerStock();
    const bereiche = bekannteBereiche(s, KARTE_SAMPLER_STOCK);
    expect(bereiche.filter((x) => x.art === "ifx").length).toBe(38);
    expect(bereiche.some((x) => x.art === "dsp")).toBe(true);
    expect(bereiche.some((x) => x.art === "splash")).toBe(true);
    expect(bekannteBereiche(fakeSynthStock(), KARTE_SYNTH_STOCK).some((x) => x.art === "splash")).toBe(false);
  });
});

describe("firmwareAnalyse — Übernahme", () => {
  const quelle = () => analysiereFirmware(modifizierteHacktribe(), fakeHacktribe()) as FirmwareAnalyse;

  it("in eine frische Hacktribe: Presets mit Menü-Nachzug, Groove, Osz, Mod, Code und DSP (Drei-Wege-Regel)", () => {
    const a = quelle();
    const r = uebernehmeErweiterungen(fakeHacktribe(), a.erweiterungen);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.uebersprungen).toEqual([]);
    const k = KARTE_HACKTRIBE;
    expect(presetName(r.bytes.subarray(presetOffset(k, r.bytes, "ifx", 50)!, presetOffset(k, r.bytes, "ifx", 50)! + 0x20c))).toBe("Tekk Wash");
    expect(leseZaehler(r.bytes, k.ifxZaehler)).toEqual({ ok: true, maxIndex: 50 });
    expect(leseZaehler(r.bytes, k.grooveZaehler!)).toEqual({ ok: true, maxIndex: 62 });
    const gOff = dateiOffset(k.grooveBank!.base + 62 * k.grooveBank!.stride);
    expect(decodeGroove(r.bytes.subarray(gOff, gOff + GROOVE_SIZE)).name).toBe("Swing X");
    expect(decodeOsz(liesOsz(r.bytes, 13)).name).toBe("X-SAW +7");
    expect(liesModTabelle(r.bytes).length).toBe(5);
    expect(r.bytes[0x20000]).toBe(fakeHacktribe()[0x20000] ^ 0x5a);
    expect(r.bytes[k.ldrStart! + 16 + 5]).toBe(fakeHacktribe()[k.ldrStart! + 16 + 5] ^ 0x01);
    expect(r.zeilen.join("\n")).toMatch(/Preset-\/Groove-Platz/);
    expect(r.zeilen.join("\n")).toMatch(/Drei-Wege-Regel/);
  });

  it("Code/DSP wird nicht auf ein Ziel gelegt, das dort schon abweicht", () => {
    const a = quelle();
    const ziel = fakeHacktribe();
    ziel[0x20000] ^= 0x11;
    const r = uebernehmeErweiterungen(ziel, a.erweiterungen.filter((e) => e.art === "code"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.uebersprungen.map((u) => u.id)).toEqual(["code:0x20000"]);
    expect(r.bytes[0x20000]).toBe(ziel[0x20000]);
  });

  it("in den Stock-Synth: Werks-Presets werden ersetzt, Platz 50 und Grooves/Osz/Mod/Code bleiben draußen, Init-Pattern mit Hinweis", () => {
    const a = quelle();
    const ip = a.erweiterungen.find((e) => e.id === "ifx:1")!;
    const r = uebernehmeErweiterungen(fakeSynthStock(), a.erweiterungen);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const k = KARTE_SYNTH_STOCK;
    const off = presetOffset(k, r.bytes, "ifx", 0)!;
    expect(presetName(r.bytes.subarray(off, off + 0x20c))).toBe("Punch 2");
    const mOff = presetOffset(k, r.bytes, "mfx", 2)!;
    expect(presetName(r.bytes.subarray(mOff, mOff + 0x20c))).toBe("Mein Master");
    expect(leseZaehler(r.bytes, k.ifxZaehler)).toEqual({ ok: true, maxIndex: 37 }); // Zaehler unangetastet
    const ids = r.uebersprungen.map((u) => u.id);
    expect(ids).toContain("ifx:50");
    expect(ids).toContain("groove:63");
    expect(ids).toContain("osz:13");
    expect(ids).toContain("mod:5");
    expect(ids).toContain("code:0x20000");
    expect(ip.nach["synth-stock"].ok).toBe(true);
    expect(erkenneKarte(r.bytes).ok && (erkenneKarte(r.bytes) as { karte: { id: string } }).karte.id).toBe("synth-stock");
  });

  it("Init-Pattern und Init-Global reisen über die Variantengrenze, Startbild nicht in den Synth", () => {
    const fw = fakeHacktribe();
    const k = KARTE_HACKTRIBE;
    asc(fw, dateiOffset(k.initPattern) + 0x10, "TEKK INIT\0\0\0\0\0\0\0");
    fw[dateiOffset(k.initGlobal) + 0x28] = 2;
    fw[dateiOffset(k.splash!)] = 0x80;
    const a = analysiereFirmware(fw, fakeHacktribe()) as FirmwareAnalyse;
    expect(a.erweiterungen.map((e) => e.art).sort()).toEqual(["initGlobal", "initPattern", "splash"]);
    const r = uebernehmeErweiterungen(fakeSynthStock(), a.erweiterungen);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const y = analysiereFirmware(r.bytes) as FirmwareAnalyse;
    expect(y.initPatternName).toBe("TEKK INIT");
    expect(y.initGlobal.clock).toBe(2);
    expect(r.uebersprungen.map((u) => u.id)).toEqual(["splash:0"]);
    expect(r.zeilen.join("\n")).toMatch(/andere Variante/);
  });

  it("weist ein Ziel zurück, das keine Firmware ist, und bricht ab, wenn das Ergebnis die Karte verlöre", () => {
    expect(uebernehmeErweiterungen(new Uint8Array(3), []).ok).toBe(false);
    const a = quelle();
    // Eine Erweiterung, die den Init-Pattern-Rahmen zerstoert: als Code-Lauf getarnt auf PTST
    const boese = { ...a.erweiterungen.find((e) => e.art === "code")!, id: "code:x", offset: dateiOffset(KARTE_HACKTRIBE.initPattern), laenge: 4, bytes: new Uint8Array([0, 0, 0, 0]), referenz: new Uint8Array([0x50, 0x54, 0x53, 0x54]) };
    const r = uebernehmeErweiterungen(fakeHacktribe(), [boese]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/verworfen/);
  });
});
