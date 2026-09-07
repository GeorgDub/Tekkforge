/// <reference types="vite/client" />

/**
 * Sammlungen (.tfsam) als Text einbinden — Vite liefert die Datei mit `?raw`
 * als String, gebuendelt in die eine dist/index.html. So sind die
 * mitgelieferten FX-Presets und Groove-Vorlagen in der App da, ohne dass
 * jemand den examples-Ordner suchen muss (fxBibliothekEingebaut.ts).
 */
declare module "*.tfsam?raw" {
  const text: string;
  export default text;
}
