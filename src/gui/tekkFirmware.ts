/**
 * tekkFirmware — die Firmware-Ablage der Werkbank (firmwareAblage.ts).
 *
 * Desktop-App: der Ordner `userData/firmware` ueber die Bruecke in
 * preload.cjs — der Nutzer legt dort die offiziellen SYSTEM.VSB (Synth und
 * Sampler v2.02) und `hacktribe-2.patch` ab; die App liest, hasht und ordnet
 * ein. Browser: es gibt keinen Ordner — Dateien werden ueber ein Datei-Feld
 * fuer die Sitzung gehalten (die Oberflaeche sagt das). Beide Wege liefern
 * dieselbe Liste {name, groesse, sha256, bytes}.
 */

export interface TekkFirmwareBruecke {
  available: boolean;
  ordner(): Promise<string>;
  ordnerOeffnen(): Promise<string>;
  liste(): Promise<{ name: string; groesse: number; sha256: string; wann: number }[]>;
  lesen(name: string): Promise<Uint8Array | null>;
  ablegen(name: string, bytes: Uint8Array): Promise<{ pfad: string; bytes: number }>;
}

export interface AblageEintrag {
  name: string;
  groesse: number;
  sha256: string;
  bytes: Uint8Array;
}

export interface FirmwareAblageZugang {
  wo: "ordner" | "sitzung";
  /** Pfad des Ordners (Desktop) oder "" (Browser). */
  pfad(): Promise<string>;
  oeffnen?(): Promise<void>;
  /** Alle Dateien mit Inhalt und Hash. */
  lesen(): Promise<AblageEintrag[]>;
  /** Datei ablegen (Desktop: in den Ordner; Browser: in die Sitzung). */
  ablegen(name: string, bytes: Uint8Array, sha256: string): Promise<string | null>;
}

function bruecke(): TekkFirmwareBruecke | undefined {
  const w = globalThis as unknown as { tekkFirmware?: TekkFirmwareBruecke };
  return w.tekkFirmware?.available ? w.tekkFirmware : undefined;
}

const sitzung = new Map<string, AblageEintrag>();

/** Fuer den Browser: eine gewaehlte Datei in die Sitzungs-Ablage legen. */
export function sitzungsAblageAufnehmen(e: AblageEintrag): void {
  sitzung.set(e.name, e);
}

export function firmwareAblageZugang(): FirmwareAblageZugang {
  const b = bruecke();
  if (b) {
    return {
      wo: "ordner",
      pfad: () => b.ordner(),
      oeffnen: async () => {
        await b.ordnerOeffnen();
      },
      lesen: async () => {
        const liste = await b.liste();
        const out: AblageEintrag[] = [];
        for (const d of liste) {
          const bytes = await b.lesen(d.name);
          if (bytes) out.push({ name: d.name, groesse: d.groesse, sha256: d.sha256.toLowerCase(), bytes });
        }
        return out;
      },
      ablegen: async (name, bytes) => (await b.ablegen(name, bytes)).pfad,
    };
  }
  return {
    wo: "sitzung",
    pfad: async () => "",
    lesen: async () => [...sitzung.values()],
    ablegen: async (name, bytes, sha256) => {
      sitzung.set(name, { name, groesse: bytes.length, sha256, bytes });
      return null;
    },
  };
}
