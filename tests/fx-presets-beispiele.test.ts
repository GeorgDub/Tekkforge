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
import { IFX_TYPES, MFX_TYPES } from "../src/core/e2FxParams";
import { leseSammlung } from "../src/core/sammlung";

/**
 * Die mitgelieferten Beispiel-Presets aus `examples/fx-presets/`.
 *
 * Anders als die Gegenprobe an fremden Dateien (`fx-preset-echt.test.ts`)
 * liegen diese im Repository — sie sind unsere eigenen. Der Test haelt fest,
 * was sie sein muessen: 524 Byte, ein Name fuers Geraetemenue, ein bekannter
 * Algorithmus in der Stufe, um die es geht, und eine Zuordnung, die auf einen
 * Parameter zeigt, den es dort **gibt**.
 *
 * Der Zeiger-Test ist der eigentliche Punkt. Eine Zuordnung ist eine rohe
 * Zahl; zeigt sie auf Parameter 11 eines Algorithmus mit vier Parametern,
 * bleibt die Datei formal gueltig und das Bedienelement tut am Geraet nichts.
 * Das faellt sonst erst am Geraet auf — und dort sieht es aus wie ein Fehler
 * der Uebertragung.
 *
 * Zwei Arten, zwei Endungen: `.e2fxp` sind Insert-Presets (Ziel `0xC00A80F0`),
 * `.mfx` sind Master-Presets (Ziel `0xC00B4F30`). Die Endung ist nicht Zierde
 * — `ausDatei()` stellt daran die Art um, und die Art waehlt die Zieladresse.
 *
 * Erzeugt werden die Dateien von `scripts/make-fx-presets.mjs`.
 */
const ORDNER = path.resolve("examples/fx-presets");
const alle = fs.readdirSync(ORDNER);
const insertDateien = alle.filter((f) => f.endsWith(".e2fxp")).sort();
const masterDateien = alle.filter((f) => f.endsWith(".mfx")).sort();
const presetDateien = [...insertDateien, ...masterDateien];

const lies = (f: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(ORDNER, f)));
const istMaster = (f: string): boolean => f.endsWith(".mfx");
const dekodiere = (f: string) => decodeFxPreset(lies(f), istMaster(f));

/** Die Stufe, um die es bei dieser Art geht. */
const hauptStufe = (f: string) => {
  const p = dekodiere(f);
  return istMaster(f) ? p.mfx : p.ifx1;
};

describe("Beispiel-Presets — beide Arten", () => {
  it("es gibt von beiden welche — sonst prueft der Rest nichts", () => {
    expect(insertDateien.length).toBeGreaterThan(0);
    expect(masterDateien.length).toBeGreaterThan(0);
  });

  it.each(presetDateien)("%s ist ein gueltiger 524-Byte-Block", (f) => {
    expect(lies(f).length).toBe(FX_PRESET_SIZE);
  });

  it.each(presetDateien)("%s traegt einen Namen fuers Geraetemenue", (f) => {
    const name = dekodiere(f).name;
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(15);
  });

  it.each(presetDateien)("%s nutzt einen bekannten Algorithmus", (f) => {
    const stufe = hauptStufe(f);
    const tabelle = istMaster(f) ? MFX_TYPES : IFX_TYPES;
    expect(tabelle[stufe.device], `Kennung 0x${stufe.device.toString(16)}`).toBeDefined();
  });

  it.each(presetDateien)("%s hat mindestens eine Zuordnung", (f) => {
    const belegt = dekodiere(f).controlMap.filter((z) => z.quelle !== 0);
    expect(belegt.length).toBeGreaterThan(0);
  });

  it.each(presetDateien)("%s: jede Zuordnung zeigt auf einen Parameter, den es gibt", (f) => {
    const p = dekodiere(f);
    for (const z of p.controlMap.filter((x) => x.quelle !== 0)) {
      expect(FX_QUELLEN.map((q) => q.wert), `Quelle 0x${z.quelle.toString(16)}`).toContain(z.quelle);
      expect(FX_KETTEN.map((k) => k.wert), `Kette 0x${z.kette.toString(16)}`).toContain(z.kette);
      // Kettenplaetze 0x07/0x0A meinen Pegel statt Parameter — hier nicht benutzt.
      const stufe = z.kette === 0x02 ? p.mfx : z.kette === 0x01 ? p.ifx2 : p.ifx1;
      expect(z.zielParam, `${stufe.algorithmus}: Parameter ${z.zielParam}`).toBeLessThan(
        stufe.paramNamen.length,
      );
      expect(z.min).toBeLessThan(z.max);
      expect(z.max).toBeLessThanOrEqual(127);
    }
  });

  it.each(presetDateien)("%s: die Zuordnungen zeigen auf die Stufe, um die es geht", (f) => {
    // Ein Master-Preset, dessen X-Achse auf IFX 1 zeigt, waere still nutzlos:
    // die Insert-Stufen stehen darin auf Thru (und umgekehrt).
    const erlaubt = istMaster(f) ? [0x02] : [0x00, 0x01];
    const ketten = dekodiere(f).controlMap.filter((z) => z.quelle !== 0).map((z) => z.kette);
    for (const k of ketten) expect(erlaubt, `Kette 0x${k.toString(16)}`).toContain(k);
  });

  it.each(presetDateien)("%s: kein Parameter steht ueber 127", (f) => {
    const p = dekodiere(f);
    for (const stufe of [p.ifx1, p.ifx2, p.mfx]) {
      for (const [i, v] of stufe.params.entries()) {
        expect(v, `${stufe.algorithmus}.${stufe.paramNamen[i]}`).toBeLessThanOrEqual(127);
      }
    }
  });

  it.each(presetDateien)("%s ueberlebt lesen und zurueckschreiben byte-genau", (f) => {
    const roh = lies(f);
    const zurueck = encodeFxPreset(decodeFxPreset(roh, istMaster(f)), roh);
    expect(Buffer.from(zurueck).equals(Buffer.from(roh))).toBe(true);
  });
});

describe("Insert-Presets (.e2fxp)", () => {
  it.each(insertDateien)("%s laesst den Master-Effekt in Ruhe", (f) => {
    // Diese Dateien gehen in IFX-Plaetze. Stuende hier ein MFX-Algorithmus,
    // wuerde ein Schreiben den Master-Effekt mit umstellen.
    expect(dekodiere(f).mfx.device).toBe(0x00);
  });

  it.each(insertDateien)("%s haelt die Zwei-Insert-Regel ein", (f) => {
    const p = dekodiere(f);
    if (p.ifx2.device === 0x00) return; // nur ein Insert — die Regel greift nicht
    // Beide Slots aus der Whitelist: gueltig nach beiden Lesarten der Regel
    // (Synthstudio prueft IFX 2, TekkForges `ifx2Moeglich` prueft IFX 1).
    expect(IFX2_FAEHIG, `IFX 1 = 0x${p.ifx1.device.toString(16)}`).toContain(p.ifx1.device);
    expect(IFX2_FAEHIG, `IFX 2 = 0x${p.ifx2.device.toString(16)}`).toContain(p.ifx2.device);
  });
});

describe("Master-Presets (.mfx)", () => {
  it.each(masterDateien)("%s laesst die Insert-Stufen in Ruhe", (f) => {
    // Umgekehrt zum Insert-Fall: ein Master-Preset gehoert nach 0xC00B4F30
    // und soll die Inserts des Parts nicht mit umstellen.
    const p = dekodiere(f);
    expect(p.ifx1.device).toBe(0x00);
    expect(p.ifx2.device).toBe(0x00);
  });

  it.each(masterDateien)("%s nutzt eine Kennung aus dem Master-Nummernkreis", (f) => {
    // Die beiden Nummernkreise ueberschneiden sich nur in „kein Effekt"
    // (0x00 Thru, 0x27 Mute). Jede andere Insert-Kennung waere hier ein
    // Kopierfehler und stuende als unbekannt im Editor; 0x00/0x27 dagegen
    // waeren gueltig, aber ein Preset, das nichts tut.
    const device = dekodiere(f).mfx.device;
    expect(MFX_TYPES[device], `Kennung 0x${device.toString(16)}`).toBeDefined();
    expect([0x00, 0x27], `Kennung 0x${device.toString(16)} macht nichts`).not.toContain(device);
  });
});

describe("Variationen", () => {
  /**
   * `01a-…` und `01b-…` sind Variationen von `01-…`. Die Nummer im Dateinamen
   * ist die Zuordnung — halten sie sich nicht daran, findet der Test die Basis
   * nicht und faellt durch, statt still nichts zu pruefen.
   */
  const paare = presetDateien
    .map((f) => ({ variante: f, treffer: /^(m?\d+)[ab]-/.exec(f) }))
    .filter((x) => x.treffer)
    .map(({ variante, treffer }) => ({
      variante,
      basis: presetDateien.find((f) => f.startsWith(`${treffer![1]}-`)),
    }));

  it("jede Variation findet ihre Basis", () => {
    expect(paare.length).toBeGreaterThan(0);
    for (const p of paare) expect(p.basis, `Basis zu ${p.variante}`).toBeDefined();
  });

  it.each(paare)("$variante nutzt denselben Algorithmus wie $basis", ({ variante, basis }) => {
    // Der Sinn einer Variation ist der Vergleich: dieselbe Kette, ein Wert
    // anders. Ein abweichender Algorithmus macht daraus zwei Presets, die
    // nebeneinander nichts mehr aussagen.
    const v = dekodiere(variante);
    const b = dekodiere(basis!);
    expect(v.ifx1.device).toBe(b.ifx1.device);
    expect(v.ifx2.device).toBe(b.ifx2.device);
    expect(v.mfx.device).toBe(b.mfx.device);
  });

  it.each(paare)("$variante unterscheidet sich hoerbar von $basis", ({ variante, basis }) => {
    // Eine Variation, die byte-gleich zur Basis ist, waere ein Kopierfehler:
    // sie belegt einen Platz am Geraet und beantwortet keine Frage.
    expect(Buffer.from(lies(variante)).equals(Buffer.from(lies(basis!)))).toBe(false);
  });
});

describe("Hall-Vergleich", () => {
  /**
   * Vier Hall-Algorithmen auf identischen Werten — nur so sagt der Vergleich
   * etwas ueber den Algorithmus statt ueber die Werkseinstellung. Die vier
   * haben je eigene Defaults (Laenge 38/38/31/31, Daempfung 92/78/106/61);
   * wer sie unangetastet nebeneinander stellt, hoert die Defaults.
   */
  const reihen = [
    { stufe: "Grundlage", dateien: ["m20-hall-big.mfx", "m21-hall-smooth.mfx", "m22-plate-wet.mfx", "m23-plate-dry.mfx"] },
    { stufe: "kurz", dateien: ["m20a-hall-big-short.mfx", "m21a-smooth-short.mfx", "m22a-plate-wet-short.mfx", "m23a-plate-dry-short.mfx"] },
    { stufe: "lang", dateien: ["m20b-hall-big-long.mfx", "m21b-smooth-long.mfx", "m22b-plate-wet-long.mfx", "m23b-plate-dry-long.mfx"] },
  ];

  it.each(reihen)("Stufe $stufe: alle vier unterscheiden sich nur im Algorithmus", ({ dateien }) => {
    const stufen = dateien.map((f) => dekodiere(f).mfx);
    // Vier verschiedene Algorithmen …
    expect(new Set(stufen.map((s) => s.device)).size).toBe(4);
    // … mit identischen Parameterlisten und identischen Werten.
    for (const s of stufen) {
      expect(s.paramNamen).toEqual(stufen[0].paramNamen);
      expect(s.params).toEqual(stufen[0].params);
    }
  });

  it("die drei Stufen unterscheiden sich voneinander", () => {
    const werte = reihen.map((r) => dekodiere(r.dateien[0]).mfx.params.join(","));
    expect(new Set(werte).size).toBe(3);
  });
});

describe("Sammlungen der Beispiel-Presets", () => {
  const gruppen = [
    {
      art: "ifx",
      dateien: insertDateien,
      sammlungen: [
        "TekkForge-IFX-Starter.tfsam",
        "TekkForge-IFX-Variationen.tfsam",
        "TekkForge-IFX-Farben.tfsam",
        "TekkForge-IFX-Farben-Variationen.tfsam",
        "TekkForge-IFX-Bewegung.tfsam",
        "TekkForge-IFX-Bewegung-Variationen.tfsam",
      ],
    },
    {
      art: "mfx",
      dateien: masterDateien,
      sammlungen: [
        "TekkForge-MFX-Starter.tfsam",
        "TekkForge-MFX-Variationen.tfsam",
        "TekkForge-MFX-Raum.tfsam",
        "TekkForge-MFX-Raum-Variationen.tfsam",
        "TekkForge-MFX-Tekk.tfsam",
        "TekkForge-MFX-Tekk-Variationen.tfsam",
      ],
    },
  ];

  const eintraegeVon = (datei: string) =>
    leseSammlung(fs.readFileSync(path.join(ORDNER, datei), "utf8")).eintraege;

  it.each(gruppen.flatMap((g) => g.sammlungen.map((datei) => ({ datei, art: g.art }))))(
    "$datei traegt nur $art und ist nicht leer",
    ({ datei, art }) => {
      const eintraege = eintraegeVon(datei);
      expect(eintraege.length).toBeGreaterThan(0);
      expect(eintraege.every((e) => e.art === art)).toBe(true);
    },
  );

  it.each(gruppen)("$art: die Sammlungen decken jede Einzeldatei genau einmal ab", ({ dateien, sammlungen }) => {
    // Die Bytes in der Sammlung sind dieselben wie in den Einzeldateien —
    // sonst laedt man ueber den bequemen Weg etwas anderes als ueber den
    // einzelnen, und das faellt niemandem auf. Geprueft wird ueber die Menge,
    // nicht ueber feste Zahlen: eine neue Variation faellt so nicht durchs
    // Raster, weil jemand vergessen hat, einen Zaehler mitzuziehen.
    const aufPlatte = dateien.map((f) => Buffer.from(lies(f)).toString("base64")).sort();
    const inSammlungen = sammlungen
      .flatMap((s) => eintraegeVon(s))
      .map((e) => Buffer.from(e.bytes).toString("base64"))
      .sort();
    expect(inSammlungen).toEqual(aufPlatte);
  });
});
