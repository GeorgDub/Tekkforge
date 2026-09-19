# Omnitribe-Modul-Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein eigener "Omnitribe"-Tab in der TekkForge-Electron-App zum Laden/Entladen/Konfigurieren/Stummschalten der Omnitribe-Module (Chord id9, Arp id1) auf der KORG Electribe 2 per SysEx — ohne CLI.

**Architecture:** Neues Renderer-Panel `src/gui/omniPanel.ts` (Muster wie `otpPanel`/`paddeck`), das die vorhandenen `src/core/otp.ts`-Builder + `requestSysex`/`waitSysex` (aus `src/gui/midi.ts`) ueber einen Hooks-Block nutzt. Modul-Register + `buildPeek/parsePeek` werden in `core/otp.ts` ergaenzt. Die kompilierten `.bin` werden als Base64 in TekkForge gebuendelt (`src/core/omniModuleBins.ts`, erzeugt von `scripts/bundle-omni-modules.mjs`).

**Tech Stack:** TypeScript (ES2020, strict, `tsc --noEmit`), Vite (single-file), Electron, Vitest. MIDI ueber `panelBridge.midi`. Kein Web-MIDI.

**Spec:** `docs/superpowers/specs/2026-09-19-omnitribe-module-panel-design.md`

## Global Constraints

- TypeScript `strict`; `pnpm check` (= `tsc --noEmit`) muss gruen sein.
- Tests via `pnpm vitest run <datei>`; neue Tests unter `tests/`.
- Alle SysEx-Frames kommen aus `src/core/otp.ts` — KEINE rohen Byte-Arrays im Panel.
- Der Renderer liest NICHT das Dateisystem — Modul-Bytes aus dem gebuendelten `src/core/omniModuleBins.ts`.
- Referenzwahrheit: `scripts/multi-module.mjs`, `scripts/chord-solo.mjs`, `scripts/peek.mjs`.
- Chord = id 9 (msb 0x1e), Arp = id 1 (msb 0x16). NRPN = cb-Index 1 (ON_NRPN), Args `[msb, (part<<4)|pid, valLo, valHi]`. Periodik = IRQ 21, Install `buildIrqInstall(21,0,21,1)`, Config `buildIrqConfig(0,21,1)`.
- Deutsche UI-Texte/Bezeichner (Repo-Konvention). Part-Nummern intern 0-basiert, in der UI 1-basiert anzeigen.

---

### Task 1: `buildPeek` / `parsePeek` in core/otp.ts

**Files:**
- Modify: `src/core/otp.ts`
- Test: `tests/omni-otp.test.ts` (neu)

**Interfaces:**
- Consumes: `encode7Bit`, `decode7Bit`, `OTP_MFR_ID`, `OTP_SYSEX_START`, `OTP_SYSEX_END`.
- Produces:
  - `buildPeek(addr: number, len: number): Uint8Array` — Sonderrahmen `F0 7D 01 02 52 <enc7(le32(addr)+le32(len))> F7`.
  - `istPeekAntwort(raw): boolean` — Praedikat fuer `requestSysex` (raw[1]===0x7d && raw[4]===0x52).
  - `parsePeek(raw, len): Uint8Array | null`.
  - `peekU32(raw): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/omni-otp.test.ts
import { describe, it, expect } from "vitest";
import { buildPeek, istPeekAntwort, parsePeek, peekU32 } from "../src/core/otp";

describe("OTP Peek (0x52)", () => {
  it("baut den Sonderrahmen F0 7D 01 02 52 ... F7", () => {
    const f = buildPeek(0xc2200084, 4);
    expect(f[0]).toBe(0xf0);
    expect([f[1], f[2], f[3]]).toEqual([0x7d, 0x01, 0x02]);
    expect(f[4]).toBe(0x52);
    expect(f[f.length - 1]).toBe(0xf7);
  });
  it("Round-Trip: Anfrage-Nutzlast dekodiert zu addr+len zurueck", () => {
    const f = buildPeek(0x11223344, 16);
    const roh = parsePeek(f.slice(4), 8); // ab 0x52
    expect(roh).not.toBeNull();
    expect(Array.from(roh!.slice(0, 4))).toEqual([0x44, 0x33, 0x22, 0x11]);
    expect(Array.from(roh!.slice(4, 8))).toEqual([16, 0, 0, 0]);
  });
  it("istPeekAntwort erkennt 0x52 und weist Fremdrahmen ab", () => {
    expect(istPeekAntwort(Uint8Array.of(0xf0, 0x7d, 0x01, 0x02, 0x52, 0x00, 0xf7))).toBe(true);
    expect(istPeekAntwort(Uint8Array.of(0xf0, 0x42, 0x00, 0xf7))).toBe(false);
  });
  it("peekU32 liest LE-u32 aus einer Antwort", () => {
    const antwort = Uint8Array.of(0xf0, 0x7d, 0x01, 0x02, 0x52, 0b0000, 0x78, 0x56, 0x34, 0x12, 0xf7);
    expect(peekU32(antwort)).toBe(0x12345678);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/omni-otp.test.ts`
Expected: FAIL — "buildPeek is not a function".

- [ ] **Step 3: Write minimal implementation**

In `src/core/otp.ts` nach den Peek/Telemetrie-Buildern:

```ts
// ─── 0x52 Memory-Peek (READ ONLY, <= 64 Byte) ────────────────────────────────
// Sonderrahmen des Hacktribe-Peek-Passthrough: KEIN CMD/SUB/LEN/CHK, sondern
// F0 7D 01 02 52 <7-of-8(le32(addr) ++ le32(len))> F7. Gegenstelle: scripts/peek.mjs.
const le32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

export function buildPeek(addr: number, len: number): Uint8Array {
  const l = Math.max(0, Math.min(64, len));
  const nutz = encode7Bit([...le32(addr >>> 0), ...le32(l >>> 0)]);
  return Uint8Array.from([OTP_SYSEX_START, ...OTP_MFR_ID, 0x52, ...nutz, OTP_SYSEX_END]);
}
export function istPeekAntwort(raw: Uint8Array | readonly number[]): boolean {
  return raw.length >= 6 && raw[1] === OTP_MFR_ID[0] && raw[4] === 0x52;
}
export function parsePeek(raw: Uint8Array | readonly number[], len: number): Uint8Array | null {
  if (raw.length < 2) return null;
  const start = raw[0] === OTP_SYSEX_START ? 5 : 1;
  const ende = raw[raw.length - 1] === OTP_SYSEX_END ? raw.length - 1 : raw.length;
  return decode7Bit(Array.from(raw).slice(start, ende)).slice(0, len);
}
export function peekU32(raw: Uint8Array | readonly number[]): number | null {
  const d = parsePeek(raw, 4);
  return d && d.length >= 4 ? ((d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24)) >>> 0) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/omni-otp.test.ts` → PASS. Dann `pnpm check` → gruen.

- [ ] **Step 5: Commit**

```bash
git add src/core/otp.ts tests/omni-otp.test.ts
git commit -m "feat(otp): buildPeek/parsePeek (0x52 Memory-Peek) fuer Panel-Status"
```

---

### Task 2: Omni-Modul-Register (Daten) in core/otp.ts

**Files:**
- Modify: `src/core/otp.ts`
- Test: `tests/omni-otp.test.ts` (erweitern)

**Interfaces:**
- Consumes: `buildModuleCallback`, `OTP_MODULE_CB`.
- Produces: `OmniParamKind`, `OmniParam`, `OmniModule`, `OMNI_MODULES`, `buildOmniNrpn(mod, part, pid, value)`.

- [ ] **Step 1: Write the failing test**

```ts
// in tests/omni-otp.test.ts ergaenzen
import { OMNI_MODULES, buildOmniNrpn, OtpCmd, OtpSub, parseFrame } from "../src/core/otp";

describe("Omni-Modul-Register", () => {
  it("kennt Chord (id9) und Arp (id1) als getestet", () => {
    const chord = OMNI_MODULES.find((m) => m.id === 9)!;
    const arp = OMNI_MODULES.find((m) => m.id === 1)!;
    expect(chord.tested && arp.tested).toBe(true);
    expect([chord.msb, arp.msb]).toEqual([0x1e, 0x16]);
    expect(arp.params.map((p) => p.pid)).toEqual(expect.arrayContaining([0x04, 0x05, 0x06]));
  });
  it("fuehrt weitere Module als ungetestet", () => {
    expect(OMNI_MODULES.find((m) => m.id === 19)!.tested).toBe(false);
  });
  it("buildOmniNrpn == chord-solo.mjs (Chord enabled[P1]=1)", () => {
    const chord = OMNI_MODULES.find((m) => m.id === 9)!;
    const p = parseFrame(buildOmniNrpn(chord, 0, 0x03, 1));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect([p.cmd, p.sub]).toEqual([OtpCmd.MODULE, OtpSub.MODULE_CALLBACK]);
      expect(Array.from(p.payload)).toEqual([9, 1, 0, 0x1e, 0x03, 0x01, 0x00]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/omni-otp.test.ts` → FAIL (`OMNI_MODULES` nicht exportiert).

- [ ] **Step 3: Write minimal implementation**

In `src/core/otp.ts` nach `buildModuleCallback`:

```ts
// ─── Omni-Modul-Register (fuer das TekkForge-Panel) ──────────────────────────
export type OmniParamKind = "enum" | "range" | "toggle" | "part";
export interface OmniParam {
  pid: number; label: string; kind: OmniParamKind;
  min?: number; max?: number; options?: readonly { wert: number; text: string }[]; perPart?: boolean;
}
export interface OmniModule { id: number; name: string; msb: number; tested: boolean; params: readonly OmniParam[]; }

const CHORD_TYPEN = [
  { wert: 0, text: "Dur" }, { wert: 1, text: "Moll" }, { wert: 2, text: "Dur7" },
  { wert: 3, text: "Moll7" }, { wert: 4, text: "Sus4" }, { wert: 5, text: "Dim" },
] as const;
const ARP_MODI = [
  { wert: 0, text: "Up" }, { wert: 1, text: "Down" }, { wert: 2, text: "UpDown" }, { wert: 3, text: "DownUp" },
  { wert: 4, text: "Random" }, { wert: 5, text: "Chord" }, { wert: 6, text: "Order" },
] as const;
const ARP_RATEN = [
  { wert: 0, text: "1/4" }, { wert: 1, text: "1/8" }, { wert: 2, text: "1/16" },
  { wert: 3, text: "1/32" }, { wert: 4, text: "1/8T" }, { wert: 5, text: "1/16T" },
] as const;

export const OMNI_MODULES: readonly OmniModule[] = [
  { id: 9, name: "Chord", msb: 0x1e, tested: true, params: [
    { pid: 0x00, label: "Typ", kind: "enum", options: CHORD_TYPEN },
    { pid: 0x01, label: "Stagger", kind: "range", min: 0, max: 100 },
    { pid: 0x02, label: "Root (>127 = gespielt)", kind: "range", min: 0, max: 200 },
    { pid: 0x03, label: "Aktiv", kind: "toggle", perPart: true },
  ] },
  { id: 1, name: "Arp", msb: 0x16, tested: true, params: [
    { pid: 0x00, label: "Modus", kind: "enum", options: ARP_MODI },
    { pid: 0x01, label: "Rate", kind: "enum", options: ARP_RATEN },
    { pid: 0x02, label: "Oktaven", kind: "range", min: 1, max: 4 },
    { pid: 0x03, label: "Gate %", kind: "range", min: 1, max: 100 },
    { pid: 0x04, label: "Latch", kind: "toggle", perPart: true },
    { pid: 0x05, label: "Ziel-Part", kind: "part", perPart: true },
    { pid: 0x06, label: "Aktiv", kind: "toggle", perPart: true },
    { pid: 0x07, label: "Eingang stumm", kind: "toggle", perPart: true },
  ] },
  { id: 19, name: "spectral_morph", msb: 0x00, tested: false, params: [] },
  { id: 20, name: "sd_stream", msb: 0x00, tested: false, params: [] },
  { id: 21, name: "audio_input_routing", msb: 0x00, tested: false, params: [] },
  { id: 30, name: "audio_test", msb: 0x00, tested: false, params: [] },
];

/** on_nrpn(msb, (part<<4)|pid, value14) fuer ein Omni-Modul. */
export function buildOmniNrpn(mod: OmniModule, part: number, pid: number, value: number): Uint8Array {
  return buildModuleCallback(mod.id, OTP_MODULE_CB.ON_NRPN, [
    mod.msb & 0x7f, ((part & 0x0f) << 4) | (pid & 0x0f), value & 0xff, (value >> 8) & 0xff,
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/omni-otp.test.ts` → PASS. `pnpm check` → gruen.

- [ ] **Step 5: Commit**

```bash
git add src/core/otp.ts tests/omni-otp.test.ts
git commit -m "feat(otp): Omni-Modul-Register + buildOmniNrpn"
```

---

### Task 3: Modul-.bin-Bundle (Base64) + Build-Skript

**Files:**
- Create: `scripts/bundle-omni-modules.mjs`
- Create: `src/core/omniModuleBins.ts` (vom Skript erzeugt; committen)
- Test: `tests/omni-bins.test.ts` (neu)

**Interfaces:**
- Produces (in `src/core/omniModuleBins.ts`):
  - `const OMNI_MODULE_BINS: Record<number, string>` — Modul-id → Base64 der `.bin`.
  - `omniModuleBytes(id: number): Uint8Array | null` — dekodiert Base64 → Bytes; `null` wenn nicht gebuendelt.

- [ ] **Step 1: Write the failing test**

```ts
// tests/omni-bins.test.ts
import { describe, it, expect } from "vitest";
import { omniModuleBytes } from "../src/core/omniModuleBins";

describe("Omni-Modul-Bundle", () => {
  it("liefert Chord (id9) und Arp (id1) mit passender Header-id", () => {
    for (const [id] of [[9], [1]] as const) {
      const b = omniModuleBytes(id);
      expect(b, `Modul ${id} muss gebuendelt sein`).not.toBeNull();
      expect(b!.length).toBeGreaterThan(44); // Header + code
      const headerId = b![6] | (b![7] << 8); // OTMR-Header: id bei Offset 6/7
      expect(headerId).toBe(id);
    }
  });
  it("liefert null fuer ein nicht gebuendeltes Modul", () => {
    expect(omniModuleBytes(255)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/omni-bins.test.ts` → FAIL (Modul nicht importierbar).

- [ ] **Step 3: Build-Skript schreiben und ausfuehren**

`scripts/bundle-omni-modules.mjs`:

```js
// Buendelt die kompilierten Omnitribe-Modul-.bin als Base64 in src/core/omniModuleBins.ts.
// Neu ausfuehren, wenn sich ein Modul aendert: node scripts/bundle-omni-modules.mjs
import fs from "node:fs";
import path from "node:path";

const SRC = process.env.OMNI_BUILD_DIR || "G:/IdeaProjects/Omnitribe/build/modules_abs";
const MODULE = [
  { id: 9, datei: "chord.bin" },
  { id: 1, datei: "arpeggiator.bin" },
  { id: 19, datei: "spectral_morph.bin" },
  { id: 20, datei: "sd_stream.bin" },
  { id: 21, datei: "audio_input_routing.bin" },
  { id: 30, datei: "audio_test.bin" },
];
const eintraege = [];
for (const m of MODULE) {
  const p = path.join(SRC, m.datei);
  if (!fs.existsSync(p)) { console.warn(`uebersprungen (fehlt): ${p}`); continue; }
  const b64 = fs.readFileSync(p).toString("base64");
  eintraege.push(`  ${m.id}: "${b64}",`);
  console.log(`gebuendelt id ${m.id}: ${m.datei} (${fs.statSync(p).size} B)`);
}
const out = `// AUTOGENERIERT von scripts/bundle-omni-modules.mjs — nicht von Hand editieren.
// Base64 der kompilierten Omnitribe-Modul-.bin (Header + code + data).
export const OMNI_MODULE_BINS: Record<number, string> = {
${eintraege.join("\n")}
};

export function omniModuleBytes(id: number): Uint8Array | null {
  const b64 = OMNI_MODULE_BINS[id];
  if (!b64) return null;
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
`;
fs.writeFileSync("src/core/omniModuleBins.ts", out);
console.log("geschrieben: src/core/omniModuleBins.ts");
```

Ausfuehren: `node scripts/bundle-omni-modules.mjs` (erzeugt `src/core/omniModuleBins.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/omni-bins.test.ts` → PASS. `pnpm check` → gruen.

- [ ] **Step 5: Commit**

```bash
git add scripts/bundle-omni-modules.mjs src/core/omniModuleBins.ts tests/omni-bins.test.ts
git commit -m "feat(omni): Modul-.bin als Base64 buendeln + Build-Skript"
```

---

### Task 4: Tab-Geruest + Panel-Skelett

**Files:**
- Modify: `index.html` (Rail-Knopf `tabOmni` bei den anderen Tab-Knoepfen; leere `<section id="viewOmni" class="hidden">`)
- Modify: `src/gui/main.ts` (Tab-Union + TABS-Eintrag + Import + `initOmni()`-Aufruf)
- Create: `src/gui/omniPanel.ts`
- Test: `tests/omni-panel.test.ts` (neu)

**Interfaces:**
- Consumes: `OMNI_MODULES`.
- Produces:
  - `interface OmniHooks { sysexSenden(f: Uint8Array): Promise<void>; sysexAnfrage(f: Uint8Array, ok: (r: Uint8Array) => boolean, timeoutMs?: number): Promise<Uint8Array>; warten(ok: (r: Uint8Array) => boolean, timeoutMs?: number): Promise<Uint8Array | null>; }`
  - `initOmni(h: OmniHooks): void` — baut das DOM in `viewOmni`.
  - `omniZustand(): { module: { id: number; platziert: boolean }[] }` (fuer Tests).

- [ ] **Step 1: Write the failing test**

```ts
// tests/omni-panel.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { initOmni, omniZustand } from "../src/gui/omniPanel";

function domVorbereiten() {
  document.body.innerHTML = `<section id="viewOmni"></section>`;
}
const hooksStub = () => ({
  sysexSenden: vi.fn(async () => {}),
  sysexAnfrage: vi.fn(async () => new Uint8Array()),
  warten: vi.fn(async () => null),
});

describe("Omni-Panel", () => {
  beforeEach(domVorbereiten);
  it("baut fuer jedes Modul eine Karte mit Laden/Entladen", () => {
    initOmni(hooksStub());
    const karten = document.querySelectorAll("#viewOmni [data-omni-modul]");
    expect(karten.length).toBe(6); // Chord, Arp + 4 ungetestete
    expect(document.querySelector('#viewOmni [data-omni-modul="9"]')).not.toBeNull();
  });
  it("markiert ungetestete Module sichtbar", () => {
    initOmni(hooksStub());
    const sm = document.querySelector('#viewOmni [data-omni-modul="19"]')!;
    expect(sm.textContent).toContain("ungetestet");
  });
  it("omniZustand listet die Module (anfangs nicht platziert)", () => {
    initOmni(hooksStub());
    expect(omniZustand().module.every((m) => !m.platziert)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/omni-panel.test.ts` → FAIL (`initOmni` fehlt).

- [ ] **Step 3: Minimal-Implementierung**

`src/gui/omniPanel.ts`:

```ts
import { OMNI_MODULES, type OmniModule } from "../core/otp";

export interface OmniHooks {
  sysexSenden(f: Uint8Array): Promise<void>;
  sysexAnfrage(f: Uint8Array, ok: (r: Uint8Array) => boolean, timeoutMs?: number): Promise<Uint8Array>;
  warten(ok: (r: Uint8Array) => boolean, timeoutMs?: number): Promise<Uint8Array | null>;
}

let hooks: OmniHooks | null = null;
const platziert = new Set<number>();

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element fehlt: ${id}`);
  return el;
}

function kartenMarkup(m: OmniModule): string {
  const badge = m.tested ? "" : ` <span class="omni-badge">ungetestet</span>`;
  return `<div class="omni-karte" data-omni-modul="${m.id}">
    <div class="omni-kopf">${m.name} <small>id ${m.id}</small>${badge}
      <span class="omni-led" data-omni-led="${m.id}"></span></div>
    <div class="omni-zeile">
      <label>Part <select data-omni-part="${m.id}">${
        Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}</option>`).join("")
      }</select></label>
      <button data-omni-laden="${m.id}">Laden</button>
      <button data-omni-entladen="${m.id}">Entladen</button>
    </div>
    <div class="omni-params" data-omni-params="${m.id}"></div>
  </div>`;
}

export function initOmni(h: OmniHooks): void {
  hooks = h;
  platziert.clear();
  $("viewOmni").innerHTML = `<div class="omni-kopfleiste">
      <button id="omniPreset">Preset laden (Chord P1 + Arp P3-4)</button>
      <button id="omniAus">Alles aus</button>
      <span id="omniStatus">bereit</span>
    </div>
    <div class="omni-liste">${OMNI_MODULES.map(kartenMarkup).join("")}</div>`;
  // Event-Handler folgen in Task 5-7.
}

export function omniZustand(): { module: { id: number; platziert: boolean }[] } {
  return { module: OMNI_MODULES.map((m) => ({ id: m.id, platziert: platziert.has(m.id) })) };
}

/** Interne Helfer fuer Folge-Tasks (Set-Zugriff gekapselt). */
export const _omniIntern = { platziert, hooks: () => hooks };
```

`index.html`: bei den Tab-Knoepfen (Rail) `<button id="tabOmni" ...>Omnitribe</button>` und bei den Views `<section id="viewOmni" class="hidden"></section>` ergaenzen (gleiche Attribute/Klassen wie `tabPadDeck`/`viewPadDeck`).

`src/gui/main.ts`:
- Zeile 23: `"omni"` in die `Tab`-Union aufnehmen.
- TABS-Objekt: `omni: { view: "viewOmni", knopf: "tabOmni", titel: "Omnitribe", sichtbar: omniWirdSichtbar },` (falls kein `sichtbar` noetig, weglassen).
- Import: `import { initOmni } from "./omniPanel";` und (analog otpPanel im Editor) beim Boot verdrahten:

```ts
initOmni({
  sysexSenden: async (f) => { await panelBridge.midi.sendAsync(f); },
  sysexAnfrage: (f, ok, t) => requestSysex(panelBridge.midi, f, ok, t),
  warten: (ok, t) => waitSysex(panelBridge.midi, ok, t),
});
```
(`requestSysex`/`waitSysex` aus `./midi` importieren, `panelBridge` wie in main.ts vorhanden.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/omni-panel.test.ts` → PASS. `pnpm check` → gruen. `pnpm build:gui` baut fehlerfrei.

- [ ] **Step 5: Commit**

```bash
git add index.html src/gui/main.ts src/gui/omniPanel.ts tests/omni-panel.test.ts
git commit -m "feat(gui): Omnitribe-Tab + Panel-Skelett (Modul-Karten)"
```

---

### Task 5: Laden / Entladen (Upload + Commit + Unplace)

**Files:**
- Modify: `src/gui/omniPanel.ts`
- Test: `tests/omni-panel.test.ts` (erweitern)

**Interfaces:**
- Consumes: `omniModuleBytes` (Task 3), `buildModuleUpload`, `buildModuleCommit`, `buildModuleUnplace`, `parseModuleAck`, `istOtpAntwort`, `OtpCmd`, `OtpSub` (otp.ts). `OmniHooks` (Task 4).
- Produces: an `[data-omni-laden]`/`[data-omni-entladen]` gebundene Handler; aktualisiert `platziert` + LED.

- [ ] **Step 1: Write the failing test**

```ts
// in tests/omni-panel.test.ts ergaenzen
import { OtpCmd, OtpSub, buildFrame } from "../src/core/otp";

it("Laden sendet Chunks + Commit und wartet je ACK", async () => {
  // ACK-Antwort simulieren: CMD 0x05 SUB 0x03, [status0, id, block]
  const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 9, 0]);
  const h = { sysexSenden: vi.fn(async () => {}), sysexAnfrage: vi.fn(async () => ack), warten: vi.fn(async () => ack) };
  initOmni(h);
  (document.querySelector('#viewOmni [data-omni-laden="9"]') as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 5));
  // mindestens ein Commit-Frame (SUB 0x04) ging raus
  const gesendet = h.sysexSenden.mock.calls.map((c) => c[0] as Uint8Array);
  expect(gesendet.some((f) => f[5] === OtpSub.MODULE_COMMIT)).toBe(true);
  expect(omniZustand().module.find((m) => m.id === 9)!.platziert).toBe(true);
});
it("Entladen sendet Unplace und raeumt platziert", async () => {
  const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 9, 0]);
  const h = { sysexSenden: vi.fn(async () => {}), sysexAnfrage: vi.fn(async () => ack), warten: vi.fn(async () => ack) };
  initOmni(h);
  (document.querySelector('#viewOmni [data-omni-entladen="9"]') as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 5));
  expect(h.sysexSenden.mock.calls.some((c) => (c[0] as Uint8Array)[5] === OtpSub.MODULE_UNPLACE)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/omni-panel.test.ts` → FAIL (Klick tut nichts).

- [ ] **Step 3: Implementierung**

In `omniPanel.ts` `initOmni` am Ende Event-Delegation ergaenzen (nach dem `innerHTML`):

```ts
import {
  buildModuleUpload, buildModuleCommit, buildModuleUnplace, parseModuleAck,
  istOtpAntwort, OtpCmd, OtpSub,
} from "../core/otp";
import { omniModuleBytes } from "../core/omniModuleBins";

async function modulLaden(id: number): Promise<void> {
  if (!hooks) return;
  const bytes = omniModuleBytes(id);
  if (!bytes) { statusSetzen(`Modul ${id}: kein Build gebuendelt`); return; }
  const frames = buildModuleUpload(id, bytes); // N Chunks + Commit
  for (let i = 0; i < frames.length; i++) {
    await hooks.sysexSenden(frames[i]);
    const ack = await hooks.warten((r) => istOtpAntwort(r, OtpCmd.MODULE, OtpSub.MODULE_ACK), 1500);
    const a = ack ? parseModuleAck(parseFramePayload(ack)) : null;
    if (a && !a.ok && frames[i][5] === OtpSub.MODULE_COMMIT) { statusSetzen(`Commit-Fehler: ${a.text}`); return; }
  }
  platziert.add(id);
  ledAktualisieren();
  statusSetzen(`Modul ${id} geladen`);
}

async function modulEntladen(id: number): Promise<void> {
  if (!hooks) return;
  await hooks.sysexSenden(buildModuleUnplace(id));
  platziert.delete(id);
  ledAktualisieren();
  statusSetzen(`Modul ${id} entladen`);
}

function parseFramePayload(raw: Uint8Array): Uint8Array {
  // ACK-Payload aus einem vollstaendigen OTP-Rahmen ziehen (ab Byte 8 bis vor CHK/F7).
  const len = ((raw[6] & 0x7f) << 7) | (raw[7] & 0x7f);
  return raw.slice(8, 8 + len);
}
function statusSetzen(t: string): void { const el = document.getElementById("omniStatus"); if (el) el.textContent = t; }
function ledAktualisieren(): void {
  for (const m of OMNI_MODULES) {
    const led = document.querySelector(`[data-omni-led="${m.id}"]`);
    if (led) led.classList.toggle("an", platziert.has(m.id));
  }
}
```

Und die Delegation in `initOmni`:

```ts
$("viewOmni").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const laden = t.getAttribute("data-omni-laden");
  const entladen = t.getAttribute("data-omni-entladen");
  if (laden) void modulLaden(Number(laden));
  else if (entladen) void modulEntladen(Number(entladen));
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/omni-panel.test.ts` → PASS. `pnpm check` → gruen.

- [ ] **Step 5: Commit**

```bash
git add src/gui/omniPanel.ts tests/omni-panel.test.ts
git commit -m "feat(gui): Omni-Panel Laden/Entladen (Upload+Commit+Unplace, ACK-geprueft)"
```

---

### Task 6: Parameter-Konfiguration + Enable/Part

**Files:**
- Modify: `src/gui/omniPanel.ts`
- Test: `tests/omni-panel.test.ts` (erweitern)

**Interfaces:**
- Consumes: `buildOmniNrpn`, `OMNI_MODULES`, `OtpSub`, `parseFrame`.
- Produces: Param-Widgets je platziertem Modul; `change`-Handler → `buildOmniNrpn` → `sysexSenden`. Part-Select bestimmt den Ziel-Part der NRPN. Enable-Toggle nutzt pid 0x03 (Chord) bzw. 0x06 (Arp).

- [ ] **Step 1: Write the failing test**

```ts
// in tests/omni-panel.test.ts ergaenzen
import { OMNI_MODULES as MODS } from "../src/core/otp";

it("rendert Parameter-Widgets, wenn ein Modul platziert ist", async () => {
  const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 1, 0]);
  const h = { sysexSenden: vi.fn(async () => {}), sysexAnfrage: vi.fn(async () => ack), warten: vi.fn(async () => ack) };
  initOmni(h);
  (document.querySelector('#viewOmni [data-omni-laden="1"]') as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 5));
  const widgets = document.querySelectorAll('#viewOmni [data-omni-params="1"] [data-omni-pid]');
  expect(widgets.length).toBe(MODS.find((m) => m.id === 1)!.params.length);
});
it("Aenderung eines Params sendet den passenden NRPN-Callback", async () => {
  const ack = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 1, 0]);
  const h = { sysexSenden: vi.fn(async () => {}), sysexAnfrage: vi.fn(async () => ack), warten: vi.fn(async () => ack) };
  initOmni(h);
  (document.querySelector('#viewOmni [data-omni-laden="1"]') as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 5));
  h.sysexSenden.mockClear();
  const latch = document.querySelector('#viewOmni [data-omni-params="1"] [data-omni-pid="4"]') as HTMLInputElement;
  latch.checked = true; latch.dispatchEvent(new Event("change", { bubbles: true }));
  const f = h.sysexSenden.mock.calls.at(-1)![0] as Uint8Array;
  expect(f[5]).toBe(OtpSub.MODULE_CALLBACK);
  // Payload beginnt [id=1, cb=1, ...]
  expect([f[8], f[9]]).toEqual([1, 1]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/omni-panel.test.ts` → FAIL (keine Param-Widgets).

- [ ] **Step 3: Implementierung**

In `omniPanel.ts` nach erfolgreichem Laden die Params rendern und Handler binden:

```ts
import { buildOmniNrpn } from "../core/otp";

function aktuellerPart(id: number): number {
  const sel = document.querySelector(`[data-omni-part="${id}"]`) as HTMLSelectElement | null;
  return sel ? Number(sel.value) : 0;
}

function paramWidget(m: OmniModule, p: OmniParam): string {
  const key = `data-omni-modul-id="${m.id}" data-omni-pid="${p.pid}"`;
  if (p.kind === "toggle") return `<label>${p.label} <input type="checkbox" ${key}></label>`;
  if (p.kind === "enum")
    return `<label>${p.label} <select ${key}>${
      p.options!.map((o) => `<option value="${o.wert}">${o.text}</option>`).join("")
    }</select></label>`;
  if (p.kind === "part")
    return `<label>${p.label} <select ${key}>${
      Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}</option>`).join("")
    }</select></label>`;
  return `<label>${p.label} <input type="range" min="${p.min ?? 0}" max="${p.max ?? 127}" ${key}></label>`;
}

function paramsRendern(id: number): void {
  const m = OMNI_MODULES.find((x) => x.id === id);
  const host = document.querySelector(`[data-omni-params="${id}"]`);
  if (!m || !host) return;
  host.innerHTML = m.params.map((p) => paramWidget(m, p)).join("");
}

function paramGeaendert(el: HTMLInputElement | HTMLSelectElement): void {
  if (!hooks) return;
  const id = Number(el.getAttribute("data-omni-modul-id"));
  const pid = Number(el.getAttribute("data-omni-pid"));
  const m = OMNI_MODULES.find((x) => x.id === id);
  if (!m) return;
  const wert = el instanceof HTMLInputElement && el.type === "checkbox" ? (el.checked ? 1 : 0) : Number(el.value);
  void hooks.sysexSenden(buildOmniNrpn(m, aktuellerPart(id), pid, wert));
}
```

- In `modulLaden` nach `platziert.add(id)`: `paramsRendern(id);`
- In `modulEntladen`: den Params-Host leeren (`host.innerHTML = ""`).
- In `initOmni` eine `change`-Delegation:

```ts
$("viewOmni").addEventListener("change", (e) => {
  const t = e.target as HTMLElement;
  if (t.hasAttribute("data-omni-pid")) paramGeaendert(t as HTMLInputElement | HTMLSelectElement);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/omni-panel.test.ts` → PASS. `pnpm check` → gruen.

- [ ] **Step 5: Commit**

```bash
git add src/gui/omniPanel.ts tests/omni-panel.test.ts
git commit -m "feat(gui): Omni-Panel Parameter-Widgets + NRPN-Live-Konfig"
```

---

### Task 7: Periodik + "Preset laden" + "Alles aus"

**Files:**
- Modify: `src/gui/omniPanel.ts`
- Test: `tests/omni-panel.test.ts` (erweitern)

**Interfaces:**
- Consumes: `buildIrqInstall`, `buildIrqConfig`, `buildModuleUnplace`, `buildOmniNrpn`, `OMNI_MODULES`.
- Produces: `#omniPreset`-Handler (laedt Chord id9 auf Part 0, Arp id1 auf Part 2 mit Ziel Part 3, konfiguriert wie `multi-module.mjs`, installiert Periodik), `#omniAus`-Handler (unplace alle).

- [ ] **Step 1: Write the failing test**

```ts
// in tests/omni-panel.test.ts ergaenzen
import { OtpCmd as C, OtpSub as S } from "../src/core/otp";

it("Preset installiert die Periodik (IRQ 21) mit den Skript-Bytes", async () => {
  const ack = buildFrame(C.MODULE, S.MODULE_ACK, [0x00, 0, 0]);
  const h = { sysexSenden: vi.fn(async () => {}), sysexAnfrage: vi.fn(async () => ack), warten: vi.fn(async () => ack) };
  initOmni(h);
  (document.getElementById("omniPreset") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 20));
  const irqInstall = h.sysexSenden.mock.calls.map((c) => c[0] as Uint8Array)
    .find((f) => f[4] === C.IRQ_HOOK && f[5] === S.IRQ_INSTALL);
  expect(irqInstall).toBeDefined();
  // Payload == [21, 0,0, 0,21, 1]
  expect(Array.from(irqInstall!.slice(8, 14))).toEqual([21, 0, 0, 0, 21, 1]);
});
it("Alles aus sendet Unplace 0x7F", async () => {
  const h = { sysexSenden: vi.fn(async () => {}), sysexAnfrage: vi.fn(async () => new Uint8Array()), warten: vi.fn(async () => null) };
  initOmni(h);
  (document.getElementById("omniAus") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 5));
  const f = h.sysexSenden.mock.calls.map((c) => c[0] as Uint8Array).find((x) => x[5] === S.MODULE_UNPLACE);
  expect(f && f[8]).toBe(0x7f);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/omni-panel.test.ts` → FAIL (Preset/Aus tun nichts).

- [ ] **Step 3: Implementierung**

```ts
import { buildIrqInstall, buildIrqConfig } from "../core/otp";

async function periodikInstallieren(): Promise<void> {
  if (!hooks) return;
  await hooks.sysexSenden(buildIrqInstall(21, 0, 21, 1)); // == multi-module.mjs cmd04(0x02,[21,0,0,0,21,1])
  await hooks.sysexSenden(buildIrqConfig(0, 21, 1));       // == cmd04(0x05,[0,0,0,21,1])
}

async function presetLaden(): Promise<void> {
  const chord = OMNI_MODULES.find((m) => m.id === 9)!;
  const arp = OMNI_MODULES.find((m) => m.id === 1)!;
  await modulLaden(9);
  await modulLaden(1);
  if (!hooks) return;
  // Chord auf Part 1 (0): Dur, root=gespielt, stagger 0, aktiv
  await hooks.sysexSenden(buildOmniNrpn(chord, 0, 0x00, 0));
  await hooks.sysexSenden(buildOmniNrpn(chord, 0, 0x02, 200));
  await hooks.sysexSenden(buildOmniNrpn(chord, 0, 0x01, 0));
  await hooks.sysexSenden(buildOmniNrpn(chord, 0, 0x03, 1));
  // Arp nur auf ch2 (Part 3), Ziel Part 4 (3), Enable je Kanal
  for (let ch = 0; ch < 16; ch++) await hooks.sysexSenden(buildOmniNrpn(arp, ch, 0x06, ch === 2 ? 1 : 0));
  await hooks.sysexSenden(buildOmniNrpn(arp, 2, 0x05, 3));
  await periodikInstallieren();
  statusSetzen("Preset geladen (Chord P1 + Arp P3-4)");
}

async function allesAus(): Promise<void> {
  if (!hooks) return;
  await hooks.sysexSenden(buildModuleUnplace("alle"));
  platziert.clear();
  ledAktualisieren();
  statusSetzen("alle Module entladen");
}
```

Und in `initOmni` die Buttons binden (in der `click`-Delegation ergaenzen):

```ts
if (t.id === "omniPreset") { void presetLaden(); return; }
if (t.id === "omniAus") { void allesAus(); return; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/omni-panel.test.ts` → PASS. `pnpm check` → gruen.

- [ ] **Step 5: Commit**

```bash
git add src/gui/omniPanel.ts tests/omni-panel.test.ts
git commit -m "feat(gui): Omni-Panel Preset laden + Alles aus + Periodik"
```

---

### Task 8: Status-Poller (Telemetrie + Peek)

**Files:**
- Modify: `src/gui/omniPanel.ts`
- Test: `tests/omni-panel.test.ts` (erweitern)

**Interfaces:**
- Consumes: `buildIrqStatus`, `parseIrqReport`, `istOtpAntwort`, `OtpCmd`, `OtpSub`, `buildPeek`, `istPeekAntwort`, `peekU32`.
- Produces: `#omniStatusPoll`-Toggle; bei aktiv alle ~1 s `buildIrqStatus` (egress/ticks) + `buildPeek(0xC2200084,4)` (placed_mask) lesen und in `#omniStatus` zeigen. Poller stoppt beim Tab-Verlassen (`omniWirdVerlassen()` exportieren, in main.ts `switchTab` einhaengen wie `stemWerkbankVerlassen`).

- [ ] **Step 1: Write the failing test**

```ts
// in tests/omni-panel.test.ts ergaenzen
import { buildFrame as bf, OtpCmd as CC, OtpSub as SS } from "../src/core/otp";

it("Status-Poll fragt IRQ-Status und Pey-Peek ab", async () => {
  // IRQ-Status-Report mit 13 u32 (placeholder 0)
  const werte = new Array(13).fill(0);
  const payload = [SS.IRQ_STATUS, ...werte.flatMap(() => [0, 0, 0, 0, 0])];
  const report = bf(CC.IRQ_HOOK, SS.IRQ_REPORT, payload);
  const h = {
    sysexSenden: vi.fn(async () => {}),
    sysexAnfrage: vi.fn(async (f: Uint8Array) => (f[4] === 0x52 ? Uint8Array.of(0xf0,0x7d,0x01,0x02,0x52,0,0,0,0,0,0xf7) : report)),
    warten: vi.fn(async () => null),
  };
  initOmni(h);
  await (await import("../src/gui/omniPanel")).omniStatusEinmal();
  expect(h.sysexAnfrage).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/omni-panel.test.ts` → FAIL (`omniStatusEinmal` fehlt).

- [ ] **Step 3: Implementierung**

```ts
import { buildIrqStatus, parseIrqReport, buildPeek, istPeekAntwort, peekU32 } from "../core/otp";

let pollTimer: ReturnType<typeof setInterval> | null = null;

export async function omniStatusEinmal(): Promise<void> {
  if (!hooks) return;
  try {
    const rep = await hooks.sysexAnfrage(
      buildIrqStatus(),
      (r) => istOtpAntwort(r, OtpCmd.IRQ_HOOK, OtpSub.IRQ_REPORT), 1200,
    );
    const info = parseIrqReport(parseFramePayload(rep));
    const placedRaw = await hooks.sysexAnfrage(buildPeek(0xc2200084, 4), istPeekAntwort, 1200);
    const placed = peekU32(placedRaw) ?? 0;
    const egress = info?.status?.egressFrames ?? 0;
    statusSetzen(`placed_mask=0x${placed.toString(16)}  egress=${egress}  ticks=${info?.status?.ticks ?? 0}`);
  } catch {
    statusSetzen("Status: keine Antwort");
  }
}

export function omniStatusStart(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void omniStatusEinmal(), 1000);
}
export function omniWirdVerlassen(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
```

- In `initOmni` einen Toggle-Button `#omniStatusPoll` in die Kopfleiste aufnehmen; Klick ruft `omniStatusStart()`/`omniWirdVerlassen()` wechselweise.
- In `src/gui/main.ts` `switchTab`: analog zu `stemWerkbankVerlassen` `omniWirdVerlassen()` aufrufen, wenn man den Omni-Tab verlaesst; Import ergaenzen.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/omni-panel.test.ts` → PASS. `pnpm check` → gruen. `pnpm build:gui` fehlerfrei.

- [ ] **Step 5: Commit**

```bash
git add src/gui/omniPanel.ts src/gui/main.ts tests/omni-panel.test.ts
git commit -m "feat(gui): Omni-Panel Status-Poller (IRQ-Status + placed_mask-Peek)"
```

---

## Manueller Geraetetest (nach Task 8)

Voraussetzung: Firmware mit STAGE2_EXEC + Hooks am Geraet (z.B. `multimodule_sprint188`, KEIN Autoconfig), Geraet als einziger MIDI-Client.
1. App starten (`pnpm desktop`), MIDI zur Electribe verbinden, Omnitribe-Tab oeffnen.
2. "Preset laden" → auf Part 1 Dur-Dreiklang spielen; auf Part 3 Note halten → Arp auf Part 4. Status-Poll zeigt placed_mask mit Bit 1+9, egress steigt.
3. Arp-Karte: "Aktiv" (pid 0x06) aus → Arp verstummt sofort, bleibt geladen. Wieder an → laeuft.
4. "Alles aus" → Geraet spielt wieder normal (auch Sequencer-Pattern ungestoert).
5. Parameter live aendern (Chord-Typ, Arp-Rate/Latch/Ziel-Part) und hoerbar pruefen.

## Self-Review (durchgefuehrt)
- **Spec-Abdeckung:** Register (T2), Bundle (T3), Tab (T4), Laden/Entladen (T5), Konfig/Enable (T6), Preset/Aus/Periodik (T7), Status/Peek (T1+T8) — alle Spec-Abschnitte haben eine Task. An/Aus zweistufig: Enable-NRPN (T6) + unplace (T7).
- **Byte-Abgleich:** buildIrqInstall(21,0,21,1)=[21,0,0,0,21,1], buildIrqConfig(0,21,1)=[0,0,0,21,1], buildOmniNrpn→[id,1,kopf,msb,lsb,lo,hi] — exakt die Skript-Bytes; in T2/T7 als Test fixiert.
- **Typkonsistenz:** `OmniHooks` (T4) einheitlich in T5-T8; `platziert`-Set gekapselt; `parseFramePayload` in T5 definiert und in T8 wiederverwendet.
- **Offen/Risiko:** `.bin`-Bundle muss bei Modul-Aenderungen via `bundle-omni-modules.mjs` neu erzeugt werden (Hinweis in README/CLAUDE.md aufnehmen — kleiner Zusatzschritt in T3-Commit optional).
