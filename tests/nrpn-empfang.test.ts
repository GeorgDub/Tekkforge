import { describe, it, expect } from "vitest";
import { NrpnLeser, PANEL_KONTROLLEN, PAD_MODI, kontrollName } from "../src/core/nrpnEmpfang";

/** Vier CC-Nachrichten einer vollstaendigen NRPN-Folge auf Kanal `ch`. */
function folge(ch: number, msb: number, lsb: number, dataMsb: number, dataLsb: number): number[][] {
  return [
    [0xb0 | ch, 0x63, msb],
    [0xb0 | ch, 0x62, lsb],
    [0xb0 | ch, 0x06, dataMsb],
    [0xb0 | ch, 0x26, dataLsb],
  ];
}

describe("NrpnLeser", () => {
  it("liest den Shift-Knopf aus dem Beispiel des Wikis", () => {
    // Wiki MIDI.md: Kanal 4, Keyboard-Modus (0x05), Shift (0x0a), gedrueckt (0x7f)
    const leser = new NrpnLeser();
    const treffer = folge(4, 0x00, 0x05, 0x0a, 0x7f).map((m) => leser.nimm(m)).filter(Boolean);
    expect(treffer).toHaveLength(1);
    const e = treffer[0]!;
    expect(e.kategorie).toBe(0x00);
    expect(e.padModus).toBe(0x05);
    expect(e.padModusName).toBe("Keyboard");
    expect(e.kontrolle).toBe(0x0a);
    expect(e.name).toBe("Shift");
    expect(e.wert).toBe(0x7f);
    expect(e.kanal).toBe(4);
    expect(e.gedrueckt).toBe(true);
  });

  it("Folgeaenderungen kommen nur als DATA-LSB und behalten den Zustand", () => {
    const leser = new NrpnLeser();
    folge(4, 0x00, 0x05, 0x0a, 0x7f).forEach((m) => leser.nimm(m));
    // Loslassen sendet laut Wiki nur noch DATA-LSB
    const e = leser.nimm([0xb4, 0x26, 0x00]);
    expect(e).not.toBeNull();
    expect(e!.name).toBe("Shift");
    expect(e!.wert).toBe(0);
    expect(e!.gedrueckt).toBe(false);
  });

  it("Encoder melden sich ueber Increment und Decrement", () => {
    const leser = new NrpnLeser();
    folge(0, 0x00, 0x04, 0x42, 0).forEach((m) => leser.nimm(m));
    const auf = leser.nimm([0xb0, 0x60, 0x01]);
    expect(auf!.name).toBe("Filter-Regler");
    expect(auf!.richtung).toBe(1);
    const ab = leser.nimm([0xb0, 0x61, 0x01]);
    expect(ab!.richtung).toBe(-1);
  });

  it("ignoriert alles, was keine NRPN-Nachricht ist", () => {
    const leser = new NrpnLeser();
    expect(leser.nimm([0x90, 60, 100])).toBeNull(); // Note On
    expect(leser.nimm([0xb0, 0x07, 100])).toBeNull(); // gewoehnlicher CC
    expect(leser.nimm([0xf0, 0x42])).toBeNull(); // SysEx-Anfang
  });

  it("kennt die Bedienelemente aus dem Wiki", () => {
    expect(kontrollName(0x00)).toBe("Rec");
    expect(kontrollName(0x02)).toBe("Play/Pause");
    expect(kontrollName(0x0e)).toBe("Write");
    expect(kontrollName(0x31)).toBe("IFX On");
    expect(kontrollName(0x3f)).toBe("B4");
    expect(kontrollName(0x44)).toBe("IFX-Regler");
    // Unbekannte Kennung wird als solche gemeldet, nicht erfunden
    expect(kontrollName(0x7f)).toMatch(/unbekannt/i);
    expect(PANEL_KONTROLLEN[0x0a]).toBe("Shift");
    expect(PAD_MODI[0x09]).toBe("Pattern Set");
  });

  it("meldet auch Kategorien, die das Geraet nicht als Panel schickt", () => {
    const leser = new NrpnLeser();
    // Kategorie 1 = FX-Parameter; kommt normal nur vom Host, aber der Leser
    // soll nichts verschlucken, wenn das Geraet doch etwas schickt
    const e = folge(0, 0x01, 0x04, 0x02, 99).map((m) => leser.nimm(m)).filter(Boolean)[0];
    expect(e!.kategorie).toBe(0x01);
    expect(e!.kategorieName).toMatch(/FX/);
    expect(e!.wert).toBe(99);
  });
});
