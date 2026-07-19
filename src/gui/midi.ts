/**
 * midi.ts — MIDI-Wrapper für den Pattern-Transfer zum/vom Electribe 2.
 *
 * Nutzt die native MIDI-Bridge (window.tekkMidi, bereitgestellt vom Electron-
 * Preload). Web MIDI wird NICHT verwendet, weil requestMIDIAccess in Electron
 * auf Windows hängt. Ohne Bridge (reiner Browser) ist MIDI nicht verfügbar.
 * SysEx-Frames (F0…F7) werden reassembliert und an onSysex geliefert.
 */

interface TekkMidiBridge {
  available: boolean;
  list(): Promise<{ outputs: PortInfo[]; inputs: PortInfo[] }>;
  selectOut(id: string): Promise<boolean>;
  selectIn(id: string): Promise<boolean>;
  send(bytes: number[]): Promise<boolean>;
  onMessage(cb: (bytes: number[]) => void): () => void;
}

declare global {
  interface Window {
    tekkMidi?: TekkMidiBridge;
  }
}

export interface PortInfo {
  id: string;
  label?: string;
  name?: string;
}

function bridge(): TekkMidiBridge | undefined {
  return typeof window !== "undefined" ? window.tekkMidi : undefined;
}

export class MidiIO {
  private outs: PortInfo[] = [];
  private ins: PortInfo[] = [];
  private outId: string | null = null;
  private inId: string | null = null;
  private started = false;
  private rxBuffer: number[] = [];
  private inSysex = false;

  /** Callback für vollständige SysEx-Frames (F0…F7). */
  onSysex: ((bytes: Uint8Array) => void) | null = null;
  /** Callback bei Port-Änderungen (aktuell ungenutzt; API-kompatibel). */
  onPortsChanged: (() => void) | null = null;

  get available(): boolean {
    return !!bridge()?.available;
  }
  get ready(): boolean {
    return this.started;
  }

  private outOpened = false;
  private inOpened = false;

  /**
   * Initialisiert die Bridge: nur Ports laden + Empfang registrieren. Die Ports
   * werden NICHT sofort geöffnet — das Öffnen ist ein synchroner nativer Aufruf,
   * der blockiert, falls ein anderer Prozess den Port hält. Geöffnet wird daher
   * erst bei der ersten tatsächlichen Aktion (Senden/Empfangen).
   */
  async enable(): Promise<void> {
    const b = bridge();
    if (!b) throw new Error("MIDI-Bridge nicht verfügbar (nur in der Desktop-App).");
    const { outputs, inputs } = await b.list();
    this.outs = outputs;
    this.ins = inputs;
    if (!this.outId && outputs[0]) this.outId = outputs[0].id;
    if (!this.inId && inputs[0]) this.inId = inputs[0].id;
    b.onMessage((bytes) => this.rx(bytes));
    this.started = true;
  }

  /** Öffnet die gewählten Ports lazy (einmalig) vor der ersten Nutzung. */
  private async ensureOpen(): Promise<void> {
    const b = bridge();
    if (!b) throw new Error("MIDI nicht aktiviert.");
    if (this.outId && !this.outOpened) {
      await b.selectOut(this.outId);
      this.outOpened = true;
    }
    if (this.inId && !this.inOpened) {
      await b.selectIn(this.inId);
      this.inOpened = true;
    }
  }

  private labelOf(p: PortInfo): string {
    return p.label ?? p.name ?? "MIDI-Port";
  }

  outputs(): PortInfo[] {
    return this.outs.map((p) => ({ id: p.id, label: this.labelOf(p) }));
  }
  inputs(): PortInfo[] {
    return this.ins.map((p) => ({ id: p.id, label: this.labelOf(p) }));
  }

  selectOutput(id: string): void {
    this.outId = id;
    this.outOpened = false;
    bridge()
      ?.selectOut(id)
      .then(() => {
        this.outOpened = true;
      })
      .catch((e) => console.error("selectOut", e));
  }
  selectInput(id: string): void {
    this.inId = id;
    this.inOpened = false;
    bridge()
      ?.selectIn(id)
      .then(() => {
        this.inOpened = true;
      })
      .catch((e) => console.error("selectIn", e));
  }
  get selectedOutput(): string | null {
    return this.outId;
  }
  get selectedInput(): string | null {
    return this.inId;
  }

  /** Sendet rohe Bytes (typisch ein kompletter SysEx-Frame). Öffnet die Ports
   *  bei Bedarf lazy vor dem ersten Senden. */
  send(bytes: Uint8Array): void {
    const b = bridge();
    if (!b) throw new Error("MIDI nicht aktiviert.");
    this.ensureOpen()
      .then(() => b.send(Array.from(bytes)))
      .catch((e) => console.error("midi send", e));
  }

  /** SysEx-Reassembly: sammelt Bytes zwischen F0 und F7 (native liefert i.d.R.
   *  komplette Frames, wird aber defensiv reassembliert). */
  private rx(data: number[]): void {
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
