/**
 * fxPreset.ts (GUI) — Effekt-Presets des Geraets bearbeiten: Platz lesen,
 * Algorithmen und Parameter mit Namen einstellen, X/Y-Belegung setzen, wieder
 * zurueckschreiben. Lesen und Schreiben laufen ueber die Funktionen des
 * RAM-Panels (Schnappschuss + Rueckleseprobe), die hier hineingereicht werden —
 * damit gibt es nur EINEN Schreibpfad und nur eine Stelle mit Sicherungen.
 */
import { $, escapeHtml, frageText } from "./shared";
import {
  decodeFxPreset,
  encodeFxPreset,
  initFxPresetBytes,
  ifx2Moeglich,
  FX_PRESET_SIZE,
  FX_QUELLEN,
  FX_KETTEN,
  type FxPreset,
  type FxStufe,
} from "../core/e2FxPreset";
import { IFX_TYPES, MFX_TYPES } from "../core/e2FxParams";
import {
  decodeGroove,
  encodeGroove,
  initGrooveBytes,
  erkenneStepBasis,
  setzeSwing,
  GROOVE_SIZE,
  GROOVE_STEP_BASIS,
  TRIGGER_MAX,
  GATE_MAX,
  VELOCITY_MAX,
  type Groove,
} from "../core/e2Groove";
import { baueMidiThru } from "../core/fxLive";
import { grooveAusAudio } from "../core/grooveAusLied";
import { sicherungsPlan, baueSicherung, leseSicherung, vergleicheSicherung, type SicherungsBlock } from "../core/geraetSicherung";
import { baueSammlung, leseSammlung, type SammlungsEintrag } from "../core/sammlung";
import { dekodiere } from "./audioDecode";
import { legeAb, zeigeAblage } from "./ablage";
import { E2_RAM_MAP, addressForSlot, IFX_PRESET_WRITE_MAX, MFX_PRESET_WRITE_MAX } from "../core/hacktribeRam";

export interface FxPresetHooks {
  lesen(addr: number, len: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }>;
  schreiben(addr: number, bytes: Uint8Array, was: string): Promise<void>;
  /** Rohe MIDI-Nachricht senden (fuer die versteckten Global-Einstellungen). */
  midi?(bytes: number[]): void;
}

let hooks: FxPresetHooks | null = null;
let preset: FxPreset | null = null;
let groove: Groove | null = null;
let basis: Uint8Array | null = null;
let quelleAdresse: number | null = null;
/**
 * Kam der Editorinhalt aus einer Datei (oder aus der Sammlung) statt vom Geraet?
 *
 * Dann darf die Pflicht-Lesung des Ziel-Platzes ihn nicht ueberschreiben. Ohne
 * dieses Flag war ein geladenes Preset nicht aufs Geraet zu bekommen: Laden
 * loescht den Vorher-Stand (der Schreib-Knopf bleibt verborgen), und die
 * Lesung, die ihn herstellt, holte bisher auch gleich das Preset des Platzes
 * in den Editor — die Datei war damit wieder weg. Jetzt liefert die Lesung nur
 * noch, wofuer sie da ist: Adresse, Vorher-Stand fuers Rueckschreiben, und die
 * unbekannten Bytes des Platzes als Unterlage.
 */
let ausDatei_imEditor = false;

const setStatus = (t: string): void => {
  const el = document.getElementById("fxpStatus");
  if (el) el.textContent = t;
};

type Art = "ifx" | "mfx" | "groove";
const art = (): Art => (($("fxpArt") as HTMLSelectElement).value as Art) ?? "ifx";
const istMfx = (): boolean => art() === "mfx";
const istGroove = (): boolean => art() === "groove";

/** Groove-Vorlagen: 96 Plaetze (beide Quellen einig). */
const GROOVE_WRITE_MAX = 95;

/** Adresse des gewaehlten Platzes aus der RAM-Karte. */
function adresse(): { addr: number; slot: number; max: number; len: number } | null {
  const key = istGroove() ? "groove" : istMfx() ? "mfxPreset" : "ifxPreset";
  const eintrag = E2_RAM_MAP.find((e) => e.key === key);
  if (!eintrag) return null;
  const max = istGroove() ? GROOVE_WRITE_MAX : istMfx() ? MFX_PRESET_WRITE_MAX : IFX_PRESET_WRITE_MAX;
  const slot = Math.max(0, Math.min(max, Number(($("fxpSlot") as HTMLInputElement).value) || 0));
  return { addr: addressForSlot(eintrag, slot), slot, max, len: istGroove() ? GROOVE_SIZE : FX_PRESET_SIZE };
}

// ─── Oberflaeche ─────────────────────────────────────────────────────────────

function algorithmenListe(mfx: boolean): { id: number; name: string }[] {
  const tabelle = mfx ? MFX_TYPES : IFX_TYPES;
  return Object.entries(tabelle)
    .map(([id, def]) => ({ id: Number(id), name: def.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function stufeHtml(titel: string, key: "ifx1" | "ifx2" | "mfx", s: FxStufe, mfx: boolean, gesperrt: string | null): string {
  const liste = algorithmenListe(mfx);
  return `
    <div class="card" style="padding:8px;margin-bottom:8px${gesperrt ? ";opacity:.55" : ""}">
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div>
          <label style="display:block;color:var(--muted);font-size:10px;margin-bottom:2px">${escapeHtml(titel)}</label>
          <select class="fxpDev" data-stufe="${key}" ${gesperrt ? "disabled" : ""} style="min-width:170px">
            ${liste.map((a) => `<option value="${a.id}" ${a.id === s.device ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label style="display:block;color:var(--muted);font-size:10px;margin-bottom:2px">Eingang</label>
          <input class="fxpLvl" data-stufe="${key}" data-feld="preLevel" type="number" min="0" max="127" value="${s.preLevel}" style="width:66px" ${gesperrt ? "disabled" : ""} />
        </div>
        <div>
          <label style="display:block;color:var(--muted);font-size:10px;margin-bottom:2px">Ausgang</label>
          <input class="fxpLvl" data-stufe="${key}" data-feld="postLevel" type="number" min="0" max="127" value="${s.postLevel}" style="width:66px" ${gesperrt ? "disabled" : ""} />
        </div>
        ${gesperrt ? `<span class="sub" style="margin:0">${escapeHtml(gesperrt)}</span>` : ""}
      </div>
      ${
        s.paramNamen.length && !gesperrt
          ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
              ${s.paramNamen
                .map(
                  (n, k) => `<div>
                    <label style="display:block;color:var(--muted);font-size:10px;margin-bottom:2px">${escapeHtml(n)}</label>
                    <input class="fxpPar" data-stufe="${key}" data-idx="${k}" type="number" min="0" max="127" value="${s.params[k] ?? 0}" style="width:64px" />
                  </div>`,
                )
                .join("")}
            </div>`
          : ""
      }
    </div>`;
}

/** Groove-Vorlage: Kopfzeile, Swing-Schnellzugriff und Step-Tabelle. */
function renderGroove(host: HTMLElement, g: Groove): void {
  const zeilen: string[] = [];
  for (let i = 0; i < g.laenge; i++) {
    const s = g.steps[i];
    const takt = Math.floor(i / 16) + 1;
    zeilen.push(`<tr${i % 4 === 0 ? ' style="border-top:1px solid var(--border)"' : ""}>
      <td style="color:var(--muted);font-size:10px">${i + 1}<span style="opacity:.5"> · T${takt}</span></td>
      <td><input class="gvT" data-i="${i}" type="number" min="${-TRIGGER_MAX}" max="${TRIGGER_MAX}" value="${s.trigger}" style="width:62px" /></td>
      <td><input class="gvV" data-i="${i}" type="number" min="0" max="${VELOCITY_MAX}" value="${s.velocity}" style="width:62px" /></td>
      <td><input class="gvG" data-i="${i}" type="number" min="0" max="${GATE_MAX}" value="${s.gate}" style="width:62px" /></td>
    </tr>`);
  }
  host.innerHTML = `
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:8px">
      <div>
        <label style="display:block;color:var(--muted);font-size:10px;margin-bottom:2px">Name im Geräte-Menü (max 15)</label>
        <input id="gvName" type="text" maxlength="15" value="${escapeHtml(g.name)}" style="width:190px" />
      </div>
      <div>
        <label style="display:block;color:var(--muted);font-size:10px;margin-bottom:2px">Länge (Steps)</label>
        <input id="gvLen" type="number" min="1" max="64" value="${g.laenge}" style="width:70px" />
      </div>
      <div>
        <label style="display:block;color:var(--muted);font-size:10px;margin-bottom:2px">Swing (0–${TRIGGER_MAX})</label>
        <input id="gvSwing" type="number" min="0" max="${TRIGGER_MAX}" value="0" style="width:70px" />
      </div>
      <button id="gvSwingLos" class="ghost">Swing setzen</button>
      <span class="sub" style="margin:0">${TRIGGER_MAX} = halber Step · 0 = gerade</span>
    </div>
    <div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:6px">
      <table style="width:100%;font-size:11px">
        <thead><tr>
          <th style="text-align:left">Step</th>
          <th style="text-align:left">Versatz</th>
          <th style="text-align:left">Anschlag</th>
          <th style="text-align:left">Tonlänge</th>
        </tr></thead>
        <tbody>${zeilen.join("")}</tbody>
      </table>
    </div>`;
  const zahl = (el: HTMLInputElement, min: number, max: number): number =>
    Math.max(min, Math.min(max, Math.round(Number(el.value) || 0)));
  $("gvName").addEventListener("input", () => {
    g.name = ($("gvName") as HTMLInputElement).value;
  });
  $("gvLen").addEventListener("change", () => {
    g.laenge = zahl($("gvLen") as HTMLInputElement, 1, 64);
    render();
  });
  $("gvSwingLos").addEventListener("click", () => {
    setzeSwing(g, zahl($("gvSwing") as HTMLInputElement, 0, TRIGGER_MAX));
    render();
  });
  for (const el of host.querySelectorAll<HTMLInputElement>(".gvT")) {
    el.addEventListener("change", () => {
      g.steps[Number(el.dataset.i)].trigger = zahl(el, -TRIGGER_MAX, TRIGGER_MAX);
    });
  }
  for (const el of host.querySelectorAll<HTMLInputElement>(".gvV")) {
    el.addEventListener("change", () => {
      g.steps[Number(el.dataset.i)].velocity = zahl(el, 0, VELOCITY_MAX);
    });
  }
  for (const el of host.querySelectorAll<HTMLInputElement>(".gvG")) {
    el.addEventListener("change", () => {
      g.steps[Number(el.dataset.i)].gate = zahl(el, 0, GATE_MAX);
    });
  }
  document.getElementById("fxpWrite")?.classList.toggle("hidden", !quelleAdresse);
}

function render(): void {
  const host = document.getElementById("fxpEditor");
  if (!host) return;
  if (istGroove()) {
    if (!groove) {
      host.innerHTML = `<p class="sub" style="margin:0">Platz wählen und „Vom Gerät lesen“ — oder eine gesicherte Datei laden.</p>`;
      document.getElementById("fxpWrite")?.classList.add("hidden");
      return;
    }
    renderGroove(host, groove);
    return;
  }
  if (!preset) {
    host.innerHTML = `<p class="sub" style="margin:0">Platz wählen und „Vom Gerät lesen“ — oder eine gesicherte Datei laden.</p>`;
    document.getElementById("fxpWrite")?.classList.add("hidden");
    return;
  }
  const p = preset;
  const zweitSperre = ifx2Moeglich(p.ifx1.device) ? null : "geht nur hinter Thru, Cheap Comp, Punch, EQ 2-Band, Filter, Acid Driver oder Mute";
  const paramNamenFuer = (kette: number): string[] =>
    kette === 0 ? p.ifx1.paramNamen : kette === 1 ? p.ifx2.paramNamen : kette === 2 ? p.mfx.paramNamen : [];
  host.innerHTML = `
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:8px">
      <div>
        <label style="display:block;color:var(--muted);font-size:10px;margin-bottom:2px">Name im Geräte-Menü (max 15)</label>
        <input id="fxpName" type="text" maxlength="15" value="${escapeHtml(p.name)}" style="width:190px" />
      </div>
    </div>
    ${stufeHtml("Insert-Effekt 1", "ifx1", p.ifx1, false, null)}
    ${stufeHtml("Insert-Effekt 2", "ifx2", p.ifx2, false, zweitSperre)}
    ${stufeHtml("Master-Effekt", "mfx", p.mfx, true, null)}
    <details style="margin-top:4px">
      <summary style="cursor:pointer;color:var(--muted);font-size:12px">X/Y-Fläche und FX-Knopf — ${p.controlMap.filter((z) => z.quelle).length} von 10 belegt</summary>
      <table style="width:100%;font-size:11px;margin-top:6px">
        <thead><tr><th style="text-align:left">Bedienelement</th><th style="text-align:left">Stufe</th><th style="text-align:left">Parameter</th><th>von</th><th>bis</th></tr></thead>
        <tbody>
          ${p.controlMap
            .map((z, i) => {
              const namen = paramNamenFuer(z.kette);
              return `<tr>
              <td><select class="fxpQ" data-i="${i}">${FX_QUELLEN.map((q) => `<option value="${q.wert}" ${q.wert === z.quelle ? "selected" : ""}>${escapeHtml(q.name)}</option>`).join("")}</select></td>
              <td><select class="fxpK" data-i="${i}">${FX_KETTEN.map((k) => `<option value="${k.wert}" ${k.wert === z.kette ? "selected" : ""}>${escapeHtml(k.name)}</option>`).join("")}</select></td>
              <td><select class="fxpZ" data-i="${i}">${
                namen.length
                  ? namen.map((n, k) => `<option value="${k}" ${k === z.zielParam ? "selected" : ""}>${escapeHtml(n)}</option>`).join("")
                  : `<option value="${z.zielParam}">Parameter ${z.zielParam}</option>`
              }</select></td>
              <td><input class="fxpMin" data-i="${i}" type="number" min="0" max="127" value="${z.min}" style="width:60px" /></td>
              <td><input class="fxpMax" data-i="${i}" type="number" min="0" max="127" value="${z.max}" style="width:60px" /></td>
            </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </details>`;

  // ── Eingaben zurueck ins Preset ──
  const zahl = (el: HTMLInputElement): number => Math.max(0, Math.min(127, Number(el.value) || 0));
  $("fxpName").addEventListener("input", () => {
    p.name = ($("fxpName") as HTMLInputElement).value;
  });
  for (const sel of host.querySelectorAll<HTMLSelectElement>(".fxpDev")) {
    sel.addEventListener("change", () => {
      const stufe = sel.dataset.stufe as "ifx1" | "ifx2" | "mfx";
      const neu = Number(sel.value);
      // Algorithmus wechseln heisst neue Parameterliste — Werte des alten
      // Effekts waeren sonst sinnlos, weil sie andere Bedeutungen haetten
      const tabelle = stufe === "mfx" ? MFX_TYPES : IFX_TYPES;
      const namen = tabelle[neu]?.params ?? [];
      p[stufe] = { ...p[stufe], device: neu, algorithmus: tabelle[neu]?.name ?? "", paramNamen: [...namen], params: namen.map((_, k) => p[stufe].params[k] ?? 0) };
      render();
    });
  }
  for (const el of host.querySelectorAll<HTMLInputElement>(".fxpLvl")) {
    el.addEventListener("change", () => {
      const stufe = el.dataset.stufe as "ifx1" | "ifx2" | "mfx";
      const feld = el.dataset.feld as "preLevel" | "postLevel";
      p[stufe][feld] = zahl(el);
    });
  }
  for (const el of host.querySelectorAll<HTMLInputElement>(".fxpPar")) {
    el.addEventListener("change", () => {
      const stufe = el.dataset.stufe as "ifx1" | "ifx2" | "mfx";
      p[stufe].params[Number(el.dataset.idx)] = zahl(el);
    });
  }
  const zuordnung = (el: HTMLElement): (typeof p.controlMap)[number] => p.controlMap[Number(el.dataset.i)];
  for (const el of host.querySelectorAll<HTMLSelectElement>(".fxpQ")) {
    el.addEventListener("change", () => {
      zuordnung(el).quelle = Number(el.value);
    });
  }
  for (const el of host.querySelectorAll<HTMLSelectElement>(".fxpK")) {
    el.addEventListener("change", () => {
      zuordnung(el).kette = Number(el.value);
      render();
    });
  }
  for (const el of host.querySelectorAll<HTMLSelectElement>(".fxpZ")) {
    el.addEventListener("change", () => {
      zuordnung(el).zielParam = Number(el.value);
    });
  }
  for (const el of host.querySelectorAll<HTMLInputElement>(".fxpMin")) {
    el.addEventListener("change", () => {
      zuordnung(el).min = zahl(el);
    });
  }
  for (const el of host.querySelectorAll<HTMLInputElement>(".fxpMax")) {
    el.addEventListener("change", () => {
      zuordnung(el).max = zahl(el);
    });
  }
  document.getElementById("fxpWrite")?.classList.toggle("hidden", !quelleAdresse);
}

// ─── Geraet ──────────────────────────────────────────────────────────────────

async function lesen(): Promise<void> {
  const ziel = adresse();
  if (!hooks || !ziel) return;
  setStatus(`Lese Platz ${ziel.slot} …`);
  const r = await hooks.lesen(ziel.addr, ziel.len);
  if (!r.ok) {
    setStatus(`Lesen fehlgeschlagen: ${r.reason}`);
    return;
  }
  basis = r.bytes;
  quelleAdresse = ziel.addr;
  // Der Editor wird nur ueberschrieben, wenn sein Inhalt vom Geraet stammt.
  // Steht dort etwas aus einer Datei, bleibt es stehen — die Lesung liefert
  // dann nur Adresse, Vorher-Stand und Unterlage (siehe `ausDatei_imEditor`).
  const behalten = ausDatei_imEditor;
  const nachsatz = behalten ? " — der geladene Stand bleibt im Editor, „Schreiben“ ist jetzt frei." : "";
  if (istGroove()) {
    const gelesen = decodeGroove(r.bytes);
    if (!behalten) groove = gelesen;
    render();
    // Zwei Quellen nennen verschiedene Step-Adressen — am 0xFF-Muster
    // nachsehen, statt blind an unsere Stelle zu schreiben
    const erkannt = erkenneStepBasis(r.bytes);
    const rahmen = String.fromCharCode(...r.bytes.slice(0, 4)) === "GVST";
    const warnung =
      erkannt === null
        ? " ⚠ Step-Muster nicht gefunden — bitte NICHT schreiben, erst melden."
        : erkannt !== GROOVE_STEP_BASIS
          ? ` ⚠ Steps liegen bei 0x${erkannt.toString(16)}, erwartet 0x${GROOVE_STEP_BASIS.toString(16)} — nicht schreiben.`
          : "";
    setStatus(
      `Groove-Platz ${ziel.slot} gelesen: „${gelesen.name || "(ohne Namen)"}“, ${gelesen.laenge} Steps` +
        `${rahmen ? "" : " (kein GVST-Kennzeichen — evtl. leerer Platz)"}${warnung}${nachsatz}`,
    );
    return;
  }
  const gelesen = decodeFxPreset(r.bytes, istMfx());
  if (!behalten) preset = gelesen;
  render();
  setStatus(
    `Platz ${ziel.slot} gelesen: „${gelesen.name || "(ohne Namen)"}“ — ${gelesen.ifx1.algorithmus || "?"}` +
      `${gelesen.mfx.algorithmus && gelesen.mfx.device ? ` + ${gelesen.mfx.algorithmus}` : ""}${nachsatz}`,
  );
}

async function schreiben(): Promise<void> {
  const ziel = adresse();
  if (!hooks || !ziel) return;
  if (quelleAdresse === null) {
    setStatus("Erst einen Platz lesen — ohne Vorher-Stand wird nicht geschrieben.");
    return;
  }
  if (istGroove()) {
    if (!groove) return;
    // Nicht an eine Stelle schreiben, deren Aufbau die Lesung nicht bestaetigt hat
    if (basis && erkenneStepBasis(basis) !== GROOVE_STEP_BASIS) {
      setStatus("Abbruch: Der gelesene Block passt nicht zum erwarteten Groove-Aufbau.");
      return;
    }
    const bytes = encodeGroove(groove, basis ?? undefined);
    setStatus(`Schreibe Groove „${groove.name}“ auf Platz ${ziel.slot} …`);
    await hooks.schreiben(ziel.addr, bytes, `Groove „${groove.name}“`);
    // Editor und Geraet stehen jetzt gleich — die naechste Lesung darf den
    // Editor wieder fuellen
    ausDatei_imEditor = false;
    document.getElementById("fxpUndo")?.classList.remove("hidden");
    return;
  }
  if (!preset) return;
  const bytes = encodeFxPreset(preset, basis ?? undefined);
  setStatus(`Schreibe „${preset.name}“ auf Platz ${ziel.slot} …`);
  await hooks.schreiben(ziel.addr, bytes, `Preset „${preset.name}“`);
  ausDatei_imEditor = false;
  document.getElementById("fxpUndo")?.classList.remove("hidden");
}

async function zurueck(): Promise<void> {
  if (!hooks || !basis || quelleAdresse === null) {
    setStatus("Kein Vorher-Stand vorhanden.");
    return;
  }
  await hooks.schreiben(quelleAdresse, basis, "Preset zurückschreiben");
}

// ─── Datei ───────────────────────────────────────────────────────────────────

function sichern(): void {
  const gv = istGroove();
  if (gv ? !groove : !preset) return;
  const bytes = gv ? encodeGroove(groove!, basis ?? undefined) : encodeFxPreset(preset!, basis ?? undefined);
  const roh = (gv ? groove!.name : preset!.name) || (gv ? "groove" : "preset");
  const name = roh.replace(/[^A-Za-z0-9 _-]/g, "").trim() || (gv ? "groove" : "preset");
  const endung = gv ? "e2gv" : "e2fxp";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/octet-stream" }));
  a.download = `${name}.${endung}`;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`„${roh}“ als ${name}.${endung} gesichert.`);
}

// ─── Sammlung ────────────────────────────────────────────────────────────────

/** Die Sammlung lebt fuer die Sitzung; gesichert wird bewusst als Datei. */
let sammlung: SammlungsEintrag[] = [];

function renderSammlung(): void {
  const info = document.getElementById("fxpSamInfo");
  const liste = document.getElementById("fxpSamListe");
  if (info) info.textContent = sammlung.length ? `${sammlung.length} Eintrag/Einträge` : "noch leer";
  if (!liste) return;
  liste.innerHTML = sammlung.length
    ? `<div class="startListe">${sammlung
        .map(
          (e, i) =>
            `<div><span class="rolle">${e.art.toUpperCase()}</span><span style="flex:1">${escapeHtml(e.name)}</span>` +
            `<button class="ghost fxpSamNutz" data-i="${i}" style="padding:2px 8px;font-size:11px">bearbeiten</button>` +
            `<button class="ghost fxpSamWeg" data-i="${i}" style="padding:2px 8px;font-size:11px">✕</button></div>`,
        )
        .join("")}</div>`
    : "";
  for (const b of liste.querySelectorAll<HTMLButtonElement>(".fxpSamNutz")) {
    b.addEventListener("click", () => sammlungsEintragOeffnen(Number(b.dataset.i)));
  }
  for (const b of liste.querySelectorAll<HTMLButtonElement>(".fxpSamWeg")) {
    b.addEventListener("click", () => {
      sammlung.splice(Number(b.dataset.i), 1);
      renderSammlung();
    });
  }
}

/** Einen Eintrag der Sammlung in den Editor holen. */
function sammlungsEintragOeffnen(i: number): void {
  const e = sammlung[i];
  if (!e) return;
  ($("fxpArt") as HTMLSelectElement).value = e.art;
  basis = e.bytes.slice();
  quelleAdresse = null;
  ausDatei_imEditor = true;
  if (e.art === "groove") {
    groove = decodeGroove(e.bytes);
    preset = null;
  } else {
    preset = decodeFxPreset(e.bytes, e.art === "mfx");
    groove = null;
  }
  zeigeGrooveKnopf();
  render();
  setStatus(`„${e.name}" aus der Sammlung geladen. Zum Schreiben erst den Ziel-Platz vom Gerät lesen.`);
}

function sammlungAufnehmen(): void {
  const gv = istGroove();
  if (gv ? !groove : !preset) return;
  const bytes = gv ? encodeGroove(groove!, basis ?? undefined) : encodeFxPreset(preset!, basis ?? undefined);
  const name = (gv ? groove!.name : preset!.name) || (gv ? "Groove" : "Preset");
  sammlung.push({ art: gv ? "groove" : istMfx() ? "mfx" : "ifx", name, bytes });
  renderSammlung();
  setStatus(`„${name}" in die Sammlung gelegt (${sammlung.length} insgesamt). Zum Behalten die Sammlung sichern.`);
}

async function sammlungSpeichern(): Promise<void> {
  if (!sammlung.length) {
    setStatus("Die Sammlung ist leer — erst etwas aufnehmen.");
    return;
  }
  const titel = (await frageText("Titel der Sammlung:", "Meine Effekte")) ?? "Sammlung";
  const text = baueSammlung(sammlung, { titel });
  const datei = `${titel.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "sammlung"}.tfsam`;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = datei;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`${sammlung.length} Eintrag/Einträge als ${datei} gesichert.`);
}

async function sammlungLaden(f: File): Promise<void> {
  try {
    const s = leseSammlung(await f.text());
    sammlung = s.eintraege;
    renderSammlung();
    setStatus(`„${s.titel}"${s.autor ? ` von ${s.autor}` : ""} geladen — ${s.eintraege.length} Eintrag/Einträge.`);
  } catch (e) {
    setStatus("Sammlung nicht lesbar: " + (e instanceof Error ? e.message : String(e)));
  }
}

// ─── Komplettsicherung ───────────────────────────────────────────────────────

/** Unter dem Standardordner der App — Sicherungen gehoeren nicht auf die SD-Karte. */
const SICHERUNGS_ORDNER = "Sicherungen";
/** Pfad der zuletzt geschriebenen Sicherung (fuer „Ordner zeigen"). */
let letzteSicherung: string | null = null;

const sicherungsInfo = (t: string): void => {
  const el = document.getElementById("fxpSicherungInfo");
  if (el) el.textContent = t;
};

/**
 * Alle Bereiche der RAM-Karte am Stueck lesen. Das sind rund 400 Anfragen —
 * darum Fortschritt anzeigen und bei der ersten Fehlmeldung abbrechen, statt
 * eine lueckenhafte Sicherung zu schreiben.
 */
async function alleBloeckeLesen(): Promise<SicherungsBlock[] | null> {
  if (!hooks) return null;
  const plan = sicherungsPlan();
  const gesamt = plan.reduce((s, p) => s + p.laenge, 0);
  const out: SicherungsBlock[] = [];
  let fertig = 0;
  for (const p of plan) {
    const bytes = new Uint8Array(p.laenge);
    for (let off = 0; off < p.laenge; off += 0x100) {
      const len = Math.min(0x100, p.laenge - off);
      const r = await hooks.lesen(p.adresse + off, len);
      if (!r.ok) {
        setStatus(`Sicherung abgebrochen bei ${p.label} +0x${off.toString(16)}: ${r.reason}`);
        return null;
      }
      bytes.set(r.bytes.subarray(0, len), off);
      fertig += len;
      sicherungsInfo(`${p.label} … ${Math.round((fertig / gesamt) * 100)} %`);
    }
    out.push({ ...p, bytes });
  }
  return out;
}

async function geraetSichern(): Promise<void> {
  setStatus("Lese alle Bereiche — das dauert eine Weile …");
  const bloecke = await alleBloeckeLesen();
  if (!bloecke) return;
  const text = baueSicherung(bloecke, { geraet: "E2S", firmware: "hacktribe" });
  const name = `tekkforge-geraet-${new Date().toISOString().slice(0, 10)}.tfbak`;
  const kb = Math.round(bloecke.reduce((s, b) => s + b.laenge, 0) / 1024);
  // Eine Sicherung darf nicht am Browser-Download haengen: der meldet nicht,
  // ob eine Datei entstanden ist. „Gesichert" zu sagen, ohne es zu wissen, ist
  // genau der Fehler, der erst auffaellt, wenn man die Sicherung braucht.
  try {
    const ab = await legeAb(name, text, SICHERUNGS_ORDNER, "application/json");
    sicherungsInfo(`${bloecke.length} Bereiche, ${kb} kB gesichert.`);
    setStatus(
      ab.pfad
        ? `Sicherung geschrieben: ${ab.pfad}`
        : `Sicherung als ${name} zum Herunterladen angeboten — im Browser kann TekkForge nicht pruefen, ob sie ankam.`,
    );
    letzteSicherung = ab.pfad;
    const knopf = document.getElementById("fxpSicherungZeigen");
    if (knopf) knopf.classList.toggle("hidden", !ab.pfad);
  } catch (err) {
    sicherungsInfo(`${bloecke.length} Bereiche gelesen, aber nicht geschrieben.`);
    setStatus(`Sicherung NICHT abgelegt: ${(err as Error).message}`);
  }
}

async function gegenSicherungVergleichen(f: File): Promise<void> {
  try {
    const alt = leseSicherung(await f.text());
    setStatus(`Lese das Gerät zum Vergleich mit „${f.name}" …`);
    const jetzt = await alleBloeckeLesen();
    if (!jetzt) return;
    const d = vergleicheSicherung(alt.bloecke, jetzt);
    sicherungsInfo(alt.wann ? `Sicherung vom ${new Date(alt.wann).toLocaleString("de-DE")}` : "");
    setStatus(
      d.length === 0
        ? "Kein Unterschied — das Gerät steht genau wie in der Sicherung."
        : `${d.length} Bereich(e) weichen ab: ` +
          d.map((x) => `${x.label} (${x.hinweis ?? `${x.abweichendeBytes} Byte ab +${x.ersteStelle}`})`).join(", "),
    );
  } catch (e) {
    setStatus("Vergleich fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)));
  }
}

/**
 * Timing eines Lieds messen und als Groove-Vorlage uebernehmen. Der Rest der
 * Vorlage (Name, Laenge) bleibt bearbeitbar — geschrieben wird erst auf Knopf.
 */
async function grooveAusLied(f: File): Promise<void> {
  setStatus(`Lese ${f.name} …`);
  try {
    const { pcm } = await dekodiere(f);
    setStatus("Messe Tempo und Anschläge …");
    await new Promise((r) => setTimeout(r, 0));
    const r = grooveAusAudio(pcm, 44100, { name: f.name.replace(/\.[^.]+$/, "") });
    if (r.belegteSteps === 0) {
      setStatus("Keine Anschläge gefunden — anderes Material probieren (am besten mit deutlichen Drums).");
      return;
    }
    // Auf Groove-Ansicht umschalten, falls gerade ein Preset offen war
    ($("fxpArt") as HTMLSelectElement).value = "groove";
    groove = r.groove;
    basis = basis && basis.length === GROOVE_SIZE ? basis : initGrooveBytes();
    quelleAdresse = null;
    // Aus Audio gemessen, nicht vom Geraet — die Pflicht-Lesung darf ihn
    // ebenso wenig ueberschreiben wie einen aus einer Datei geladenen Stand.
    ausDatei_imEditor = true;
    render();
    const versetzt = r.groove.steps.filter((s) => Math.abs(s.trigger) >= 4).length;
    setStatus(
      `${Math.round(r.bpm)} BPM gemessen · ${r.belegteSteps} von ${r.groove.laenge} Steps belegt · ` +
        `${versetzt} davon spürbar versetzt. Zum Schreiben erst den Ziel-Platz vom Gerät lesen.`,
    );
  } catch (e) {
    setStatus("Groove aus Lied fehlgeschlagen: " + (e instanceof Error ? e.message : String(e)));
  }
}

async function ausDatei(f: File): Promise<void> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const erwartet = istGroove() ? GROOVE_SIZE : FX_PRESET_SIZE;
  if (bytes.length !== erwartet) {
    // Die Dateien des hacktribe-Editors (.ifx/.mfx) haben dieselbe Groesse wie
    // unsere .e2fxp — ein Groessenfehler heisst hier fast immer: falsche Art
    setStatus(
      `Datei hat ${bytes.length} Bytes, erwartet sind ${erwartet}` +
        (bytes.length === FX_PRESET_SIZE || bytes.length === GROOVE_SIZE
          ? ` — oben auf „${bytes.length === GROOVE_SIZE ? "Groove-Vorlage" : "Insert- oder Master-Effekt"}“ umstellen.`
          : "."),
    );
    return;
  }
  // .mfx aus dem hacktribe-Editor ist ein Master-Preset — Art danach richten,
  // damit die Algorithmen aus der richtigen Tabelle benannt werden
  if (/\.mfx$/i.test(f.name) && !istMfx() && !istGroove()) {
    ($("fxpArt") as HTMLSelectElement).value = "mfx";
  }
  basis = bytes;
  // Aus einer Datei geladen: es gibt noch keinen Vorher-Stand vom Gerät, also
  // erst lesen lassen, bevor geschrieben werden darf. Die Lesung laesst den
  // geladenen Stand jetzt stehen (siehe `ausDatei_imEditor`).
  quelleAdresse = null;
  ausDatei_imEditor = true;
  if (istGroove()) {
    groove = decodeGroove(bytes);
    render();
    setStatus(`Groove „${groove.name}“ geladen. Zum Schreiben erst den Ziel-Platz vom Gerät lesen.`);
    return;
  }
  preset = decodeFxPreset(bytes, istMfx());
  render();
  setStatus(`„${preset.name}“ geladen. Zum Schreiben erst den Ziel-Platz vom Gerät lesen (Vorher-Stand).`);
}

/** „Groove aus Lied" gibt es nur bei Groove-Vorlagen. */
function zeigeGrooveKnopf(): void {
  document.getElementById("fxpGrooveLied")?.classList.toggle("hidden", !istGroove());
}

export function initFxPresetPanel(h: FxPresetHooks): void {
  hooks = h;
  const artSel = document.getElementById("fxpArt") as HTMLSelectElement | null;
  if (!artSel) return;
  artSel.addEventListener("change", () => {
    const slotIn = $("fxpSlot") as HTMLInputElement;
    slotIn.max = String(istGroove() ? GROOVE_WRITE_MAX : istMfx() ? MFX_PRESET_WRITE_MAX : IFX_PRESET_WRITE_MAX);
    if (Number(slotIn.value) > Number(slotIn.max)) slotIn.value = slotIn.max;
    preset = null;
    groove = null;
    basis = null;
    quelleAdresse = null;
    ausDatei_imEditor = false;
    // Leerer Startpunkt je Art, damit die Oberflaeche nicht leer wirkt
    if (istGroove()) {
      basis = initGrooveBytes();
      groove = decodeGroove(basis);
    } else {
      basis = initFxPresetBytes();
      preset = decodeFxPreset(basis);
    }
    render();
    setStatus("bereit");
    zeigeGrooveKnopf();
  });
  zeigeGrooveKnopf();
  // MIDI-Thru: versteckte Global-Einstellung aus Diskussion #189 des
  // hacktribe-Repos — im Geraetemenue gibt es sie nicht.
  const thru = (an: boolean) => {
    if (!hooks?.midi) {
      setStatus("Ohne MIDI-Verbindung nicht moeglich.");
      return;
    }
    for (const m of baueMidiThru(0, an)) hooks.midi([...m]);
    setStatus(
      `MIDI-Thru ${an ? "eingeschaltet" : "ausgeschaltet"}. Damit es bleibt: am Geraet ins Global-Menue und „Write" druecken.`,
    );
  };
  $("fxpThruAn").addEventListener("click", () => thru(true));
  $("fxpThruAus").addEventListener("click", () => thru(false));
  $("fxpRead").addEventListener("click", () => void lesen());
  $("fxpWrite").addEventListener("click", () => void schreiben());
  $("fxpUndo").addEventListener("click", () => void zurueck());
  $("fxpSave").addEventListener("click", sichern);
  $("fxpSamAdd").addEventListener("click", sammlungAufnehmen);
  $("fxpSamSpeichern").addEventListener("click", () => void sammlungSpeichern());
  $("fxpSamLaden").addEventListener("click", () => ($("fxpSamIn") as HTMLInputElement).click());
  $("fxpSamIn").addEventListener("change", () => {
    const f = ($("fxpSamIn") as HTMLInputElement).files?.[0];
    if (f) void sammlungLaden(f);
  });
  renderSammlung();
  $("fxpSichern").addEventListener("click", () => void geraetSichern());
  $("fxpSicherungZeigen").addEventListener("click", () => {
    if (letzteSicherung) void zeigeAblage(letzteSicherung);
  });
  $("fxpVergleichen").addEventListener("click", () => ($("fxpSicherungIn") as HTMLInputElement).click());
  $("fxpSicherungIn").addEventListener("change", () => {
    const f = ($("fxpSicherungIn") as HTMLInputElement).files?.[0];
    if (f) void gegenSicherungVergleichen(f);
  });
  $("fxpGrooveLied").addEventListener("click", () => ($("fxpLiedIn") as HTMLInputElement).click());
  $("fxpLiedIn").addEventListener("change", () => {
    const f = ($("fxpLiedIn") as HTMLInputElement).files?.[0];
    if (f) void grooveAusLied(f);
  });
  $("fxpFile").addEventListener("click", () => ($("fxpFileIn") as HTMLInputElement).click());
  $("fxpFileIn").addEventListener("change", () => {
    const f = ($("fxpFileIn") as HTMLInputElement).files?.[0];
    if (f) void ausDatei(f);
  });
  // Leeres Preset als Startpunkt, damit die Oberflaeche nicht leer wirkt
  preset = decodeFxPreset(initFxPresetBytes());
  basis = initFxPresetBytes();
  render();
}
