/**
 * Mute-Übertragung + korrigierte Volume/Pan-Offsets (0x18/0x19 signed) +
 * SysEx-ACK-Parsing für den bestätigungsbasierten Slot-/Bulk-Transfer.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createProject,
  buildPatternFile,
  buildBankFiles,
  importE2Patterns,
  serializeProject,
  deserializeProject,
} from "../src/core/editorModel";
import { parseElectribeBank } from "../src/core/electribeImport";
import { parseAck, E2_ACK_OK, E2_ACK_ERROR, E2_MSG } from "../src/core/e2sysex";

describe("Mute + Volume/Pan — Editor ↔ Geräteformat", () => {
  it("mutes survive the full round-trip through .e2sallpat", () => {
    const project = createProject();
    const p = project.patterns[0];
    p.name = "MUTETEST";
    p.parts[0].steps[0].on = true;
    p.parts[0].muted = true; // Kick stumm
    p.parts[3].steps[0].on = true; // Clap hörbar
    p.parts[5].muted = true; // HiHat op stumm (ohne Steps)
    const { allpat } = buildBankFiles(project);
    const re = importE2Patterns(allpat).patterns[0];
    expect(re.parts[0].muted).toBe(true);
    expect(re.parts[3].muted ?? false).toBe(false);
    expect(re.parts[5].muted).toBe(true);
  });

  it("mute lands at part+0x01 in the single .e2spat", () => {
    const project = createProject();
    const p = project.patterns[0];
    p.parts[2].muted = true;
    const file = buildPatternFile(p);
    const partStart = 0x100 + 0x800 + 2 * 0x330;
    expect(file[partStart + 0x01]).toBe(1);
    expect(file[0x100 + 0x800 + 0x01]).toBe(0); // Part 1 nicht gemutet
  });

  it("volume/pan round-trip via 0x18/0x19 (signed pan)", () => {
    const project = createProject();
    const p = project.patterns[0];
    p.parts[0].volume = 90;
    p.parts[0].pan = 20; // links (-44)
    p.parts[1].volume = 127;
    p.parts[1].pan = 110; // rechts (+46)
    const { allpat } = buildBankFiles(project);
    const re = importE2Patterns(allpat).patterns[0];
    expect(re.parts[0].volume).toBe(90);
    expect(re.parts[0].pan).toBe(20);
    expect(re.parts[1].volume).toBe(127);
    expect(re.parts[1].pan).toBe(110);
  });

  it("mutes survive project save/load", () => {
    const project = createProject();
    project.patterns[0].parts[7].muted = true;
    const restored = deserializeProject(serializeProject(project));
    expect(restored.patterns[0].parts[7].muted).toBe(true);
  });
});

const GOLDEN = path.resolve(process.cwd(), "examples", "golden", "245_BodyTalk1.e2spat");
(fs.existsSync(GOLDEN) ? describe : describe.skip)("Mute/Pan — Factory-Fidelity", () => {
  it("BodyTalk1 mute/vol/pan bytes stay byte-identical on unchanged re-export", () => {
    const orig = new Uint8Array(fs.readFileSync(GOLDEN));
    const p = importE2Patterns(orig).patterns[0];
    const origBody = orig.slice(0x100);
    const outBody = buildPatternFile(p).slice(0x100);
    for (let part = 0; part < 16; part++) {
      const ps = 0x800 + part * 0x330;
      expect(outBody[ps + 0x01]).toBe(origBody[ps + 0x01]); // mute
      expect(outBody[ps + 0x18]).toBe(origBody[ps + 0x18]); // ampLevel
      expect(outBody[ps + 0x19]).toBe(origBody[ps + 0x19]); // ampPan signed
    }
  });

  it("parses factory pan values into the editor 0..127 range", () => {
    const bank = parseElectribeBank(new Uint8Array(fs.readFileSync(GOLDEN)));
    for (const part of bank.patterns[0].parts) {
      expect(part.pan).toBeGreaterThanOrEqual(0);
      expect(part.pan).toBeLessThanOrEqual(127);
      expect(part.volume).toBeLessThanOrEqual(127);
    }
  });
});

describe("SysEx-ACK-Parsing (Slot-/Bulk-Bestätigung)", () => {
  const frame = (msgId: number) =>
    Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, msgId, 0xf7]);

  it("recognizes write-complete and data-load-complete as OK", () => {
    expect(parseAck(frame(E2_MSG.writeComplete))).toBe(0x21);
    expect(E2_ACK_OK.has(parseAck(frame(E2_MSG.writeComplete))!)).toBe(true);
    expect(E2_ACK_OK.has(parseAck(frame(E2_MSG.dataLoadComplete))!)).toBe(true);
  });

  it("recognizes error acks", () => {
    for (const id of [E2_MSG.writeError, E2_MSG.dataLoadError, E2_MSG.dataFormatError]) {
      expect(E2_ACK_ERROR.has(parseAck(frame(id))!)).toBe(true);
    }
  });

  it("accepts any global channel nibble (0x30..0x3F)", () => {
    const f = Uint8Array.from([0xf0, 0x42, 0x35, 0x00, 0x01, 0x24, 0x21, 0xf7]);
    expect(parseAck(f)).toBe(0x21);
  });

  it("rejects foreign frames", () => {
    expect(parseAck(Uint8Array.from([0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7]))).toBeNull();
    expect(parseAck(Uint8Array.from([0xf0, 0x42, 0x50, 0x01, 0x00, 0x00, 0x24, 0xf7]))).toBeNull();
  });
});
