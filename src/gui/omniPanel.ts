/**
 * omniPanel.ts (GUI) — Omnitribe-Modul-Panel: Modul-Karten aus OMNI_MODULES
 * (core/otp.ts) laden/entladen und je Modul parametrieren.
 * Dieses Skelett baut nur die Karten; Sende-Logik folgt in Task 5-8.
 */

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
