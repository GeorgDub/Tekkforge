import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { decodeFxPreset, encodeFxPreset, FX_PRESET_SIZE } from "../src/core/e2FxPreset";

/**
 * Gegenprobe an ECHTEN Preset-Dateien statt an selbst gebauten Bytes.
 *
 * Die Dateien stammen aus `ht_data/fx` des Zweigs `ht-cli` von
 * bangcorrupt/hacktribe-editor-legacy. Sie liegen **absichtlich nicht im
 * Repository**: das Projekt steht unter AGPL-3.0, und eine Weitergabe fremder
 * Daten wollen wir nicht beilaeufig entscheiden (siehe NOTICE). Wer die Probe
 * fahren will, legt sie selbst ab:
 *
 *   git clone -b ht-cli https://github.com/bangcorrupt/hacktribe-editor-legacy
 *   cp hacktribe-editor-legacy/ht_data/fx/*.?fx examples/fx/
 *
 * Ohne den Ordner wird der Test uebersprungen — er faellt nicht faelschlich
 * gruen aus, sondern meldet sich als "skipped".
 */
const ORDNER = path.resolve("examples/fx");
const dateien = fs.existsSync(ORDNER) ? fs.readdirSync(ORDNER).filter((f) => /\.(ifx|mfx)$/i.test(f)) : [];

describe.skipIf(dateien.length === 0)("e2FxPreset an echten Dateien", () => {
  it("liest jede Datei mit Namen und bekanntem Algorithmus", () => {
    for (const f of dateien) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(ORDNER, f)));
      expect(bytes.length, f).toBe(FX_PRESET_SIZE);
      const mfx = f.toLowerCase().endsWith(".mfx");
      const p = decodeFxPreset(bytes, mfx);
      expect(p.name.length, `${f}: Name`).toBeGreaterThan(0);
      // Der Algorithmus der jeweils genutzten Stufe muss in unserer Tabelle stehen
      const stufe = mfx ? p.mfx : p.ifx1;
      expect(stufe.algorithmus, `${f}: Algorithmus (Kennung ${stufe.device})`).not.toBe("");
      expect(stufe.paramNamen.length, `${f}: Parameterliste`).toBeGreaterThan(0);
    }
  });

  it("schreibt jede Datei byte-genau zurueck", () => {
    for (const f of dateien) {
      const roh = new Uint8Array(fs.readFileSync(path.join(ORDNER, f)));
      const zurueck = encodeFxPreset(decodeFxPreset(roh, f.toLowerCase().endsWith(".mfx")), roh);
      expect(Buffer.from(zurueck).equals(Buffer.from(roh)), `${f}: Roundtrip`).toBe(true);
    }
  });

  it("die Namen im Block passen zu den Dateinamen", () => {
    const schlank = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const f of dateien) {
      const p = decodeFxPreset(new Uint8Array(fs.readFileSync(path.join(ORDNER, f))), f.toLowerCase().endsWith(".mfx"));
      const ausDatei = schlank(f.replace(/\.[^.]+$/, ""));
      const imBlock = schlank(p.name);
      // "1-12-delay.ifx" traegt "1/12 Delay", "wet-plate-reverb.mfx" nur "Plate Reverb"
      const passt = ausDatei.includes(imBlock) || imBlock.includes(ausDatei) || imBlock.slice(0, 5) === ausDatei.slice(0, 5);
      expect(passt, `${f}: Name im Block ist "${p.name}"`).toBe(true);
    }
  });
});
