/**
 * nrpnEmpfang — NRPN-Nachrichten des Geraets lesen (Gegenstueck zu
 * `hacktribeNrpn`, das sie baut).
 *
 * Hacktribe **meldet jeden Griff am Geraet** als NRPN: welcher Pad-Modus aktiv
 * ist, welches Bedienelement bewegt wurde und wohin. Damit laesst sich der
 * Zustand des Geraets am Rechner spiegeln, statt ihn zu erraten.
 *
 * Quelle der Tabellen: Hacktribe-Wiki `MIDI.md` (Abschnitt „Panel Control").
 * Aufbau einer Meldung:
 *
 * | CC   | Inhalt                                              |
 * |------|-----------------------------------------------------|
 * | 0x63 | Kategorie (0x00 = Panel)                            |
 * | 0x62 | Pad-Modus                                           |
 * | 0x06 | Bedienelement als [Kategorie:Index]                  |
 * | 0x26 | Wert — bei Knoepfen 0x00 oder 0x7F                   |
 * | 0x60 / 0x61 | Encoder: eins hoch bzw. eins runter          |
 *
 * ⚠ **Zustandsbehaftet.** Sind Modus und Bedienelement einmal gewaehlt, schickt
 * das Geraet bei weiteren Aenderungen **nur noch den Wert** (CC 0x26). Wer
 * jede Meldung fuer sich liest, verliert ab der zweiten den Bezug — deshalb
 * merkt sich der Leser den letzten Stand je Kanal.
 *
 * ⚠ Die Meldungen kommen nur, wenn am Geraet die versteckte Einstellung
 * „NRPN-Ausgabe" aktiv ist (siehe `fxLive.ts`). Deren Byte-Index ist bisher
 * nirgends veroeffentlicht.
 */

/** Pad-Modi, die als NRPN-LSB ankommen. */
export const PAD_MODI: Record<number, string> = {
  0x00: "Part Mute",
  0x01: "Part Solo",
  0x02: "Part Erase",
  0x03: "Trigger",
  0x04: "Sequencer",
  0x05: "Keyboard",
  0x06: "Chord",
  0x07: "Step Jump",
  0x08: "Pattern Assign",
  0x09: "Pattern Set",
};

/**
 * Bedienelemente als [Kategorie:Index] im DATA-MSB. Die Luecken sind echt —
 * das Geraet vergibt nicht jede Nummer.
 */
export const PANEL_KONTROLLEN: Record<number, string> = {
  // Transport und Navigation (Kategorie 0x0)
  0x00: "Rec", 0x01: "Stop", 0x02: "Play/Pause", 0x03: "Tap",
  0x04: "Gate Arp", 0x05: "Touch Scale", 0x06: "Master FX", 0x07: "MFX Hold",
  0x08: "Back", 0x09: "Menu", 0x0a: "Shift", 0x0b: "Links",
  0x0c: "Vor", 0x0d: "Exit", 0x0e: "Write", 0x0f: "Rechts",
  // Pad-Modus-Knoepfe (Kategorie 0x1)
  0x10: "Part Mute", 0x11: "Part Erase", 0x13: "Trigger", 0x15: "Sequencer",
  0x17: "Keyboard", 0x18: "Chord", 0x19: "Step Jump", 0x1b: "Pattern Set",
  // Knoepfe (Kategorie 0x3)
  0x30: "Amp EG", 0x31: "IFX On", 0x32: "LPF", 0x34: "HPF", 0x36: "BPF",
  0x3a: "MFX Send", 0x3c: "B1", 0x3d: "B2", 0x3e: "B3", 0x3f: "B4",
  // Encoder (Kategorie 0x4)
  0x40: "Haupt-Regler", 0x41: "Osc-Regler", 0x42: "Filter-Regler",
  0x43: "Modulation-Regler", 0x44: "IFX-Regler",
};

export const NRPN_KATEGORIEN: Record<number, string> = {
  0x00: "Panel",
  0x01: "FX-Parameter",
  0x02: "FX-Zuordnung",
  0x03: "Global",
  0x09: "Sequenz-Step",
};

export function kontrollName(kontrolle: number): string {
  return PANEL_KONTROLLEN[kontrolle] ?? `unbekannt (0x${kontrolle.toString(16).padStart(2, "0")})`;
}

export interface NrpnEreignis {
  kanal: number;
  kategorie: number;
  kategorieName: string;
  /** NRPN-LSB — bei Panel-Meldungen der Pad-Modus, sonst z. B. ein FX-Slot. */
  padModus: number;
  padModusName: string;
  /** DATA-MSB — bei Panel-Meldungen das Bedienelement. */
  kontrolle: number;
  name: string;
  wert: number;
  /** Knoepfe: true ab Wert 0x40 (das Geraet schickt 0x00 oder 0x7F). */
  gedrueckt: boolean;
  /** Encoder: +1 hoch, −1 runter, sonst 0. */
  richtung: number;
}

const CC = { msb: 0x63, lsb: 0x62, dataMsb: 0x06, dataLsb: 0x26, inc: 0x60, dec: 0x61 } as const;

interface Stand {
  kategorie: number;
  padModus: number;
  kontrolle: number;
}

/**
 * Liest einen Strom von MIDI-Nachrichten und gibt fertige NRPN-Ereignisse
 * zurueck. Je Kanal ein eigener Stand — das Geraet nutzt den Kanal fuer den
 * aktiven Part.
 */
export class NrpnLeser {
  private stand = new Map<number, Stand>();

  /** Eine MIDI-Nachricht einwerfen; null, wenn sie kein Ereignis abschliesst. */
  nimm(bytes: readonly number[]): NrpnEreignis | null {
    if (bytes.length < 3 || (bytes[0] & 0xf0) !== 0xb0) return null;
    const kanal = bytes[0] & 0x0f;
    const cc = bytes[1];
    const wert = bytes[2];
    const s = this.stand.get(kanal) ?? { kategorie: -1, padModus: -1, kontrolle: -1 };
    switch (cc) {
      case CC.msb:
        this.stand.set(kanal, { ...s, kategorie: wert });
        return null;
      case CC.lsb:
        this.stand.set(kanal, { ...s, padModus: wert });
        return null;
      case CC.dataMsb:
        this.stand.set(kanal, { ...s, kontrolle: wert });
        return null;
      case CC.dataLsb:
        return s.kategorie < 0 ? null : this.ereignis(kanal, s, wert, 0);
      case CC.inc:
        return s.kategorie < 0 ? null : this.ereignis(kanal, s, wert, 1);
      case CC.dec:
        return s.kategorie < 0 ? null : this.ereignis(kanal, s, wert, -1);
      default:
        return null;
    }
  }

  private ereignis(kanal: number, s: Stand, wert: number, richtung: number): NrpnEreignis {
    const panel = s.kategorie === 0x00;
    return {
      kanal,
      kategorie: s.kategorie,
      kategorieName: NRPN_KATEGORIEN[s.kategorie] ?? `0x${s.kategorie.toString(16)}`,
      padModus: s.padModus,
      padModusName: panel ? (PAD_MODI[s.padModus] ?? `Modus 0x${s.padModus.toString(16)}`) : String(s.padModus),
      kontrolle: s.kontrolle,
      name: panel ? kontrollName(s.kontrolle) : `Index ${s.kontrolle}`,
      wert,
      gedrueckt: wert >= 0x40,
      richtung,
    };
  }

  /** Gemerkten Stand verwerfen (z. B. nach einem Portwechsel). */
  zuruecksetzen(): void {
    this.stand.clear();
  }
}
