/** Kurzpruefung der Doku: Seitenzahl der PDF + Screenshots der HTML-Seiten. */
import { _electron } from "playwright-core";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const pdf = fs.readFileSync("TekkForge-0.6.0-Uebersicht.pdf");
const seiten = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`PDF-Seiten: ${seiten}`);

const url = pathToFileURL(path.resolve(".tekkforge-shots/doc.html")).href;
const app = await _electron.launch({ args: ["electron/main.cjs"] });
await app.evaluate(async ({ BrowserWindow }, zielUrl) => {
  const win = new BrowserWindow({ show: true, width: 1240, height: 1754, webPreferences: { sandbox: false } });
  await win.loadURL(zielUrl);
}, url);
await new Promise((r) => setTimeout(r, 2500));
const fenster = app.windows();
const seite = fenster[fenster.length - 1];
const anzahl = await seite.evaluate(() => document.querySelectorAll(".seite").length);
console.log(`HTML-Abschnitte: ${anzahl}`);
for (const i of [0, 1, 2, 9, 10]) {
  const el = seite.locator(".seite").nth(i);
  if ((await el.count()) === 0) continue;
  await el.screenshot({ path: `.tekkforge-shots/pdfseite-${i + 1}.png` });
}
console.log("Screenshots geschrieben");
await app.close().catch(() => {});
process.exit(0);
