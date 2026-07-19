/**
 * midi.ts — Web-MIDI-Wrapper für den Pattern-Transfer zum/vom Electribe 2.
 *
 * Nutzt die Web MIDI API (in der Electron-Shell + Chromium verfügbar; im
 * file://-Browser ggf. nicht — dann graceful "nicht verfügbar"). SysEx-Frames
 * (F0…F7) werden reassembliert und an onSysex geliefert.
 */

// Web MIDI-Typen (MIDIAccess, MIDIInput, MIDIOutput …) kommen aus der DOM-lib.
type NavMidi = Navigator & {
  requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MIDIAccess>;
};

export interface PortInfo {
  id: string;
  label: string;
}

export class MidiIO {
  private access: MIDIAccess | null = null;
  private outId: string | null = null;
  private inId: string | null = null;
  private rxBuffer: number[] = [];
  private inSysex = false;

  /** Callback für vollständige SysEx-Frames (F0…F7). */
  onSysex: ((bytes: Uint8Array) => void) | null = null;
  /** Callback bei Port-Änderungen (an-/abgesteckt). */
  onPortsChanged: (() => void) | null = null;

  get available(): boolean {
    return typeof (navigator as NavMidi).requestMIDIAccess === "function";
  }

  get ready(): boolean {
    return this.access !== null;
  }

  /** Fordert MIDI-Zugriff inkl. SysEx an. Muss aus einem User-Gesture kommen. */
  async enable(): Promise<void> {
    const nav = navigator as NavMidi;
    if (!nav.requestMIDIAccess) throw new Error("Web MIDI in dieser Umgebung nicht verfügbar.");
    this.access = await nav.requestMIDIAccess({ sysex: true });
    this.access.onstatechange = () => this.onPortsChanged?.();
    // Erste Ports vorwählen
    const outs = this.outputs();
    const ins = this.inputs();
    if (!this.outId && outs[0]) this.outId = outs[0].id;
    if (!this.inId && ins[0]) this.inId = ins[0].id;
    this.attachInput();
  }

  outputs(): PortInfo[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map((p) => ({ id: p.id, label: portLabel(p) }));
  }
  inputs(): PortInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((p) => ({ id: p.id, label: portLabel(p) }));
  }

  selectOutput(id: string): void {
    this.outId = id;
  }
  selectInput(id: string): void {
    this.inId = id;
    this.attachInput();
  }
  get selectedOutput(): string | null {
    return this.outId;
  }
  get selectedInput(): string | null {
    return this.inId;
  }

  /** Sendet rohe Bytes (typisch ein kompletter SysEx-Frame) an den Out-Port. */
  send(bytes: Uint8Array): void {
    if (!this.access) throw new Error("MIDI nicht aktiviert.");
    if (!this.outId) throw new Error("Kein MIDI-Ausgang gewählt.");
    const out = this.access.outputs.get(this.outId);
    if (!out) throw new Error("MIDI-Ausgang nicht mehr verfügbar.");
    out.send(bytes);
  }

  private attachInput(): void {
    if (!this.access) return;
    for (const inp of this.access.inputs.values()) inp.onmidimessage = null;
    if (!this.inId) return;
    const inp = this.access.inputs.get(this.inId);
    if (!inp) return;
    inp.onmidimessage = (e) => {
      if (e.data) this.rx(e.data);
    };
  }

  /** SysEx-Reassembly: sammelt Bytes zwischen F0 und F7. */
  private rx(data: Uint8Array): void {
    for (const byte of data) {
      if (byte === 0xf0) {
        this.inSysex = true;
        this.rxBuffer = [0xf0];
      } else if (this.inSysex) {
        this.rxBuffer.push(byte);
        if (byte === 0xf7) {
          this.inSysex = false;
          this.onSysex?.(Uint8Array.from(this.rxBuffer));
          this.rxBuffer = [];
        }
      }
    }
  }
}

function portLabel(p: MIDIPort): string {
  const name = p.name ?? "MIDI-Port";
  return p.manufacturer && !name.includes(p.manufacturer) ? `${p.manufacturer} ${name}` : name;
}

/**
 * Sendet einen Request und wartet (mit Timeout) auf die erste SysEx-Antwort,
 * die `match` erfüllt. Nützlich für Device-Search + Pattern-Holen.
 */
export function requestSysex(
  io: MidiIO,
  request: Uint8Array,
  match: (bytes: Uint8Array) => boolean,
  timeoutMs = 1500,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const prev = io.onSysex;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      io.onSysex = prev;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("Keine Antwort vom Gerät (Timeout)."))),
      timeoutMs,
    );
    io.onSysex = (bytes) => {
      prev?.(bytes);
      if (match(bytes)) finish(() => resolve(bytes));
    };
    try {
      io.send(request);
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}
