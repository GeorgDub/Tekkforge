/**
 * make-doc-pdf2.mjs — PDF-Druck ueber Playwright + Electron-Hauptprozess.
 * Zuverlaessiger als ein eigenes Electron-Skript: Playwright haelt den Prozess
 * unter Kontrolle und meldet Fehler, statt still zu haengen (Electron ist unter
 * Windows eine GUI-Anwendung und schreibt nicht auf die Konsole).
 *
 *   node scripts/make-doc-pdf2.mjs <html> <pdf>
 */
import { _electron } from "playwright-core";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const [htmlPfad, pdfPfad] = process.argv.slice(2);
if (!htmlPfad || !pdfPfad) {
  console.error("Aufruf: node scripts/make-doc-pdf2.mjs <html> <pdf>");
  process.exit(1);
}
const url = pathToFileURL(path.resolve(htmlPfad)).href;

console.log("starte Electron …");
const app = await _electron.launch({ args: ["electron/main.cjs"] });
console.log("Electron laeuft, drucke …");

const base64 = await app.evaluate(async ({ BrowserWindow }, zielUrl) => {
  const win = new BrowserWindow({ show: false, width: 1240, height: 1754, webPreferences: { sandbox: false } });
  await win.loadURL(zielUrl);
  await new Promise((r) => setTimeout(r, 2000));
  const buf = await win.webContents.printToPDF({
    pageSize: "A4",
    printBackground: true,
    margins: { marginType: "custom", top: 0, bottom: 0, left: 0, right: 0 },
  });
  win.destroy();
  return buf.toString("base64");
}, url);

fs.writeFileSync(path.resolve(pdfPfad), Buffer.from(base64, "base64"));
console.log(`PDF: ${pdfPfad} (${(Buffer.from(base64, "base64").length / 1024 / 1024).toFixed(1)} MB)`);
await app.close().catch(() => {});
process.exit(0);
