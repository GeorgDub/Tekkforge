#!/usr/bin/env node
/*
 * crossgrade-diagnose.cjs — den Crossgrade-Befund am Geraet auseinanderhalten.
 *
 * Hintergrund (Omnitribe docs/reverse/e2synth_auf_e2s_crossgrade_v202.md,
 * Nachtrag 2026-09-09): Die umgekoepfte Synth-Firmware wird vom Sampler
 * angenommen und geflasht, aber beim Booten steht wieder „Update". Zwei
 * Lesarten sind noch nicht getrennt:
 *   (A) Das Synth-OS bootet und haengt in seiner Panel-Update-Schleife.
 *   (B) Das Flashen kam nicht an, das Sampler-OS laeuft weiter.
 *
 * Dieses Skript sendet NUR read-only-Nachrichten und entscheidet die Lesart:
 *   1. Geraete-Inquiry  F0 42 50 00 00 F7
 *      -> Antwort-Byte 6:  0x23 = Synth-OS (Lesart A),  0x24 = Sampler-OS (B).
 *   2. Hacktribe-Peek 0x52 an 0xC00A80F0 (16 Byte)
 *      -> „Punch" = Hacktribe-abgeleiteter Sampler-Code laeuft.
 *         Timeout bei antwortender Inquiry -> Stock-Synth-Code.
 *
 * WANN AUSFUEHREN: genau dann, wenn das Geraet nach dem Crossgrade-Flash in
 * der „Update"-Anzeige haengt und per USB verbunden ist. Im Normalbetrieb
 * gibt es die erwartbare Sampler-Antwort (0x24 + „Punch").
 *
 * Aufruf:  node scripts/crossgrade-diagnose.cjs
 * Es wird NICHTS geflasht und NICHTS geschrieben. Rueckweg bei Bedarf bleibt:
 * die Werks-SYSTEM.VSB des Geraets ueber DATA UTILITY -> SOFTWARE UPDATE.
 */
"use strict";

const path = require("path");
let midi;
try {
  midi = require(path.join(__dirname, "..", "node_modules", "@julusian", "midi"));
} catch (e) {
  console.error("Konnte @julusian/midi nicht laden — im TekkForge-Ordner `pnpm install` laufen lassen.");
  process.exit(2);
}

const IFX_BASE = 0xc00a80f0;

function enc(bytes) {
  const out = [];
  for (let o = 0; o < bytes.length; o += 7) {
    const g = bytes.slice(o, o + 7);
    let m = 0;
    g.forEach((x, i) => { if (x & 0x80) m |= 1 << i; });
    out.push(m, ...g.map((x) => x & 0x7f));
  }
  return out;
}
function dec(syx) {
  const out = [];
  for (let o = 0; o < syx.length; o += 8) {
    const g = syx.slice(o, o + 8);
    for (let i = 1; i < g.length; i++) out.push(g[i] | (((g[0] >> (i - 1)) & 1) << 7));
  }
  return out;
}
const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const hex = (a) => a.map((x) => x.toString(16).padStart(2, "0")).join(" ");
const ascii = (a) => a.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("");

function findPort(factory) {
  const p = new factory();
  let idx = -1;
  for (let k = 0; k < p.getPortCount(); k++) if (/electribe/i.test(p.getPortName(k))) idx = k;
  return { p, idx };
}

async function main() {
  const { p: out, idx: oi } = findPort(midi.Output);
  const { p: inp, idx: ii } = findPort(midi.Input);
  if (oi < 0 || ii < 0) {
    console.error("Kein electribe-MIDI-Port gefunden. Ist das Gerät per USB verbunden und von keiner anderen App belegt?");
    process.exit(3);
  }
  inp.ignoreTypes(false, true, true);
  let buf = [];
  let resolve = null;
  inp.on("message", (_dt, m) => {
    buf.push(...m);
    if (buf.length && buf[buf.length - 1] === 0xf7 && buf[0] === 0xf0) {
      const f = buf; buf = [];
      if (resolve) { const r = resolve; resolve = null; r(f); }
    }
  });
  inp.openPort(ii); out.openPort(oi);

  function send(bytes, timeoutMs) {
    return new Promise((res) => {
      const t = setTimeout(() => { resolve = null; res(null); }, timeoutMs);
      resolve = (f) => { clearTimeout(t); res(f); };
      buf = [];
      out.sendMessage(bytes);
    });
  }

  console.log("Port:", out.getPortName(oi));
  console.log("");

  // 1) Geraete-Inquiry
  const inq = await send([0xf0, 0x42, 0x50, 0x00, 0x00, 0xf7], 2000);
  let osByte = null;
  if (!inq) {
    console.log("1) Inquiry: KEINE Antwort. Gerät antwortet nicht auf SysEx — evtl. mitten im Update-/Panel-Transfer.");
  } else {
    console.log("1) Inquiry RX:", hex(inq));
    osByte = inq[6];
    console.log("   Device-ID-Byte (Index 6): 0x" + (osByte != null ? osByte.toString(16) : "--"));
    if (osByte === 0x23) console.log("   => 0x23: SYNTH-OS läuft. Lesart (A): der Crossgrade bootete, hängt in der Panel-Update-Schleife.");
    else if (osByte === 0x24) console.log("   => 0x24: SAMPLER-OS läuft. Lesart (B): das Flashen kam nicht an / Sampler-Firmware läuft weiter.");
    else console.log("   => unerwartet — bitte den ganzen RX melden.");
  }
  console.log("");

  // 2) Hacktribe-Peek
  const rd = await send([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x52, ...enc([...u32(IFX_BASE), ...u32(0x10)]), 0xf7], 3000);
  if (!rd) {
    console.log("2) Peek 0x52 @0xC00A80F0: KEINE Antwort.");
    console.log("   Kein Hacktribe-Peek → spricht für Stock-Synth-Code (Lesart A) — sofern die Inquiry oben antwortete.");
  } else {
    console.log("2) Peek RX:", hex(rd.slice(0, Math.min(rd.length, 12))), "...");
    const data = dec(rd.slice(9, rd.length - 1));
    console.log("   Daten:", ascii(data.slice(0, 16)));
    if (ascii(data.slice(0, 16)).includes("Punch")) console.log("   => 'Punch': Hacktribe-abgeleiteter SAMPLER-Code läuft (Lesart B).");
    else console.log("   => antwortet, aber kein 'Punch' — bitte die Daten-Zeile melden.");
  }
  console.log("");

  // Fazit
  console.log("FAZIT:");
  if (osByte === 0x23) console.log("  Synth-OS aktiv (0x23) → der Crossgrade bootet; das Problem ist das Panel-/Versions-Gate im Synth-OS.");
  else if (osByte === 0x24) console.log("  Sampler-OS aktiv (0x24) → der Crossgrade-Payload läuft nicht; das Flashen/der Boot des Synth-OS scheitert vor der Übernahme.");
  else console.log("  Unklar — bitte die RX-Zeilen oben an TekkForge zurückgeben.");

  inp.closePort(); out.closePort();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
