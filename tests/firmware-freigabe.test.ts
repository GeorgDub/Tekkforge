import { describe, it, expect } from "vitest";
import { freigabe, LAUFENDE_FIRMWARE } from "../src/core/firmwareFreigabe";
import { fakeHacktribe, fakeSamplerStock, fakeSynthStock } from "./helpers/fakeFirmware";
import { OFF_ID_LOW, OFF_SUFFIX, analysiere } from "../src/core/crossgrade";
import { KARTE_HACKTRIBE, KARTE_SYNTH_STOCK, dateiOffset } from "../src/core/firmwareKarte";

/** Zielgeraet + laufende Firmware → Kopf, SD-Pfad, Pruefliste, Freigabe. */
describe("firmwareFreigabe", () => {
  it("Synth-Firmware für einen Sampler mit Stock-Firmware: Sampler-Kopf, Sampler-Pfad, PCM-Hinweis", () => {
    const f = freigabe(fakeSynthStock(), { geraet: "sampler", laufend: "sampler-stock" });
    expect(f.ok).toBe(true);
    expect(f.kopfVariante).toBe("sampler");
    expect(f.sdPfad).toBe("KORG/electribe sampler/System/SYSTEM.VSB");
    expect(f.bytes[OFF_ID_LOW]).toBe(0x24);
    expect(f.bytes[OFF_SUFFIX]).toBe(0x53);
    expect(analysiere(f.bytes).variante).toBe("sampler");
    expect(f.befund?.karte.id).toBe("synth-stock");
    expect(f.befund?.umgekoepft).toBe(true);
    expect(f.warnungen.join("\n")).toMatch(/PCM/);
    expect(f.warnungen.join("\n")).toMatch(/künftige Updates brauchen dann den Synth-Kopf/);
    expect(f.zeilen.at(-1)).toMatch(/FREIGEGEBEN/);
    expect(f.pruefungen.find((p) => p.name === "Kopf")?.text).toMatch(/umgeköpft von 0x123/i);
  });

  it("dasselbe Gerät, auf dem schon der Synth-Crossgrade läuft: jetzt Synth-Kopf und Synth-Pfad", () => {
    const f = freigabe(fakeSynthStock(), { geraet: "sampler", laufend: "synth-crossgrade" });
    expect(f.ok).toBe(true);
    expect(f.kopfVariante).toBe("synth");
    expect(f.sdPfad).toBe("KORG/electribe/System/SYSTEM.VSB");
    expect(f.bytes[OFF_ID_LOW]).toBe(0x23);
    expect(LAUFENDE_FIRMWARE["synth-crossgrade"].geraet).toBe("sampler");
  });

  it("Hacktribe für einen Sampler mit Hacktribe: nichts umgeköpft, alle harten Prüfungen grün", () => {
    const f = freigabe(fakeHacktribe(), { geraet: "sampler", laufend: "hacktribe" });
    expect(f.ok).toBe(true);
    expect(f.pruefungen.filter((p) => p.hart).every((p) => p.ok)).toBe(true);
    expect(f.pruefungen.map((p) => p.name)).toEqual(["Größe", "Magic", "Dateityp", "Version", "Kopf-Rest", "Kopf", "Layout", "Vektortabelle", "IFX-Zähler", "Groove-Zähler", "Init-Pattern", "Init-Global", "DSP-Kette"]);
    expect(f.warnungen.some((w) => /Rückweg/.test(w))).toBe(true);
    expect(f.warnungen.some((w) => /sicher, dass/.test(w))).toBe(false);
  });

  it("Referenz: zählt Code-Bytes außerhalb der bekannten Bereiche und DSP-Bytes getrennt und warnt", () => {
    const fw = fakeHacktribe();
    fw[0x30000] ^= 0xff;
    fw[KARTE_HACKTRIBE.ldrStart! + 16 + 3] ^= 0x01;
    const f = freigabe(fw, { geraet: "sampler", laufend: "hacktribe" }, fakeHacktribe());
    const ref = f.pruefungen.find((p) => p.name === "Referenz")!;
    expect(ref.hart).toBe(false);
    expect(ref.text).toMatch(/1 Bytes im Code außerhalb .* und 1 Bytes in der DSP-Kette/);
    expect(f.warnungen.some((w) => /Code-Patch-Gebiet/.test(w))).toBe(true);
    expect(f.warnungen.some((w) => /DSP-Kette geändert/.test(w))).toBe(true);
  });

  it("Vektortabelle: jede ldr-pc-Form zählt (die echten Abbilder haben 5 × #0x18, #0x04, #0x14, #0x14), alles andere nicht", () => {
    const fw = fakeSamplerStock();
    expect(freigabe(fw, { geraet: "sampler", laufend: "sampler-stock" }).pruefungen.find((p) => p.name === "Vektortabelle")?.text).toMatch(/^8\/8/);
    fw[0x11c] = 0x20; // Immediate anders — bleibt ldr pc,[pc,#…]
    expect(freigabe(fw, { geraet: "sampler", laufend: "sampler-stock" }).pruefungen.find((p) => p.name === "Vektortabelle")?.ok).toBe(true);
    fw[0x11f] = 0xea; // Branch statt ldr — nicht die Vektortabelle der electribe
    expect(freigabe(fw, { geraet: "sampler", laufend: "sampler-stock" }).pruefungen.find((p) => p.name === "Vektortabelle")?.ok).toBe(false);
  });

  it("rote harte Prüfungen: kaputte Vektortabelle, widersprüchliche Zähler, kaputte DSP-Kette, Größe", () => {
    const v = fakeSamplerStock();
    v[0x101] = 0;
    const fv = freigabe(v, { geraet: "sampler", laufend: "sampler-stock" });
    expect(fv.ok).toBe(false);
    expect(fv.pruefungen.find((p) => p.name === "Vektortabelle")?.ok).toBe(false);
    expect(fv.zeilen.at(-1)).toMatch(/NICHT FREIGEGEBEN/);

    const z = fakeHacktribe();
    z[dateiOffset(KARTE_HACKTRIBE.ifxZaehler[3].addr)] = 7;
    expect(freigabe(z, { geraet: "sampler", laufend: "hacktribe" }).pruefungen.find((p) => p.name === "IFX-Zähler")?.ok).toBe(false);

    const d = fakeSynthStock();
    d[KARTE_SYNTH_STOCK.ldrStart! + 1] ^= 0x01;
    expect(freigabe(d, { geraet: "synth", laufend: "synth-stock" }).pruefungen.find((p) => p.name === "DSP-Kette")?.ok).toBe(false);

    const klein = freigabe(new Uint8Array(100), { geraet: "synth", laufend: "synth-stock" });
    expect(klein.ok).toBe(false);
    expect(klein.pruefungen.length).toBe(1);
  });

  it("weiche Prüfungen blockieren nicht: andere Version, Kopf-Rest, Geräte-/Firmware-Widerspruch", () => {
    const fw = fakeSamplerStock();
    fw[0x2b] = 1;
    fw[0x80] = 0;
    const f = freigabe(fw, { geraet: "synth", laufend: "sampler-stock" });
    expect(f.ok).toBe(true);
    expect(f.pruefungen.find((p) => p.name === "Version")?.ok).toBe(false);
    expect(f.pruefungen.find((p) => p.name === "Kopf-Rest")?.ok).toBe(false);
    expect(f.warnungen.some((w) => /sicher, dass das Gerät/.test(w))).toBe(true);
    expect(f.warnungen.some((w) => /Sampler-Firmware auf Synth-Hardware/.test(w))).toBe(true);
  });

  it("die Eingabe bleibt unangetastet", () => {
    const fw = fakeSynthStock();
    const kopie = fw.slice();
    freigabe(fw, { geraet: "sampler", laufend: "sampler-stock" });
    expect(Buffer.compare(Buffer.from(fw), Buffer.from(kopie))).toBe(0);
  });
});
