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
import {
  baueSammlung,
  leseSammlung,
  planeVerteilung,
  nummerierePlaetze,
  PLATZ_MAX,
  type NummerierRichtung,
  type SammlungsEintrag,
} from "../core/sammlung";
import { IFX_ZAEHLER, leseZaehlerStand, istPresetPlatzLeer, planeIfxErweiterung, type ZaehlerWert } from "../core/ifxErweiterung";
import { GROOVE_ZAEHLER, istGroovePlatzLeer, istGrooveBlockUnbeschrieben, leererGrooveBlock } from "../core/firmwareBau";
import { dekodiere } from "./audioDecode";
import { legeAb, zeigeAblage } from "./ablage";
import { E2_RAM_MAP, addressForSlot, IFX_PRESET_WRITE_MAX, MFX_PRESET_WRITE_MAX } from "../core/hacktribeRam";

export interface FxPresetHooks {
  lesen(addr: number, len: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }>;
  /** true nur, wenn die Rückleseprobe den Write bestätigt hat — die Sammlungs-Reihe bricht sonst ab. */
  schreiben(addr: number, bytes: Uint8Array, was: string): Promise<boolean>;
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

/**
 * Adresse des gewaehlten Platzes aus der RAM-Karte. Das Eingabefeld zaehlt wie
 * das GERAETEMENUE ab 1 (Nutzerbefund 2026-09-01) — intern ist `slot` 0-basiert;
 * fuer alles Sichtbare gilt `slot + 1`.
 */
function adresse(): { addr: number; slot: number; max: number; len: number } | null {
  const key = istGroove() ? "groove" : istMfx() ? "mfxPreset" : "ifxPreset";
  const eintrag = E2_RAM_MAP.find((e) => e.key === key);
  if (!eintrag) return null;
  const max = istGroove() ? GROOVE_WRITE_MAX : istMfx() ? MFX_PRESET_WRITE_MAX : IFX_PRESET_WRITE_MAX;
  const slot = Math.max(0, Math.min(max, (Number(($("fxpSlot") as HTMLInputElement).value) || 1) - 1));
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
  setStatus(`Lese Platz ${ziel.slot + 1} …`);
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
      `Groove-Platz ${ziel.slot + 1} gelesen: „${gelesen.name || "(ohne Namen)"}“, ${gelesen.laenge} Steps` +
        `${rahmen ? "" : " (kein GVST-Kennzeichen — evtl. leerer Platz)"}${warnung}${nachsatz}`,
    );
    return;
  }
  const gelesen = decodeFxPreset(r.bytes, istMfx());
  if (!behalten) preset = gelesen;
  render();
  setStatus(
    `Platz ${ziel.slot + 1} gelesen: „${gelesen.name || "(ohne Namen)"}“ — ${gelesen.ifx1.algorithmus || "?"}` +
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
    setStatus(`Schreibe Groove „${groove.name}“ auf Platz ${ziel.slot + 1} …`);
    await hooks.schreiben(ziel.addr, bytes, `Groove „${groove.name}“`);
    // Editor und Geraet stehen jetzt gleich — die naechste Lesung darf den
    // Editor wieder fuellen
    ausDatei_imEditor = false;
    document.getElementById("fxpUndo")?.classList.remove("hidden");
    return;
  }
  if (!preset) return;
  const bytes = encodeFxPreset(preset, basis ?? undefined);
  setStatus(`Schreibe „${preset.name}“ auf Platz ${ziel.slot + 1} …`);
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
            `<input class="fxpSamPlatz" data-i="${i}" type="number" min="1" max="${PLATZ_MAX[e.art]}" value="${e.platz ?? ""}" placeholder="—" ` +
            `title="Ziel-Platz fürs Verteilen — zählt wie das Gerätemenü, ab 1. Leer = wird nicht geschrieben." style="width:52px;padding:2px 4px;font-size:11px" />` +
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
  for (const inp of liste.querySelectorAll<HTMLInputElement>(".fxpSamPlatz")) {
    inp.addEventListener("change", () => {
      const e = sammlung[Number(inp.dataset.i)];
      if (!e) return;
      const n = Math.round(Number(inp.value));
      e.platz = inp.value.trim() === "" || !Number.isFinite(n) ? undefined : Math.max(1, Math.min(PLATZ_MAX[e.art], n));
      if (e.platz !== undefined) inp.value = String(e.platz);
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

/** Einen Block von aussen (Preset-Manager) in den Editor holen — wie ein Sammlungs-Eintrag. */
export function oeffneImEditor(art: "ifx" | "mfx" | "groove", bytes: Uint8Array, woher: string): void {
  ($("fxpArt") as HTMLSelectElement).value = art;
  basis = bytes.slice();
  quelleAdresse = null;
  ausDatei_imEditor = true;
  if (art === "groove") {
    groove = decodeGroove(bytes);
    preset = null;
  } else {
    preset = decodeFxPreset(bytes, art === "mfx");
    groove = null;
  }
  zeigeGrooveKnopf();
  render();
  const name = art === "groove" ? groove!.name : preset!.name;
  setStatus(`„${name}" aus ${woher} geladen. Zum Schreiben erst den Ziel-Platz vom Gerät lesen — oder im Manager „Aus Editor übernehmen“.`);
}

/** Was gerade im Editor steht, als Block — Preset oder Groove-Vorlage; null bei leerem Editor. */
export function aktuellesPreset(): { art: "ifx" | "mfx" | "groove"; bytes: Uint8Array } | null {
  if (istGroove()) return groove ? { art: "groove", bytes: encodeGroove(groove, basis ?? undefined) } : null;
  if (!preset) return null;
  return { art: istMfx() ? "mfx" : "ifx", bytes: encodeFxPreset(preset, basis ?? undefined) };
}

function sammlungAufnehmen(): void {
  const gv = istGroove();
  if (gv ? !groove : !preset) return;
  const bytes = gv ? encodeGroove(groove!, basis ?? undefined) : encodeFxPreset(preset!, basis ?? undefined);
  const name = (gv ? groove!.name : preset!.name) || (gv ? "Groove" : "Preset");
  // Kam der Inhalt von einem Geraete-Platz, ist der auch der naheliegende
  // Ziel-Platz fuers Verteilen — Geraete-Zaehlung, daher +1.
  const platz = quelleAdresse !== null ? (adresse()?.slot ?? 0) + 1 : undefined;
  sammlung.push({ art: gv ? "groove" : istMfx() ? "mfx" : "ifx", name, bytes, ...(platz !== undefined ? { platz } : {}) });
  renderSammlung();
  setStatus(`„${name}" in die Sammlung gelegt (${sammlung.length} insgesamt). Zum Behalten die Sammlung sichern.`);
}

/**
 * Die Ziel-Plaetze aller Eintraege in Listen-Reihenfolge vergeben — ab dem
 * Startplatz im Feld, sonst ab dem Platz des ersten Eintrags der Art. ▲ zaehlt
 * hoch, ▼ runter; die Grenzen je Art haelt `nummerierePlaetze` ein.
 */
function sammlungNummerieren(richtung: NummerierRichtung): void {
  if (!sammlung.length) {
    setStatus("Die Sammlung ist leer — erst etwas aufnehmen oder laden.");
    return;
  }
  const feld = $("fxpSamStart") as HTMLInputElement;
  const roh = (feld.value ?? "").trim();
  const start = roh === "" ? undefined : Math.round(Number(roh));
  if (start !== undefined && (!Number.isFinite(start) || start < 1)) {
    setStatus("Der Startplatz muss eine Zahl ab 1 sein — oder leer, dann zählt die Reihe vom ersten Eintrag aus.");
    return;
  }
  const r = nummerierePlaetze(sammlung, start, richtung);
  sammlung = r.eintraege;
  renderSammlung();
  const ersterPlatz = sammlung.find((e) => e.platz !== undefined)?.platz;
  const rest = r.ohnePlatz ? ` — ${r.ohnePlatz} hinter der Art-Grenze ohne Platz geblieben` : "";
  setStatus(
    `${r.vergeben} Plätze ${richtung === "auf" ? "aufsteigend" : "absteigend"} vergeben, beginnend bei Platz ${ersterPlatz ?? "—"}${rest}.`,
  );
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

// ─── Sammlung verteilen ──────────────────────────────────────────────────────

/** Vorher-Staende des letzten Verteilungslaufs — fuers Zuruecknehmen am Stueck. */
let verteilungsVorher: { addr: number; bytes: Uint8Array }[] = [];

const artKey = (a: SammlungsEintrag["art"]): string => (a === "groove" ? "groove" : a === "mfx" ? "mfxPreset" : "ifxPreset");

/**
 * Alle Eintraege mit Ziel-Platz nacheinander aufs Geraet schreiben — je Eintrag
 * derselbe Weg wie beim Einzel-Schreiben: Platz lesen (Vorher-Stand + Unterlage
 * fuer unbekannte Bytes), dann Schreiben mit Rueckleseprobe. Der erste Fehler
 * stoppt die Reihe; was schon geschrieben ist, steht in der Meldung.
 */
async function sammlungVerteilen(): Promise<void> {
  if (!hooks) return;
  if (!sammlung.length) {
    setStatus("Die Sammlung ist leer — erst etwas aufnehmen oder laden.");
    return;
  }
  const erweitern = (document.getElementById("fxpSamErweitern") as HTMLInputElement | null)?.checked === true;
  await verteileEintraege(sammlung, erweitern);
}

/**
 * Der eine Schreibweg fuer Listen von Eintraegen — die Sammlung und der
 * Preset-Manager benutzen ihn gemeinsam. Liefert true, wenn alles geschrieben
 * (und ggf. das Menue erweitert) ist; die Vorher-Staende landen in
 * `verteilungsVorher`, damit „Alle zurückschreiben" sie zuruecknimmt.
 */
export async function verteileEintraege(eintraege: readonly SammlungsEintrag[], erweitern: boolean, vorspann = ""): Promise<boolean> {
  if (!hooks) return false;
  const plan = planeVerteilung(eintraege);
  if (plan.doppelt.length) {
    setStatus(
      `${vorspann}Nicht geschrieben — doppelt vergeben: ${plan.doppelt.map((d) => `Platz ${d.platz} (${d.art.toUpperCase()})`).join(", ")}.`,
    );
    return false;
  }
  if (!plan.schritte.length) {
    setStatus(`${vorspann}Kein Eintrag hat einen Ziel-Platz — erst Plätze vergeben (Zahlenfeld je Eintrag).`);
    return false;
  }
  verteilungsVorher = [];
  document.getElementById("fxpSamZurueck")?.classList.add("hidden");
  let nr = 0;
  for (const { eintrag } of plan.schritte) {
    nr++;
    const map = E2_RAM_MAP.find((e) => e.key === artKey(eintrag.art));
    if (!map) return false;
    const addr = addressForSlot(map, eintrag.platz! - 1);
    const len = eintrag.art === "groove" ? GROOVE_SIZE : FX_PRESET_SIZE;
    const wohin = `„${eintrag.name}“ → Platz ${eintrag.platz} (${eintrag.art.toUpperCase()})`;
    const geschafft = (): string => (nr > 1 ? ` ${nr - 1} von ${plan.schritte.length} sind schon geschrieben.` : " Nichts wurde geschrieben.");
    setStatus(`${vorspann}${nr}/${plan.schritte.length} · ${wohin}: lese Vorher-Stand …`);
    const r = await hooks.lesen(addr, len);
    if (!r.ok) {
      setStatus(`${vorspann}Abbruch bei ${wohin}: Lesen fehlgeschlagen — ${r.reason}.${geschafft()}`);
      return false;
    }
    let bytes: Uint8Array;
    if (eintrag.art === "groove") {
      // Ein leerer Groove-Platz ist lauter 0xFF — ohne Rahmen, ohne Step-Tabelle.
      // Dort wird der Block ganz geschrieben (Platz 90 am Geraet: FF → GVST).
      // Ein belegter Platz muss dagegen den erwarteten Aufbau zeigen, sonst
      // schreiben wir nicht an eine Stelle, die die Lesung nicht bestaetigt hat.
      // „Leer" heisst hier streng: lauter 0xFF. Ein Block, der weder das ist
      // noch den Groove-Aufbau zeigt (Nullen, Preset-Bytes, ein verrutschtes
      // Lesen), ist ein Grund abzubrechen — nicht ein Freibrief zum Ueberschreiben.
      const leer = istGrooveBlockUnbeschrieben(r.bytes);
      if (!leer && erkenneStepBasis(r.bytes) !== GROOVE_STEP_BASIS) {
        setStatus(`${vorspann}Abbruch bei ${wohin}: Der gelesene Block passt nicht zum erwarteten Groove-Aufbau.${geschafft()}`);
        return false;
      }
      // Ein leerer Eintrag (geloeschter Platz) wird als 0xFF-Block geschrieben —
      // der Kodierer machte aus 0xFF sonst einen namenlosen Phantom-Groove.
      bytes = istGroovePlatzLeer(eintrag.bytes)
        ? leererGrooveBlock()
        : encodeGroove(decodeGroove(eintrag.bytes), leer ? undefined : r.bytes);
    } else {
      bytes = encodeFxPreset(decodeFxPreset(eintrag.bytes, eintrag.art === "mfx"), r.bytes);
    }
    setStatus(`${vorspann}${nr}/${plan.schritte.length} · schreibe ${wohin} …`);
    const ok = await hooks.schreiben(addr, bytes, `Sammlung: „${eintrag.name}“`);
    if (ok === false) {
      // Der gelesene Vorher-Stand dieses Platzes bleibt in der Liste — wer
      // zuruecknimmt, stellt auch einen halb beschriebenen Platz wieder her.
      verteilungsVorher.push({ addr, bytes: r.bytes });
      document.getElementById("fxpSamZurueck")?.classList.remove("hidden");
      setStatus(`${vorspann}Abbruch bei ${wohin}: Schreiben nicht bestätigt (Details im RAM-Status).${geschafft()}`);
      return false;
    }
    verteilungsVorher.push({ addr, bytes: r.bytes });
  }
  const rest = plan.uebersprungen.length ? ` — ${plan.uebersprungen.length} ohne Platz übersprungen` : "";
  setStatus(`${vorspann}${plan.schritte.length} auf das Gerät verteilt${rest}. „Alle zurückschreiben“ stellt die Vorher-Stände wieder her.`);
  document.getElementById("fxpSamZurueck")?.classList.remove("hidden");

  // Auf Wunsch das Menue nachziehen: Presets hinter dem Belegungszaehler
  // sind sonst zwar im RAM, aber am Geraet unsichtbar.
  const ifxPlaetze = plan.schritte.filter((s) => s.eintrag.art === "ifx").map((s) => s.eintrag.platz!);
  if (erweitern && ifxPlaetze.length) {
    // Das Ergebnis der Erweiterung steht in der Statuszeile; die Presets
    // selbst sind geschrieben — das ist, was der Rueckgabewert sagt.
    await ifxMenueErweitern(Math.max(...ifxPlaetze), `${vorspann}${plan.schritte.length} verteilt · `);
  }
  return true;
}

/**
 * Das IFX-Menue bis `bisPlatz` (Geraete-Zaehlung, ab 1) erweitern — der Weg
 * von hacktribe `add_ifx`, nur nachtraeglich: erst die dreizehn Zaehler lesen
 * und auf Stimmigkeit pruefen, dann die neuen Plaetze lesen (keine Luecke
 * erlaubt), dann alle dreizehn schreiben, jeder mit Rueckleseprobe. Die
 * Vorher-Werte wandern in `verteilungsVorher`, damit „Alle zurückschreiben"
 * auch die Zaehler zuruecknimmt. Bricht ein Zaehler-Write ab, werden die schon
 * gesetzten sofort zurueckgeschrieben — ein halb hochgezaehlter Satz ist der
 * Zustand, den es nie geben darf.
 *
 * Alles davon lebt nur im RAM: nach dem Ausschalten zaehlt das Menue wieder
 * wie die Firmware es vorsieht. Siehe Kopf von `core/ifxErweiterung.ts`.
 */
async function ifxMenueErweitern(bisPlatz: number, vorspann = ""): Promise<boolean> {
  if (!hooks) return false;
  const map = E2_RAM_MAP.find((e) => e.key === "ifxPreset");
  if (!map) return false;
  const hex = (a: number): string => `0x${a.toString(16).toUpperCase()}`;

  setStatus(`${vorspann}lese die 13 IFX-Zähler …`);
  const gelesen: ZaehlerWert[] = [];
  for (const z of IFX_ZAEHLER) {
    const r = await hooks.lesen(z.addr, 1);
    if (!r.ok) {
      setStatus(`${vorspann}Menü nicht erweitert: Zähler ${hex(z.addr)} nicht lesbar — ${r.reason}.`);
      return false;
    }
    gelesen.push({ addr: z.addr, wert: r.bytes[0] });
  }
  const stand = leseZaehlerStand(gelesen);
  if (!stand.ok) {
    setStatus(`${vorspann}Menü nicht erweitert: ${stand.reason}. Aus- und Einschalten stellt die Zähler der Firmware wieder her.`);
    return false;
  }
  const zielMax = bisPlatz - 1;
  if (zielMax <= stand.maxIndex) {
    setStatus(`${vorspann}Platz ${bisPlatz} ist schon im Menü — es reicht bis Platz ${stand.maxIndex + 1}.`);
    return false;
  }

  // Die neuen Plaetze muessen belegt sein — sonst zeigte das Menue Leerplaetze.
  const inhalte = new Map<number, Uint8Array>();
  for (let slot = stand.maxIndex + 1; slot <= zielMax && slot <= IFX_PRESET_WRITE_MAX; slot++) {
    setStatus(`${vorspann}prüfe Platz ${slot + 1} …`);
    const r = await hooks.lesen(addressForSlot(map, slot), FX_PRESET_SIZE);
    if (!r.ok) {
      setStatus(`${vorspann}Menü nicht erweitert: Platz ${slot + 1} nicht lesbar — ${r.reason}.`);
      return false;
    }
    inhalte.set(slot, r.bytes);
  }
  const plan = planeIfxErweiterung(stand.maxIndex, zielMax, (slot) => istPresetPlatzLeer(inhalte.get(slot) ?? new Uint8Array(0)));
  if (!plan.ok) {
    setStatus(`${vorspann}Menü nicht erweitert: ${plan.reason}.`);
    return false;
  }

  const gesetzt: ZaehlerWert[] = [];
  for (const [i, w] of plan.schreiben.entries()) {
    setStatus(`${vorspann}erweitere IFX-Menü: Zähler ${i + 1}/${plan.schreiben.length} …`);
    const ok = await hooks.schreiben(w.addr, new Uint8Array([w.wert]), `IFX-Zähler ${i + 1}/${plan.schreiben.length}`);
    if (ok === false) {
      // Sofort zurueck, was schon steht — bevor irgendjemand das Menue oeffnet.
      let zurueck = 0;
      for (const g of gesetzt.reverse()) {
        const alt = gelesen.find((x) => x.addr === g.addr)!;
        if (await hooks.schreiben(alt.addr, new Uint8Array([alt.wert]), "IFX-Zähler zurück")) zurueck++;
      }
      setStatus(
        `${vorspann}Abbruch beim Zähler ${i + 1}/${plan.schreiben.length}` +
          (gesetzt.length
            ? ` — ${zurueck} von ${gesetzt.length} schon gesetzten wieder zurückgeschrieben${zurueck < gesetzt.length ? ", der Satz ist UNSTIMMIG: Gerät aus- und einschalten" : ""}.`
            : ", nichts verändert."),
      );
      return false;
    }
    gesetzt.push(w);
    verteilungsVorher.push({ addr: w.addr, bytes: new Uint8Array([gelesen.find((x) => x.addr === w.addr)!.wert]) });
  }
  document.getElementById("fxpSamZurueck")?.classList.remove("hidden");
  setStatus(
    `${vorspann}IFX-Menü erweitert: bis Platz ${stand.maxIndex + 1} → bis Platz ${bisPlatz} (${plan.neuePlaetze.length} neu). ` +
      "Gilt bis zum Ausschalten; „Alle zurückschreiben“ nimmt auch die Zähler zurück.",
  );
  return true;
}

/**
 * Das Groove-Menue bis `bisPlatz` (Geraete-Zaehlung) erweitern — die vier
 * Zaehler von hacktribe `add_groove`, nach demselben Muster wie beim IFX-Menue:
 * lesen und auf Stimmigkeit pruefen, den neuen Bereich auf Luecken pruefen
 * (leer = kein "GVST"), dann alle vier schreiben, bei Abbruch sofort zurueck.
 * Vorher-Werte landen in `verteilungsVorher`.
 */
export async function grooveMenueErweitern(bisPlatz: number, vorspann = ""): Promise<boolean> {
  if (!hooks) return false;
  const map = E2_RAM_MAP.find((e) => e.key === "groove");
  if (!map) return false;
  const hex = (a: number): string => `0x${a.toString(16).toUpperCase()}`;
  setStatus(`${vorspann}lese die 4 Groove-Zähler …`);
  const gelesen: ZaehlerWert[] = [];
  for (const z of GROOVE_ZAEHLER) {
    const r = await hooks.lesen(z.addr, 1);
    if (!r.ok) {
      setStatus(`${vorspann}Groove-Menü nicht erweitert: Zähler ${hex(z.addr)} nicht lesbar — ${r.reason}.`);
      return false;
    }
    gelesen.push({ addr: z.addr, wert: r.bytes[0] });
  }
  const max = gelesen[0].wert;
  for (const [i, z] of GROOVE_ZAEHLER.entries()) {
    const soll = z.plusEins ? max + 1 : max;
    if (gelesen[i].wert !== soll) {
      setStatus(`${vorspann}Groove-Menü nicht erweitert: Zähler widersprechen sich (${hex(z.addr)} = ${gelesen[i].wert}, erwartet ${soll}). Aus- und Einschalten stellt sie wieder her.`);
      return false;
    }
  }
  const zielMax = bisPlatz - 1;
  if (zielMax <= max) {
    setStatus(`${vorspann}Groove-Platz ${bisPlatz} ist schon im Menü — es reicht bis Platz ${max + 1}.`);
    return false;
  }
  if (zielMax >= map.count) {
    setStatus(`${vorspann}Groove-Platz ${bisPlatz} liegt über der Grenze (${map.count}).`);
    return false;
  }
  const luecken: number[] = [];
  for (let slot = max + 1; slot <= zielMax; slot++) {
    setStatus(`${vorspann}prüfe Groove-Platz ${slot + 1} …`);
    const r = await hooks.lesen(addressForSlot(map, slot), GROOVE_SIZE);
    if (!r.ok) {
      setStatus(`${vorspann}Groove-Menü nicht erweitert: Platz ${slot + 1} nicht lesbar — ${r.reason}.`);
      return false;
    }
    if (istGroovePlatzLeer(r.bytes)) luecken.push(slot + 1);
  }
  if (luecken.length) {
    setStatus(`${vorspann}Groove-Menü nicht erweitert — leer dazwischen: Platz ${luecken.join(", ")}.`);
    return false;
  }
  const gesetzt: ZaehlerWert[] = [];
  for (const [i, z] of GROOVE_ZAEHLER.entries()) {
    const wert = z.plusEins ? zielMax + 1 : zielMax;
    setStatus(`${vorspann}erweitere Groove-Menü: Zähler ${i + 1}/4 …`);
    const ok = await hooks.schreiben(z.addr, new Uint8Array([wert]), `Groove-Zähler ${i + 1}/4`);
    if (ok === false) {
      let zurueck = 0;
      for (const g of gesetzt.reverse()) {
        const alt = gelesen.find((x) => x.addr === g.addr)!;
        if (await hooks.schreiben(alt.addr, new Uint8Array([alt.wert]), "Groove-Zähler zurück")) zurueck++;
      }
      setStatus(`${vorspann}Abbruch beim Groove-Zähler ${i + 1}/4 — ${zurueck} von ${gesetzt.length} zurückgeschrieben${zurueck < gesetzt.length ? ", Satz UNSTIMMIG: Gerät aus- und einschalten" : ""}.`);
      return false;
    }
    gesetzt.push({ addr: z.addr, wert });
    verteilungsVorher.push({ addr: z.addr, bytes: new Uint8Array([gelesen[i].wert]) });
  }
  document.getElementById("fxpSamZurueck")?.classList.remove("hidden");
  setStatus(`${vorspann}Groove-Menü erweitert: bis Platz ${max + 1} → bis Platz ${bisPlatz}. Gilt bis zum Ausschalten.`);
  return true;
}

/** Der Knopf: bis zu welchem Platz? Vorschlag ist der höchste IFX-Platz der Sammlung. */
async function ifxMenueErweiternGefragt(): Promise<void> {
  const hoechster = Math.max(0, ...sammlung.filter((e) => e.art === "ifx" && e.platz !== undefined).map((e) => e.platz!));
  const antwort = await frageText("IFX-Menü erweitern bis Platz (zählt wie das Gerät, ab 1):", hoechster ? String(hoechster) : "");
  if (antwort === null || antwort.trim() === "") return;
  const bis = Math.round(Number(antwort));
  if (!Number.isFinite(bis) || bis < 1 || bis > IFX_PRESET_WRITE_MAX + 1) {
    setStatus(`Bitte einen Platz zwischen 1 und ${IFX_PRESET_WRITE_MAX + 1} angeben.`);
    return;
  }
  await ifxMenueErweitern(bis);
}

/** Die Vorher-Staende des letzten Laufs zurueckschreiben, letzter zuerst. */
async function sammlungZuruecknehmen(): Promise<void> {
  if (!hooks || !verteilungsVorher.length) {
    setStatus("Kein Vorher-Stand vorhanden — es wurde noch nichts verteilt.");
    return;
  }
  const gesamt = verteilungsVorher.length;
  for (let i = gesamt - 1; i >= 0; i--) {
    const v = verteilungsVorher[i];
    setStatus(`Schreibe Vorher-Stand ${gesamt - i}/${gesamt} zurück …`);
    const ok = await hooks.schreiben(v.addr, v.bytes, "Sammlung zurückschreiben");
    if (ok === false) {
      setStatus(`Zurückschreiben abgebrochen bei ${gesamt - i}/${gesamt} (Details im RAM-Status).`);
      return;
    }
  }
  setStatus(`${gesamt} Vorher-Stand/Stände zurückgeschrieben — das Gerät steht wieder wie vor dem Verteilen.`);
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
  $("fxpSamSchreiben").addEventListener("click", () => void sammlungVerteilen());
  $("fxpSamZurueck").addEventListener("click", () => void sammlungZuruecknehmen());
  $("fxpSamNumAuf").addEventListener("click", () => sammlungNummerieren("auf"));
  $("fxpSamNumAb").addEventListener("click", () => sammlungNummerieren("ab"));
  $("fxpSamErweiternJetzt").addEventListener("click", () => void ifxMenueErweiternGefragt());
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
