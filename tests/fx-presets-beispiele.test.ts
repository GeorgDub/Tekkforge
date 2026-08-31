import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  decodeFxPreset,
  encodeFxPreset,
  FX_PRESET_SIZE,
  IFX2_FAEHIG,
  FX_QUELLEN,
  FX_KETTEN,
} from "../src/core/e2FxPreset";
import { IFX_TYPES } from "../src/core/e2FxParams";
import { leseSammlung } from "../src/core/sammlung";

/**
 * Die mitgelieferten Beispiel-Presets aus `examples/fx-presets/`.
 *
 * Anders als die Gegenprobe an fremden Dateien (`fx-preset-echt.test.ts`)
 * liegen diese im Repository — sie sind unsere eigenen. Der Test haelt fest,
 * was sie sein muessen: 524 Byte, ein Name fuers Geraetemenue, ein bekannter
 * Algorithmus, eine Zuordnung, die auf einen Parameter zeigt, den es beim
 * gewaehlten Algorithmus **gibt**.
 *
 * Der Zeiger-Test ist der eigentliche Punkt. Eine Zuordnung ist eine rohe
 * Zahl; zeigt sie auf Parameter 11 eines Algorithmus mit vier Parametern,
 * bleibt die Datei formal gueltig und der Regler tut am Geraet nichts. Das
 * faellt sonst erst am Geraet auf — und dort sieht es aus wie ein Fehler der
 * Uebertragung.
 *
 * Erzeugt werden die Dateien von `scripts/make-fx-presets.mjs`.
 */
const ORDNER = path.resolve("examples/fx-presets");
const dateien = fs
  .readdirSync(ORDNER)
  .filter((f) => f.endsWith(".e2fxp"))
  .sort();

const lies = (f: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(ORDNER, f)));

describe("Beispiel-IFX-Presets", () => {
  it("es gibt welche — sonst prueft der Rest nichts", () => {
    expect(dateien.length).toBeGreaterThan(0);
  });

  it.each(dateien)("%s ist ein gueltiger 524-Byte-Block", (f) => {
    expect(lies(f).length).toBe(FX_PRESET_SIZE);
  });

  it.each(dateien)("%s traegt einen Namen fuers Geraetemenue", (f) => {
    const name = decodeFxPreset(lies(f)).name;
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(15);
  });

  it.each(dateien)("%s nutzt in IFX 1 einen bekannten Algorithmus", (f) => {
    const p = decodeFxPreset(lies(f));
    expect(IFX_TYPES[p.ifx1.device], `Kennung 0x${p.ifx1.device.toString(16)}`).toBeDefined();
  });

  it.each(dateien)("%s laesst den Master-Effekt in Ruhe", (f) => {
    // Diese Dateien gehen in IFX-Plaetze. Stuende hier ein MFX-Algorithmus,
    // wuerde ein Schreiben den Master-Effekt mit umstellen.
    expect(decodeFxPreset(lies(f)).mfx.device).toBe(0x00);
  });

  it.each(dateien)("%s haelt die Zwei-Insert-Regel ein", (f) => {
    const p = decodeFxPreset(lies(f));
    if (p.ifx2.device === 0x00) return; // nur ein Insert — die Regel greift nicht
    // Beide Slots aus der Whitelist: gueltig nach beiden Lesarten der Regel
    // (Synthstudio prueft IFX 2, TekkForges `ifx2Moeglich` prueft IFX 1).
    expect(IFX2_FAEHIG, `IFX 1 = 0x${p.ifx1.device.toString(16)}`).toContain(p.ifx1.device);
    expect(IFX2_FAEHIG, `IFX 2 = 0x${p.ifx2.device.toString(16)}`).toContain(p.ifx2.device);
  });

  it.each(dateien)("%s hat mindestens eine Zuordnung auf den IFX-Regler", (f) => {
    const belegt = decodeFxPreset(lies(f)).controlMap.filter((z) => z.quelle !== 0);
    expect(belegt.length).toBeGreaterThan(0);
  });

  it.each(dateien)("%s: jede Zuordnung zeigt auf einen Parameter, den es gibt", (f) => {
    const p = decodeFxPreset(lies(f));
    for (const z of p.controlMap.filter((x) => x.quelle !== 0)) {
      expect(FX_QUELLEN.map((q) => q.wert), `Quelle 0x${z.quelle.toString(16)}`).toContain(z.quelle);
      expect(FX_KETTEN.map((k) => k.wert), `Kette 0x${z.kette.toString(16)}`).toContain(z.kette);
      // Kettenplaetze 0x07/0x0A meinen Pegel statt Parameter — hier nicht benutzt.
      const stufe = z.kette === 0x01 ? p.ifx2 : p.ifx1;
      expect(z.zielParam, `${stufe.algorithmus}: Parameter ${z.zielParam}`).toBeLessThan(
        stufe.paramNamen.length,
      );
      expect(z.min).toBeLessThan(z.max);
      expect(z.max).toBeLessThanOrEqual(127);
    }
  });

  it.each(dateien)("%s: kein Parameter steht ueber 127", (f) => {
    const p = decodeFxPreset(lies(f));
    for (const stufe of [p.ifx1, p.ifx2]) {
      for (const [i, v] of stufe.params.entries()) {
        expect(v, `${stufe.algorithmus}.${stufe.paramNamen[i]}`).toBeLessThanOrEqual(127);
      }
    }
  });

  it.each(dateien)("%s ueberlebt lesen und zurueckschreiben byte-genau", (f) => {
    const roh = lies(f);
    const zurueck = encodeFxPreset(decodeFxPreset(roh), roh);
    expect(Buffer.from(zurueck).equals(Buffer.from(roh))).toBe(true);
  });
});

describe("Sammlung der Beispiel-Presets", () => {
  const datei = path.join(ORDNER, "TekkForge-IFX-Starter.tfsam");

  it("laesst sich lesen und enthaelt jedes Preset genau einmal", () => {
    const s = leseSammlung(fs.readFileSync(datei, "utf8"));
    expect(s.eintraege).toHaveLength(dateien.length);
    expect(s.eintraege.every((e) => e.art === "ifx")).toBe(true);

    // Die Bytes in der Sammlung sind dieselben wie in den Einzeldateien —
    // sonst laedt man ueber den bequemen Weg etwas anderes als ueber den
    // einzelnen, und das faellt niemandem auf.
    const einzeln = dateien.map((f) => Buffer.from(lies(f)).toString("base64"));
    const inSammlung = s.eintraege.map((e) => Buffer.from(e.bytes).toString("base64"));
    expect(inSammlung.sort()).toEqual(einzeln.sort());
  });
});
