// Layout-Check des OTP-Modul-Panels in der ECHTEN Electron-App (playwright-core).
// Das Panel ist beim Start normal verborgen (viewEditor/midiControls/otpRegler =
// display:none, bis der Nutzer in den Editor wechselt, MIDI aktiviert, „Gerät fragen"
// klickt). Fuer einen reinen LAYOUT-Check erzwingen wir Sichtbarkeit der Container —
// OHNE MIDI zu aktivieren, OHNE einen Port zu oeffnen. Geprueft wird nur, ob die
// Knoepfe sauber rendern (sichtbar, klickbar, kein Ueberlauf).
import { _electron } from "playwright-core";
const OUT = process.argv[2] || "otp-panel.png";
let app, code = 0;
const fail = (m) => { console.error("FAIL:", m); code = 1; };
try {
  app = await _electron.launch({ args: ["electron/main.cjs"] });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForSelector("#otpModulKnoepfe", { timeout: 15000, state: "attached" });
  // Container fuer den Layout-Check sichtbar zwingen (kein MIDI, kein Port).
  await win.evaluate(() => {
    const box = document.getElementById("otpModulKnoepfe");
    // Ganze Vorfahren-Kette hart sichtbar zwingen: .hidden-Klasse weg + display setzen.
    for (let el = box; el && el !== document.body; el = el.parentElement) {
      el.classList.remove("hidden");
      const cs = getComputedStyle(el);
      if (cs.display === "none") el.style.setProperty("display", el.tagName === "DIV" ? "block" : "", "important");
    }
    for (const d of document.querySelectorAll("details")) d.open = true;
  });
  await win.waitForTimeout(400);
  const info = await win.evaluate(() => {
    const box = document.getElementById("otpModulKnoepfe");
    const btns = box ? Array.from(box.querySelectorAll("button")) : [];
    const det = (b) => { const r = b.getBoundingClientRect(); return { id: b.id, label: (b.textContent||"").trim(), w: Math.round(r.width), h: Math.round(r.height), disabled: b.disabled }; };
    // Ueberlauf NUR am Modul-Container messen (das erzwungene Gesamt-Layout ist kein Massstab).
    const overflow = box ? box.scrollWidth > box.clientWidth + 2 : true;
    return { count: btns.length, buttons: btns.map(det), overflow, docW: box?box.clientWidth:0, scrollW: box?box.scrollWidth:0 };
  });
  console.log(`Modul-Knoepfe: ${info.count}   Container ${info.docW}px, Inhalt ${info.scrollW}px`);
  for (const b of info.buttons) console.log(`  ${b.id.padEnd(16)} "${b.label}"  ${b.w}x${b.h}px${b.disabled?" DISABLED":""}`);
  if (info.count !== 10) fail(`erwartet 10 Knoepfe, gefunden ${info.count}`);
  for (const b of info.buttons) { if (b.w<=0||b.h<=0) fail(`${b.id} nicht sichtbar (${b.w}x${b.h})`); if (b.disabled) fail(`${b.id} disabled`); }
  if (info.overflow) fail(`Modul-Container laeuft ueber (Inhalt ${info.scrollW} > ${info.docW})`);
  const labels = info.buttons.map(b=>b.label).join("|");
  if (!/modmatrix/.test(labels)) fail("modmatrix fehlt");
  if (!/audio_input_routing/.test(labels)) fail("audio_input_routing fehlt");
  const box = await win.$("#otpModulKnoepfe");
  if (box) await box.screenshot({ path: OUT }).then(()=>console.log(`Screenshot: ${OUT}`)).catch(e=>fail("Screenshot: "+e.message));
  console.log(code===0 ? "RENDER-CHECK: OK" : "RENDER-CHECK: FEHLER");
} catch (e) { fail(e && e.message ? e.message : String(e)); }
finally { if (app) await app.close().catch(()=>{}); process.exit(code); }
