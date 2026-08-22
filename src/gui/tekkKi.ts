/**
 * tekkKi — typisierter Zugriff auf die KI-Bruecke (preload.cjs): API-Key in
 * den App-Einstellungen, Rezept-Aufruf im Main-Prozess. Im Browser undefined.
 */
export interface TekkKi {
  available: boolean;
  /** vorschau = Anfang…Ende · Laenge, damit ein Fehl-Paste auffaellt */
  keyStatus(): Promise<{ gesetzt: boolean; modell: string; vorschau: string }>;
  /** wirft, wenn der Key nicht wie "sk-ant-…" aussieht */
  keySetzen(key: string, modell?: string): Promise<{ gesetzt: boolean; modell: string; vorschau: string }>;
  rezept(anfrage: { system: string; user: string; schema: object }): Promise<{ text: string; modell: string; tokens: number }>;
}

export function tekkKi(): TekkKi | undefined {
  const w = globalThis as unknown as { tekkKi?: TekkKi };
  return w.tekkKi?.available ? w.tekkKi : undefined;
}
