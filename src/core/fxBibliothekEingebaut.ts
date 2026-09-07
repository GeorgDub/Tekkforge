/**
 * fxBibliothekEingebaut — die mitgelieferten Sammlungen aus `examples/`,
 * fest in die App gebuendelt (Vite `?raw`), damit die Bibliothek des
 * Preset-Managers beim ersten Start schon voll ist: 288 FX-Presets in acht
 * Sets und die Tekk-Groove-Vorlagen.
 *
 * Die Dateien in `examples/` bleiben die Wahrheit — dieses Modul bindet sie
 * nur ein. `scripts/make-fx-presets.mjs` bzw. `make-grooves.mjs` erzeugen
 * sie; der Test `fx-bibliothek.test.ts` haelt fest, dass hier genau die
 * Sammlungen von dort stecken.
 *
 * Nicht in die CLI einbinden: `?raw` kennt nur Vite/Vitest, nicht esbuild.
 */
import ifxStarter from "../../examples/fx-presets/TekkForge-IFX-Starter.tfsam?raw";
import ifxVariationen from "../../examples/fx-presets/TekkForge-IFX-Variationen.tfsam?raw";
import ifxFarben from "../../examples/fx-presets/TekkForge-IFX-Farben.tfsam?raw";
import ifxFarbenVariationen from "../../examples/fx-presets/TekkForge-IFX-Farben-Variationen.tfsam?raw";
import ifxBewegung from "../../examples/fx-presets/TekkForge-IFX-Bewegung.tfsam?raw";
import ifxBewegungVariationen from "../../examples/fx-presets/TekkForge-IFX-Bewegung-Variationen.tfsam?raw";
import ifxKetten from "../../examples/fx-presets/TekkForge-IFX-Ketten.tfsam?raw";
import ifxKettenVariationen from "../../examples/fx-presets/TekkForge-IFX-Ketten-Variationen.tfsam?raw";
import mfxStarter from "../../examples/fx-presets/TekkForge-MFX-Starter.tfsam?raw";
import mfxVariationen from "../../examples/fx-presets/TekkForge-MFX-Variationen.tfsam?raw";
import mfxRaum from "../../examples/fx-presets/TekkForge-MFX-Raum.tfsam?raw";
import mfxRaumVariationen from "../../examples/fx-presets/TekkForge-MFX-Raum-Variationen.tfsam?raw";
import mfxTekk from "../../examples/fx-presets/TekkForge-MFX-Tekk.tfsam?raw";
import mfxTekkVariationen from "../../examples/fx-presets/TekkForge-MFX-Tekk-Variationen.tfsam?raw";
import mfxCharakter from "../../examples/fx-presets/TekkForge-MFX-Charakter.tfsam?raw";
import mfxCharakterVariationen from "../../examples/fx-presets/TekkForge-MFX-Charakter-Variationen.tfsam?raw";
import groovesTekk from "../../examples/grooves/TekkForge-Grooves-Tekk.tfsam?raw";

export interface EingebauteSammlung {
  /** Dateiname in `examples/` — Teil der Eintrags-Kennung, muss stabil bleiben. */
  datei: string;
  /** Kurzname des Sets fuer die Herkunftsspalte. */
  set: string;
  text: string;
}

/** Reihenfolge = Anzeige-Reihenfolge in der Bibliothek. */
export const EINGEBAUTE_SAMMLUNGEN: readonly EingebauteSammlung[] = [
  { datei: "TekkForge-IFX-Starter.tfsam", set: "IFX Starter", text: ifxStarter },
  { datei: "TekkForge-IFX-Variationen.tfsam", set: "IFX Starter Var.", text: ifxVariationen },
  { datei: "TekkForge-IFX-Farben.tfsam", set: "IFX Farben", text: ifxFarben },
  { datei: "TekkForge-IFX-Farben-Variationen.tfsam", set: "IFX Farben Var.", text: ifxFarbenVariationen },
  { datei: "TekkForge-IFX-Bewegung.tfsam", set: "IFX Bewegung", text: ifxBewegung },
  { datei: "TekkForge-IFX-Bewegung-Variationen.tfsam", set: "IFX Bewegung Var.", text: ifxBewegungVariationen },
  { datei: "TekkForge-IFX-Ketten.tfsam", set: "IFX Ketten", text: ifxKetten },
  { datei: "TekkForge-IFX-Ketten-Variationen.tfsam", set: "IFX Ketten Var.", text: ifxKettenVariationen },
  { datei: "TekkForge-MFX-Starter.tfsam", set: "MFX Starter", text: mfxStarter },
  { datei: "TekkForge-MFX-Variationen.tfsam", set: "MFX Starter Var.", text: mfxVariationen },
  { datei: "TekkForge-MFX-Raum.tfsam", set: "MFX Raum", text: mfxRaum },
  { datei: "TekkForge-MFX-Raum-Variationen.tfsam", set: "MFX Raum Var.", text: mfxRaumVariationen },
  { datei: "TekkForge-MFX-Tekk.tfsam", set: "MFX Tekk", text: mfxTekk },
  { datei: "TekkForge-MFX-Tekk-Variationen.tfsam", set: "MFX Tekk Var.", text: mfxTekkVariationen },
  { datei: "TekkForge-MFX-Charakter.tfsam", set: "MFX Charakter", text: mfxCharakter },
  { datei: "TekkForge-MFX-Charakter-Variationen.tfsam", set: "MFX Charakter Var.", text: mfxCharakterVariationen },
  { datei: "TekkForge-Grooves-Tekk.tfsam", set: "Grooves Tekk", text: groovesTekk },
];
