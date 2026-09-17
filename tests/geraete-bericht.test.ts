/** tests/geraete-bericht.test.ts — der Gerätebericht über Nachbau-Leser aus dem echten Dump. */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { erstelleGeraeteBericht } from "../src/core/geraeteBericht";

const pfad = "G:/Downloads/TekkForge/Firmware/Flash-vom-Geraet-2026-09-16.bin";

describe("erstelleGeraeteBericht", () => {
  it("bricht bei Lesefehlern nicht ab, sondern schreibt sie in den Text", async () => {
    const kaputt = async () => ({ ok: false as const, reason: "Timeout" });
    const r = await erstelleGeraeteBericht({ lesenFlash: kaputt, chunk: 0x100 }, "2026-09-17 01:00");
    const t = r.zeilen.join("\n");
    expect(t).toMatch(/^# Gerätebericht — 2026-09-17 01:00/);
    expect(t).toMatch(/Global nicht lesbar: Global 0x230000: Timeout/);
    expect(t).toMatch(/Pattern-Bank nicht lesbar/);
    expect(t).toMatch(/Slice-Region nicht lesbar/);
    expect(r.patternBank).toBeNull();
  });
  it.skipIf(!existsSync(pfad))("aus dem echten Dump: Kennungen, Global, Werksbank-Abweichungen, Slices", async () => {
    const d = new Uint8Array(readFileSync(pfad));
    const lesenFlash = async (addr: number, len: number) => ({ ok: true as const, bytes: d.slice(addr, addr + len) });
    const schritte: string[] = [];
    const r = await erstelleGeraeteBericht({ lesenFlash, chunk: 0x400, fortschritt: (s) => schritte.push(s), globalLive: async () => d.slice(0x230000, 0x230100) }, "2026-09-17 01:00");
    const t = r.zeilen.join("\n");
    expect(t).toMatch(/Gerätestempel .*„ele2sUSR“/);
    expect(t).toMatch(/Global gespeichert \(0x230000\): MIDI-Kanal 1, Clock-Quelle auto/);
    expect(t).toMatch(/Laufender Global-Block \(SysEx 0x51\): identisch/);
    expect(t).toMatch(/250 von 250 Slots mit Pattern/);
    expect(t).toMatch(/im Flash weichen 7 Records ab/);
    expect(t).toMatch(/- Pattern 1: im Gerät „Mfmt Pattern“, im Werk „Advi\$ory1“/);
    expect(t).toMatch(/Pattern 240: im Gerät „Init Pattern“ \(Inhalt geändert, Name gleich\)/);
    expect(t).toMatch(/404 von 540 Records beschrieben/);
    expect(t).toMatch(/Sample 337: 8 Slices, 32 Schritte, Beat 0/);
    expect(schritte).toEqual(["Kennungen", "Global", "Pattern-Bank (4 MiB)", "Slices"]);
    expect(r.patternBank?.length).toBe(4161792);
    expect(t).not.toMatch(/Stimmen, Ereignisse/);
  });
});
