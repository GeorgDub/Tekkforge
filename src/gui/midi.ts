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

/** Wählt den Electribe/KORG-Port (falls vorhanden), sonst den ersten. */
function pickPort(ports: PortInfo[]): string | null {
  if (ports.length === 0) return null;
  const match = ports.find((p) => /electribe|korg|e2|elect/i.test(p.name ?? p.label ?? ""));
  return (match ?? ports[0]).id;
}

export class MidiIO {
  private outs: PortInfo[] = [];
  private ins: PortInfo[] = [];
  private outId: string | null = null;
  private inId: string | null = null;
  private started = false;
  private rxBuffer: number[] = [];
  private inSysex = false;

  /** Callback für vollständige SysEx-Frames (F0…F7). Wird von requestSysex
   *  temporär umgehängt. */
  onSysex: ((bytes: Uint8Array) => void) | null = null;
  /** Monitor-Callback: feuert bei JEDEM empfangenen Frame (auch Nicht-SysEx),
   *  unabhängig von requestSysex — für die Roh-Anzeige. */
  onAnyMessage: ((bytes: number[]) => void) | null = null;
  /** Monitor-Callback für AUSGEHENDE Nachrichten (Diagnose). */
  onSent: ((bytes: number[]) => void) | null = null;
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
    // Bevorzugt den Electribe/KORG-Port statt blind [0] — sonst landet der
    // erste Ausgang oft auf „Microsoft GS Wavetable Synth" (kein E2S-Reply).
    if (!this.outId) this.outId = pickPort(outputs);
    if (!this.inId) this.inId = pickPort(inputs);
    b.onMessage((bytes) => this.rx(bytes));
    this.started = true;
  }

  /** Öffnet NUR den Ausgang (fürs Senden nötig; unabhängig vom Eingang). */
  private async ensureOutOpen(): Promise<void> {
    const b = bridge();
    if (!b) throw new Error("MIDI nicht aktiviert.");
    if (this.outId && !this.outOpened) {
      await b.selectOut(this.outId);
      this.outOpened = true;
    }
  }

  /** Öffnet NUR den Eingang (fürs Empfangen). */
  private async ensureInOpen(): Promise<void> {
    const b = bridge();
    if (!b) throw new Error("MIDI nicht aktiviert.");
    if (this.inId && !this.inOpened) {
      await b.selectIn(this.inId);
      this.inOpened = true;
    }
  }

  /**
   * Öffnet Ausgang (nötig, wirft bei Fehler) und Eingang (best-effort — ein
   * belegter Eingang darf das Senden NICHT blockieren). Gibt zurück, ob der
   * Eingang (Empfang) verfügbar ist.
   */
  async connect(): Promise<{ inputOk: boolean; inputError?: string }> {
    await this.ensureOutOpen();
    try {
      await this.ensureInOpen();
      return { inputOk: true };
    } catch (err) {
      return { inputOk: false, inputError: err instanceof Error ? err.message : String(err) };
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

  /**
   * Sendet rohe Bytes (typisch ein kompletter SysEx-Frame). Öffnet NUR den
   * Ausgang bei Bedarf (unabhängig vom Eingang). Feuert-und-vergisst; für
   * echtes Ergebnis `sendAsync()` nutzen.
   */
  send(bytes: Uint8Array): void {
    void this.sendAsync(bytes).catch((e) => console.error("midi send", e));
  }

  /** Wie send(), aber awaitbar — resolved erst nach erfolgreichem Senden. */
  async sendAsync(bytes: Uint8Array): Promise<void> {
    const b = bridge();
    if (!b) throw new Error("MIDI nicht aktiviert.");
    await this.ensureOutOpen();
    const arr = Array.from(bytes);
    this.onSent?.(arr);
    await b.send(arr);
  }

  /** SysEx-Reassembly: sammelt Bytes zwischen F0 und F7 (native liefert i.d.R.
   *  komplette Frames, wird aber defensiv reassembliert). */
  private rx(data: number[]): void {
    // Monitor: jede eingehende Nachricht roh melden (Diagnose).
    this.onAnyMessage?.(data);
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
      () =>
        finish(() =>
          reject(
            new Error(
              // Der häufigste Grund ist NICHT das Gerät, sondern ein belegter
              // Port: der KORG-USB-Treiber ist unter Windows Single-Client.
              // Hält eine andere Anwendung den Eingang, öffnet TekkForge ihn
              // klaglos und empfängt trotzdem nichts — der Fall ist stumm und
              // sieht wie ein totes Gerät aus.
              "Keine Antwort vom Gerät (Timeout). Zwei häufige Ursachen, beide " +
                "stumm: (1) der MIDI-Port ist von einem anderen Programm belegt — " +
                "der KORG-Treiber lässt nur einen Zugriff gleichzeitig zu, also " +
                "andere DAW/Editoren schließen. (2) der Global-MIDI-Kanal des " +
                "Geräts wurde geändert — er steckt im SysEx-Kopf, und das Gerät " +
                "ignoriert Anfragen auf dem falschen Kanal. Dagegen hilft " +
                "'Geraet suchen': die Suche laeuft kanalunabhaengig und stellt " +
                "den richtigen Kanal automatisch ein. " +
                "Sonst prüfen: Gerät an, SysEx im Global-Menü aktiviert, richtiger Port.",
            ),
          ),
        ),
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

/**
 * Wartet (ohne selbst zu senden) auf die erste SysEx-Antwort, die `match`
 * erfüllt — für ACK-Bestätigungen NACH einem bereits abgesetzten Send.
 * Resolved mit den Bytes oder null bei Timeout (kein Reject — Timeout ist
 * bei ACKs ein legitimer „Gerät bestätigt nicht"-Fall).
 */
export function waitSysex(
  io: MidiIO,
  match: (bytes: Uint8Array) => boolean,
  timeoutMs: number,
): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const prev = io.onSysex;
    let done = false;
    const finish = (result: Uint8Array | null) => {
      if (done) return;
      done = true;
      io.onSysex = prev;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    io.onSysex = (bytes) => {
      prev?.(bytes);
      if (match(bytes)) finish(bytes);
    };
  });
}
