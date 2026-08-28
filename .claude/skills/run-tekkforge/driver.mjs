/**
 * driver.mjs — Treiber für die TekkForge-Electron-App.
 *
 * Zwei Betriebsarten:
 *
 *   Batch (für Agenten die Regel):
 *     node .claude/skills/run-tekkforge/driver.mjs --run "launch; ram-open; ss panel"
 *
 *   REPL (zum Herumprobieren):
 *     node .claude/skills/run-tekkforge/driver.mjs
 *
 * Warum Batch und nicht tmux wie in den üblichen Vorlagen: Entwicklung läuft
 * hier unter Windows, wo es kein tmux gibt. Und Kommandos in den REPL zu pipen
 * funktioniert nur mit blinden `sleep`s dazwischen, weil die Pipe nicht auf den
 * Prompt wartet. Der Batch-Modus arbeitet die Liste sequenziell ab und wartet
 * auf jedes `await` — keine Sleeps, keine Wettläufe.
 *
 * Kein xvfb: Electron startet unter Windows mit echtem Fenster. Kein
 * `--no-sandbox`: das braucht nur der Container-Fall.
 */
import { _electron as electron } from "playwright-core";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

/** Repo-Wurzel: von .claude/skills/run-tekkforge/ drei Ebenen hoch. */
const APP_DIR = path.resolve(import.meta.dirname, "../../..");
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, ".tekkforge-shots");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin =
  process.platform === "win32"
    ? path.join(APP_DIR, "node_modules/electron/dist/electron.exe")
    : process.platform === "darwin"
      ? path.join(APP_DIR, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
      : path.join(APP_DIR, "node_modules/electron/dist/electron");

let app = null;
let page = null;
/** "dismiss" (Vorgabe) oder "accept" — wie native Dialoge beantwortet werden. */
let dialogMode = "dismiss";
/** Alle aufgetretenen Dialoge, abrufbar mit `dialogs`. */
const dialogLog = [];

const need = () => {
  if (!page) throw new Error("erst 'launch'");
  return page;
};

const COMMANDS = {
  async launch() {
    if (app) return console.log("läuft bereits");
    if (!fs.existsSync(path.join(APP_DIR, "dist/index.html"))) {
      throw new Error("dist/index.html fehlt — vorher 'pnpm build:gui' laufen lassen");
    }
    app = await electron.launch({
      executablePath: electronBin,
      args: [APP_DIR],
      cwd: APP_DIR,
      timeout: 60_000,
    });
    page = await app.firstWindow();

    // Die App benutzt native alert()/confirm() (Sample löschen, Slot
    // überschreiben, MIDI-Fehler …). Ein offener Dialog blockiert JEDEN
    // weiteren Playwright-Befehl und lässt den Treiber mit einem
    // "Page.handleJavaScriptDialog"-Fehler sterben — nicht mit einem Timeout,
    // sondern hart. Deshalb IMMER einen Handler registrieren, bevor
    // irgendetwas geklickt wird.
    //
    // Vorgabe ist Abweisen, nicht Bestätigen: die confirm()s dieser App hängen
    // an zerstörenden Aktionen (Slot überschreiben, Sample entfernen,
    // ungespeicherte Änderungen verwerfen). Wer eine davon wirklich will,
    // schaltet vorher `dialogs accept`.
    page.on("dialog", async (d) => {
      dialogLog.push(`${d.type()}: ${d.message()}`);
      await (dialogMode === "accept" ? d.accept() : d.dismiss()).catch(() => {});
    });
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.waitForLoadState("domcontentloaded").catch(() => {});
    // Die UI baut sich nach domcontentloaded noch auf; auf ein Element warten,
    // das erst der Editor-Code verdrahtet, statt blind zu schlafen.
    //
    // `state: "attached"` ist Absicht: #midiEnable liegt im zugeklappten
    // <details id="midiPanel">, und ein geschlossenes <details> versteckt
    // seinen Inhalt. Auf "visible" zu warten läuft in den Timeout, obwohl die
    // App längst bereit ist.
    await page.waitForSelector("#midiEnable", { state: "attached", timeout: 30_000 });
    console.log(`gestartet — ${app.windows().length} Fenster: ${page.url()}`);
  },

  /**
   * MIDI einschalten. Muss sein, bevor irgendetwas im MIDI-Bereich sichtbar
   * ist: #midiControls ist bis dahin `hidden`, und setupRamPanel() läuft
   * überhaupt nur, wenn die native MIDI-Brücke da ist.
   */
  async "midi-on"() {
    const p = need();
    await p.evaluate(() => document.getElementById("midiEnable")?.click());
    await p
      .waitForFunction(() => !document.getElementById("midiControls")?.classList.contains("hidden"), {
        timeout: 15_000,
      })
      .catch(() => {
        throw new Error("#midiControls bleibt versteckt — keine MIDI-Brücke? (Browser statt Electron?)");
      });
    console.log("MIDI an —", await p.evaluate(() => document.getElementById("midiStatus")?.textContent));
  },

  /** MIDI- und RAM-Panel aufklappen (beides sind <details>). */
  async "ram-open"() {
    await COMMANDS["midi-on"]();
    const p = need();
    const r = await p.evaluate(() => {
      const out = [];
      for (const id of ["midiPanel", "ramPanel"]) {
        const el = document.getElementById(id);
        if (!el) {
          out.push(`${id}:FEHLT`);
          continue;
        }
        // .open setzen, nicht auf das <summary> klicken — der Klick trifft je
        // nach Layout daneben, das Attribut wirkt immer.
        el.open = true;
        out.push(`${id}:${el.open}`);
      }
      document.getElementById("ramPanel")?.scrollIntoView({ block: "center" });
      return out.join(" ");
    });
    console.log("RAM-Panel offen —", r);
  },

  async ss(name) {
    const p = need();
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + ".png");
    await p.screenshot({ path: f });
    console.log("screenshot:", f);
  },

  /**
   * Klick über das DOM, nicht über Koordinaten. Playwrights locator.click()
   * rechnet Fensterkoordinaten aus und trifft bei Overlays die falsche Ebene.
   */
  /**
   * Legt eine Datei in ein <input type="file">. Ueber die Oberflaeche geht das
   * nicht: der Import-Knopf oeffnet einen nativen Dialog, den Playwright nicht
   * bedienen kann, und `input.files` ist aus JS heraus nicht setzbar.
   *
   *   files #importFile examples/e2s/CHORDTEST.e2spat
   */
  async files(arg) {
    const p = need();
    const i = arg.indexOf(" ");
    if (i < 0) throw new Error("files <selector> <pfad>");
    const sel = arg.slice(0, i).trim();
    const datei = path.resolve(APP_DIR, arg.slice(i + 1).trim());
    if (!fs.existsSync(datei)) throw new Error("Datei fehlt: " + datei);
    // Verzeichnis → Playwright reicht den Pfad an ein webkitdirectory-Feld (z. B. #genOrdner) durch.
    // Bei einem gewoehnlichen `multiple`-Feld (z. B. #genLied) waere das nichts wert; dort
    // werden die enthaltenen Dateien einzeln uebergeben. So kommt man an Ablaeufe heran,
    // die MEHRERE Dateien auf einmal brauchen — etwa ein Set aus drei Liedern.
    const istOrdner = fs.statSync(datei).isDirectory();
    const wkdir = istOrdner && (await p.evaluate((s) => !!document.querySelector(s)?.webkitdirectory, sel));
    const eingabe =
      istOrdner && !wkdir
        ? fs
            .readdirSync(datei)
            .map((n) => path.join(datei, n))
            .filter((f) => fs.statSync(f).isFile())
        : datei;
    await p.setInputFiles(sel, eingabe);
    const liste = Array.isArray(eingabe) ? eingabe : istOrdner ? fs.readdirSync(datei) : [datei];
    console.log("files", sel, "->", liste.length === 1 ? path.basename(datei) : `${liste.length} Dateien aus ${path.basename(datei)}`);
  },

  async click(sel) {
    const p = need();
    console.log(
      "click",
      sel,
      "->",
      await p.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return "NICHT_GEFUNDEN";
        el.click();
        return "OK";
      }, sel),
    );
  },

  /** Wert in ein <input>/<select>/<textarea> setzen UND change/input feuern. */
  async set(arg) {
    const p = need();
    const i = arg.indexOf("=");
    const sel = arg.slice(0, i).trim();
    const val = arg.slice(i + 1);
    console.log(
      "set",
      sel,
      "->",
      await p.evaluate(
        ([s, v]) => {
          const el = document.querySelector(s);
          if (!el) return "NICHT_GEFUNDEN";
          el.value = v;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return "OK";
        },
        [sel, val],
      ),
    );
  },

  async wait(sel) {
    const p = need();
    try {
      await p.waitForSelector(sel, { timeout: 15_000 });
      console.log("da:", sel);
    } catch {
      console.log("TIMEOUT:", sel);
    }
  },

  /** Warten, bis der Text eines Elements ein Muster enthält: wait-text <sel> <regex> */
  async "wait-text"(arg) {
    const p = need();
    const i = arg.indexOf(" ");
    const sel = arg.slice(0, i);
    const re = arg.slice(i + 1);
    try {
      await p.waitForFunction(
        ([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent ?? ""),
        [sel, re],
        { timeout: 20_000 },
      );
      console.log("passt:", sel, "=", await p.evaluate((s) => document.querySelector(s)?.textContent, sel));
    } catch {
      console.log(
        "TIMEOUT — Ist:",
        await p.evaluate((s) => document.querySelector(s)?.textContent, sel),
      );
    }
  },

  async ms(n) {
    await new Promise((r) => setTimeout(r, Number(n) || 500));
  },

  async eval(expr) {
    const p = need();
    console.log(JSON.stringify(await p.evaluate(expr)));
  },

  async text(sel) {
    const p = need();
    console.log(
      await p.evaluate(
        (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? "(null)",
        sel || null,
      ),
    );
  },

  /**
   * Ohne Argument: die bisher aufgetretenen nativen Dialoge auflisten.
   * `dialogs accept` / `dialogs dismiss` schaltet um, wie sie beantwortet
   * werden. Vor einer zerstörenden Bestätigung (Slot überschreiben, Sample
   * entfernen) also erst `dialogs accept` — sonst wird sie abgewiesen und die
   * Aktion passiert stillschweigend nicht.
   */
  async dialogs(mode) {
    if (mode === "accept" || mode === "dismiss") {
      dialogMode = mode;
      console.log("Dialog-Modus:", dialogMode);
      return;
    }
    console.log(dialogLog.length ? dialogLog.join("\n") : "(keine Dialoge)");
  },

  /** Konsolenfehler der Seite, die seit dem Start aufliefen. */
  async errors() {
    console.log(pageErrors.length ? pageErrors.join("\n") : "(keine)");
  },

  async quit() {
    if (app && page) {
      // ☠ NIE schliessen, solange ein Geraete-Schreibvorgang laeuft.
      //
      // Am 2026-08-13 real passiert: eine Wartebedingung griff zu frueh, das
      // Skript lief weiter, und `destroy()` hat den Renderer mitten in einem
      // 524-Byte-Write in drei Haeppchen gekappt. Ergebnis: IFX-Preset-Slot 0
      // im Geraet halb ueberschrieben — Name weg, Nachbarslots intakt. Genau
      // der "halb uebertragene Zustand", vor dem hacktribeRam.ts warnt.
      //
      // Deshalb hier warten, bis der Status kein laufender Vorgang mehr ist.
      await page
        .waitForFunction(
          () => {
            const t = document.getElementById("ramStatus")?.textContent ?? "";
            return !/sende \d+ Bytes|Lese Häppchen|wird wiederholt/.test(t);
          },
          { timeout: 30_000 },
        )
        .catch(() => console.log("WARNUNG: Vorgang lief beim Schliessen noch — Geraetezustand pruefen!"));
    }
    if (app) {
      // ☠ `app.close()` allein HÄNGT, sobald im Editor etwas geändert wurde:
      // editor.ts registriert einen `beforeunload`-Handler, der bei
      // ungespeicherten Änderungen den "Seite verlassen?"-Dialog auslöst. Der
      // blockiert das Schließen — und unser Dialog-Handler weist ihn per
      // Vorgabe ab, was hier gerade "NICHT schließen" bedeutet. Ergebnis: der
      // Treiber läuft in den Timeout, nachdem alle Kommandos längst durch sind.
      //
      // `w.destroy()` im Hauptprozess umgeht `beforeunload` komplett.
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const w of BrowserWindow.getAllWindows()) w.destroy();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    app = null;
    page = null;
  },

  help() {
    console.log("Kommandos:", Object.keys(COMMANDS).join(", "));
  },
};

const pageErrors = [];


async function run(line) {
  const t = line.trim();
  if (!t || t.startsWith("#")) return;
  const i = t.indexOf(" ");
  const cmd = i < 0 ? t : t.slice(0, i);
  const arg = i < 0 ? "" : t.slice(i + 1).trim();
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log("unbekannt:", cmd, "— 'help'");
    return;
  }
  await fn(arg);
}

const argv = process.argv.slice(2);
const runIdx = argv.indexOf("--run");
const scriptIdx = argv.indexOf("--script");

if (runIdx >= 0 || scriptIdx >= 0) {
  // Zwei Batch-Formen:
  //   --run "a; b; c"    Kommandos mit ';' getrennt — kurz und bequem.
  //   --script datei     ein Kommando pro Zeile — nötig, sobald ein `eval`
  //                      selbst Semikolons enthält, die der ';'-Trenner sonst
  //                      mitten im JS zerschneidet. '#' am Zeilenanfang ist
  //                      Kommentar.
  const lines =
    scriptIdx >= 0
      ? fs.readFileSync(argv[scriptIdx + 1], "utf8").split(/\r?\n/)
      : argv
          .slice(runIdx + 1)
          .join(" ")
          .split(";");
  let code = 0;
  for (const part of lines) {
    if (!part.trim()) continue;
    try {
      await run(part);
    } catch (e) {
      console.log("FEHLER bei", JSON.stringify(part.trim()) + ":", e.message);
      code = 1;
      break;
    }
  }
  await COMMANDS.quit();
  process.exit(code);
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "driver> ",
  });
  console.log("TekkForge-Treiber — 'help' für Kommandos, 'launch' zum Starten");
  rl.prompt();
  rl.on("line", async (line) => {
    try {
      await run(line);
    } catch (e) {
      console.log("FEHLER:", e.message);
    }
    if (line.trim() === "quit") {
      rl.close();
      process.exit(0);
    }
    rl.prompt();
  });
  rl.on("close", async () => {
    await COMMANDS.quit();
    process.exit(0);
  });
}
