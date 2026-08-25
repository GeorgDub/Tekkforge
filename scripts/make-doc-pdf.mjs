/**
 * make-doc-pdf.mjs — baut die Praesentations-PDF (Funktionen + Roadmap) aus
 * doc.html und den Screenshots. PDF-Druck ueber Electrons printToPDF, damit
 * kein zusaetzlicher Browser noetig ist.
 *
 *   node scripts/make-doc-pdf.mjs <html> <pdf>
 */
import { app, BrowserWindow } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

const [htmlPfad, pdfPfad] = process.argv.slice(2);
if (!htmlPfad || !pdfPfad) {
  console.error("Aufruf: node scripts/make-doc-pdf.mjs <html> <pdf>");
  process.exit(1);
}

const log = (s) => process.stdout.write(`${s}\n`);

await app.whenReady();
log("app bereit");
const win = new BrowserWindow({ show: false, width: 1240, height: 1754 });
await win.loadFile(path.resolve(htmlPfad));
log("html geladen");
// Bilder sind data:-URIs, brauchen aber einen Layout-Durchgang
await new Promise((r) => setTimeout(r, 1500));
const daten = await win.webContents.printToPDF({
  pageSize: "A4",
  printBackground: true,
  margins: { marginType: "custom", top: 0, bottom: 0, left: 0, right: 0 },
});
fs.writeFileSync(path.resolve(pdfPfad), daten);
log(`PDF: ${pdfPfad} (${(daten.length / 1024 / 1024).toFixed(1)} MB)`);
// hart beenden: app.quit() wartet sonst auf Fenster-Ereignisse
process.exit(0);
