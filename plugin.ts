/**
 * Trigger Map — a plugin for the scmJS map editor (https://github.com/scm-js/scm-js).
 *
 * The map's triggers as a graph you can walk: pick a trigger and see what it waits for,
 * which triggers set that, what it changes and which triggers read those; pick a switch,
 * a death counter, a location or Victory and see who writes it and who reads it. Next to
 * it, the findings: switches nothing sets, counters nothing reads, locations that are not
 * there, triggers that can never run.
 *
 * Everything comes from one call, `api.triggers.references()`, which says what each
 * condition and action reads, writes or names with the player groups resolved. `graph.ts`
 * turns that into nodes and links and picks the five columns around the focus;
 * `findings.ts` is the checks; `describe.ts` the words. This file is the panel, drawn as
 * plain DOM and SVG, and the ways into it: the Triggers menu, a button in the Trigger
 * Editor, the map's right-click menu and the `trigger-map.focus` command.
 */
import type { PanelHandle, PluginApi, TriggerRecord, TriggerRefKind } from "@scm-js/plugin-api";
import { kindHeading, kindLabel, playersText, refPhrase, refPlayers, thingName, triggerLine } from "./describe";
import { findings as findFindings, focusable, type Finding } from "./findings";
import {
  buildGraph, compareThings, isTriggerKey, KIND_ORDER, neighbourhood, triggerIndexOf, triggerKey,
  type Graph, type Link, type NodeKey, type Thing,
} from "./graph";
import { KO } from "./ko";

/* ── DOM ────────────────────────────────────────────────── */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "className") el.className = String(v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

/** Each kind's colour: the stripe on its nodes and the dot in the list. */
const KIND_COLOUR: Record<TriggerRefKind | "trigger", string> = {
  trigger: "#e6b95c",
  switch: "#4fd1c5",
  deaths: "#b794f4",
  memory: "#f687b3",
  timer: "#f6ad55",
  resources: "#68d391",
  score: "#9ae6b4",
  units: "#63b3ed",
  location: "#fc8181",
  outcome: "#faf089",
  string: "#a0aec0",
  wav: "#a0aec0",
  aiScript: "#cbd5e0",
  cuwp: "#90cdf4",
};

const STYLE = `
.tm { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 6px; font-size: var(--fs-sm, 11.5px); }
.tm-bar { display: flex; gap: 4px; align-items: center; }
.tm-bar .btn { min-width: 26px; padding: 0 6px; }
.tm-bar input[type=text], .tm-bar input:not([type]) { flex: 0 1 220px; min-width: 80px; }
.tm-bar .grow { flex: 1; }
.tm-trail { display: flex; gap: 2px; align-items: center; overflow: hidden; white-space: nowrap; color: var(--text-dim, #99a2b3); min-width: 0; flex: 1; }
.tm-trail a { color: var(--text-dim, #99a2b3); cursor: pointer; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.tm-trail a:hover { color: var(--text, #dde2ea); }
.tm-trail a.here { color: var(--text, #dde2ea); }
.tm-main { display: flex; flex: 1; min-height: 0; gap: 6px; }
.tm-side { width: 220px; flex: none; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--border, #2c3341); border-radius: var(--radius, 3px); background: var(--bg-1, #12151b); }
.tm-tabs { display: flex; border-bottom: 1px solid var(--border, #2c3341); }
.tm-tabs button { flex: 1; background: none; border: none; color: var(--text-dim, #99a2b3); padding: 5px 0; cursor: pointer; font: inherit; border-bottom: 2px solid transparent; }
.tm-tabs button.on { color: var(--text, #dde2ea); border-bottom-color: var(--gold, #e6b95c); }
.tm-list { flex: 1; overflow: auto; padding: 2px 0; }
.tm-list details > summary { cursor: pointer; padding: 3px 8px; color: var(--text-dim, #99a2b3); list-style: none; display: flex; gap: 6px; align-items: center; user-select: none; }
.tm-list details > summary::before { content: "▸"; font-size: 9px; width: 8px; }
.tm-list details[open] > summary::before { content: "▾"; }
.tm-list details > summary .n { margin-left: auto; color: var(--text-faint, #5d6675); font-variant-numeric: tabular-nums; }
.tm-row { display: flex; gap: 6px; align-items: center; padding: 2px 8px 2px 22px; cursor: pointer; white-space: nowrap; }
.tm-row:hover { background: var(--bg-4, #2b313e); }
.tm-row.on { background: var(--sel, #2a4a6b); }
.tm-row .name { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.tm-row .io { color: var(--text-faint, #5d6675); font-variant-numeric: tabular-nums; }
.tm-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.tm-empty-list { padding: 12px; color: var(--text-faint, #5d6675); line-height: 1.5; }
.tm-finding { display: flex; gap: 7px; padding: 5px 8px; cursor: pointer; line-height: 1.4; border-bottom: 1px solid var(--line-lo, #1d222b); }
.tm-finding:hover { background: var(--bg-4, #2b313e); }
.tm-finding .lvl { width: 7px; height: 7px; border-radius: 50%; flex: none; margin-top: 4px; }
.tm-finding .lvl.error { background: var(--danger, #e05252); }
.tm-finding .lvl.warn { background: var(--warn, #e0a545); }
.tm-finding .lvl.info { background: var(--text-faint, #5d6675); }
.tm-graph { flex: 1; min-width: 0; overflow: auto; position: relative; border: 1px solid var(--border, #2c3341); border-radius: var(--radius, 3px); background: var(--bg-0, #0a0c10); }
.tm-graph svg { display: block; }
.tm-hint { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; text-align: center; color: var(--text-faint, #5d6675); line-height: 1.5; }
.tm-hint .chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 520px; }
.tm-chip { border: 1px solid var(--border, #2c3341); border-radius: 12px; padding: 2px 10px; cursor: pointer; color: var(--text-dim, #99a2b3); background: var(--bg-2, #191d25); font: inherit; }
.tm-chip:hover { color: var(--text, #dde2ea); border-color: var(--border-strong, #3b4353); }
.tm-node { cursor: pointer; }
.tm-node rect.box { fill: var(--bg-2, #191d25); stroke: var(--border-strong, #3b4353); stroke-width: 1; }
.tm-node:hover rect.box { stroke: var(--text-dim, #99a2b3); }
.tm-node.focus rect.box { stroke: var(--gold, #e6b95c); stroke-width: 2; fill: var(--bg-3, #222732); }
.tm-node.inert { opacity: 0.55; }
.tm-node text { font-family: var(--font-ui, system-ui, sans-serif); pointer-events: none; }
.tm-node .kind { font-size: 10.5px; fill: var(--text-faint, #7a8394); letter-spacing: 0.02em; }
.tm-node .label { font-size: 12.5px; fill: var(--text, #dde2ea); }
.tm-node.more rect.box { fill: none; stroke-dasharray: 4 3; }
.tm-node.more text { fill: var(--text-dim, #99a2b3); font-size: 11px; }
.tm-edge { fill: none; stroke: #5d6675; stroke-width: 1.2; }
.tm-edge.write { stroke: #c9a24e; }
.tm-edge.use { stroke-dasharray: 4 3; }
.tm-edge.off { stroke-dasharray: 1 3; opacity: 0.6; }
.tm-edge.lit { stroke-width: 2.2; }
.tm-edge.dim, .tm-elabel.dim { opacity: 0.18; }
.tm-elabel { font-size: 11px; fill: var(--text-dim, #b3bac6); paint-order: stroke; stroke: var(--bg-0, #0a0c10); stroke-width: 3px; stroke-linejoin: round; pointer-events: none; font-family: var(--font-ui, system-ui, sans-serif); }
.tm-detail { display: flex; gap: 10px; align-items: flex-start; min-height: 64px; max-height: 150px; border: 1px solid var(--border, #2c3341); border-radius: var(--radius, 3px); padding: 6px 8px; }
.tm-detail .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; overflow: auto; max-height: 136px; }
.tm-detail .title { color: var(--text, #dde2ea); font-weight: 600; }
.tm-detail .sub { color: var(--text-dim, #99a2b3); }
.tm-detail pre { margin: 2px 0 0; font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; color: var(--text-dim, #b3bac6); white-space: pre-wrap; word-break: break-word; }
.tm-detail .acts { display: flex; flex-direction: column; gap: 4px; flex: none; }
.tm-kinds { display: flex; flex-direction: column; gap: 2px; }
`;

/* ── Drawing constants ──────────────────────────────────── */

const NODE_W = 150;
const NODE_H = 40;
/** The gaps between the five columns: wide beside the focus, where the edges carry labels. */
const GAPS = [36, 104, 104, 36];
const ROW_GAP = 10;
const PAD = 14;
/** The graph shrinks to the panel's width, but not below this, so its text stays readable; past it, it scrolls. */
const MIN_SCALE = 0.8;
/** Each column's left edge. */
const COL_X = [0, 1, 2, 3, 4].map((col) => PAD + col * NODE_W + GAPS.slice(0, col).reduce((a, b) => a + b, 0));
const DEFAULT_CAP = 10;

/* ── Settings ───────────────────────────────────────────── */

interface Settings {
  /** Kinds shown in the graph. */
  kinds: TriggerRefKind[];
  open: boolean;
  tab: "all" | "findings";
}

const DEFAULTS: Settings = {
  kinds: ["switch", "deaths", "memory", "timer", "resources", "score", "units", "location", "outcome"],
  open: false,
  tab: "all",
};

/* ── The model the panel shows ──────────────────────────── */

interface Model {
  list: TriggerRecord[];
  graph: Graph;
  findings: Finding[];
  /** Each trigger's fingerprint, to keep the focus on the same trigger across edits that move it. */
  prints: string[];
  /** Badge per trigger index for runs another plugin generated. */
  claims: Map<number, string>;
}

class TriggerMap {
  settings: Settings;
  model: Model | null = null;
  focus: NodeKey | null = null;
  /** A focus asked for before the panel had read the map (it mounts after `open` returns). */
  private pending: NodeKey | null = null;
  private back: NodeKey[] = [];
  private forward: NodeKey[] = [];
  /** How many nodes each of the five columns shows; "more…" raises one. */
  caps: number[] = [DEFAULT_CAP, DEFAULT_CAP, 1, DEFAULT_CAP, DEFAULT_CAP];
  private query = "";
  panel: PanelHandle | null = null;
  private view: View | null = null;
  private readonly style: HTMLStyleElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  readonly api: PluginApi;

  constructor(api: PluginApi) {
    this.api = api;
    const stored = api.storage.get<Partial<Settings>>("settings", {});
    this.settings = { ...DEFAULTS, ...stored, kinds: (stored.kinds ?? DEFAULTS.kinds).filter((k) => KIND_ORDER.includes(k)) };
    this.style = h("style", null, STYLE);
    document.head.append(this.style);
  }

  t = (text: string, params?: Record<string, string | number>) => this.api.i18n.t(text, params);

  save(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    this.api.storage.set("settings", this.settings);
  }

  /* ── Reading the map ── */

  /** Read the triggers again; keeps the focus on the same trigger if it moved. */
  rebuild() {
    const { api } = this;
    const old = this.model;
    if (!api.document.isOpen() || !supported(api)) {
      this.model = null;
      this.view?.render();
      return;
    }
    const list = api.triggers.list();
    const refs = api.triggers.references(list);
    const graph = buildGraph(refs);
    const scn = api.document.scenario();
    const locations = scn?.locations ?? [];
    const k = api.consts.triggers;
    const findings = findFindings(graph, {
      list,
      locationCount: locations.length,
      locationInUse: (i) => { const l = locations[i]; return !!l && (l.nameIndex !== 0 || l.left !== l.right || l.top !== l.bottom); },
      never: k.condition.Never,
      switchIsSet: k.switchState.Set,
      triggerDisabled: k.triggerFlags.Disabled,
      conditionDisabled: k.conditionFlags.Disabled,
    });
    const prints = list.map((t) => api.triggers.fingerprint(t));
    const claims = new Map<number, string>();
    for (const c of api.triggers.claims(list)) for (let i = c.start; i < c.start + c.count; i++) claims.set(i, c.badge);
    this.model = { list, graph, findings, prints, claims };

    if (old) {
      const remap = (key: NodeKey | null): NodeKey | null => {
        if (key === null || !isTriggerKey(key)) return key;
        const print = old.prints[triggerIndexOf(key)];
        const at = print === undefined ? -1 : prints.indexOf(print);
        return at >= 0 ? triggerKey(at) : null;
      };
      this.focus = remap(this.focus);
      this.back = this.back.map(remap).filter((k): k is NodeKey => k !== null);
      this.forward = this.forward.map(remap).filter((k): k is NodeKey => k !== null);
    }
    if (this.focus && !this.exists(this.focus)) this.focus = null;
    if (this.pending !== null) {
      const key = this.pending;
      this.pending = null;
      if (this.exists(key)) { this.go(key); return; }
    }
    this.view?.render();
  }

  /** Read the map again soon: a burst of events (a dialog's OK sends several) makes one rebuild. */
  schedule() {
    if (!this.panel?.isOpen()) { this.model = null; return; }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; if (!this.disposed) this.rebuild(); }, 120);
  }

  onDocument() {
    this.focus = null;
    this.back = [];
    this.forward = [];
    this.schedule();
  }

  exists(key: NodeKey): boolean {
    if (!this.model) return false;
    return isTriggerKey(key) ? triggerIndexOf(key) < this.model.list.length : this.model.graph.things.has(key);
  }

  /* ── Moving about ── */

  go(key: NodeKey | null) {
    if (key === this.focus) return;
    if (this.focus) this.back.push(this.focus);
    if (this.back.length > 100) this.back.shift();
    this.forward = [];
    this.focus = key;
    this.caps = [DEFAULT_CAP, DEFAULT_CAP, 1, DEFAULT_CAP, DEFAULT_CAP];
    this.view?.render();
  }

  goBack() {
    const key = this.back.pop();
    if (key === undefined) return;
    if (this.focus) this.forward.push(this.focus);
    this.focus = key;
    this.view?.render();
  }

  goForward() {
    const key = this.forward.pop();
    if (key === undefined) return;
    if (this.focus) this.back.push(this.focus);
    this.focus = key;
    this.view?.render();
  }

  canGoBack() { return this.back.length > 0; }
  canGoForward() { return this.forward.length > 0; }
  trail(): NodeKey[] { return [...this.back.slice(-4), ...(this.focus ? [this.focus] : [])]; }

  showMore(col: number) {
    this.caps[col] += 20;
    this.view?.render();
  }

  setQuery(q: string) {
    this.query = q;
    this.view?.renderList();
  }

  get search() { return this.query; }

  /* ── The panel ── */

  open(focus?: NodeKey | null) {
    if (!this.panel?.isOpen()) {
      this.save({ open: true });
      this.panel = this.api.ui.panel({
        title: this.t("Trigger Map"),
        width: 1080,
        height: 620,
        resizable: true,
        mount: (body) => {
          this.view = new View(this);
          body.append(this.view.root);
          this.rebuild();
          return () => { this.view = null; };
        },
        onClose: () => { this.panel = null; if (!this.disposed) this.save({ open: false }); },
      });
    } else if (!this.model) {
      this.rebuild();
    }
    if (focus === undefined || focus === null) return;
    if (this.model) { if (this.exists(focus)) this.go(focus); }
    else this.pending = focus;
  }

  toggle() {
    if (this.panel?.isOpen()) this.panel.close();
    else this.open();
  }

  relabel() {
    if (!this.panel?.isOpen()) return;
    this.panel.close();
    this.open();
  }

  /* ── Names ── */

  nodeName(key: NodeKey): string {
    const m = this.model;
    if (isTriggerKey(key)) return this.t("Trigger {n}", { n: triggerIndexOf(key) + 1 });
    const thing = m?.graph.things.get(key) ?? thingFromKey(key);
    return thing ? thingName(this.api, this.t, thing) : key;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.panel?.close();
    this.style.remove();
  }
}

/** `triggers.references` arrived after scmJS 0.5.0; an older editor has no graph to give. */
function supported(api: PluginApi): boolean {
  return typeof api.triggers.references === "function";
}

/** A thing the graph does not hold (an unused location a finding names), rebuilt from its key. */
function thingFromKey(key: NodeKey): Pick<Thing, "kind" | "id"> | null {
  const [kind, id] = key.split(":");
  if (!KIND_ORDER.includes(kind as TriggerRefKind)) return null;
  return { kind: kind as TriggerRefKind, id: Number(id) || 0 };
}

/* ── The view ───────────────────────────────────────────── */

class View {
  readonly root: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly forwardButton: HTMLButtonElement;
  private readonly trail: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly list: HTMLElement;
  private readonly graphBox: HTMLElement;
  private readonly detail: HTMLElement;
  /** Which list groups are open, by kind; kept across renders. */
  private readonly openGroups = new Set<string>(["trigger"]);

  private readonly app: TriggerMap;

  constructor(app: TriggerMap) {
    this.app = app;
    const { api, t } = app;
    const w = api.ui.widgets;
    this.backButton = w.button("◀", { title: t("Back"), onClick: () => app.goBack() });
    this.forwardButton = w.button("▶", { title: t("Forward"), onClick: () => app.goForward() });
    const search = w.text({ placeholder: t("Find a trigger, switch, unit…"), value: app.search, onChange: (v) => app.setQuery(v) });
    search.addEventListener("input", () => app.setQuery(search.value));
    this.trail = h("div", { className: "tm-trail" });
    const show = w.button(t("Show…"), { title: t("Which kinds of thing the graph shows"), onClick: () => this.kindsDialog() });
    this.tabs = h("div", { className: "tm-tabs" });
    this.list = h("div", { className: "tm-list" });
    this.graphBox = h("div", { className: "tm-graph" });
    new ResizeObserver(() => this.fit()).observe(this.graphBox);
    this.detail = h("div", { className: "tm-detail" });
    this.root = h("div", { className: "tm" },
      h("div", { className: "tm-bar" }, this.backButton, this.forwardButton, search, this.trail, show),
      h("div", { className: "tm-main" },
        h("div", { className: "tm-side" }, this.tabs, this.list),
        this.graphBox,
      ),
      this.detail,
    );
  }

  render() {
    this.backButton.disabled = !this.app.canGoBack();
    this.forwardButton.disabled = !this.app.canGoForward();
    this.renderTrail();
    this.renderTabs();
    this.renderList();
    this.renderGraph();
    this.renderDetail();
  }

  private renderTrail() {
    const { app } = this;
    const trail = app.trail();
    const parts: Node[] = [];
    trail.forEach((key, i) => {
      if (i > 0) parts.push(document.createTextNode(" › "));
      const a = h("a", { className: i === trail.length - 1 ? "here" : "", title: app.nodeName(key) }, app.nodeName(key));
      if (i < trail.length - 1) a.addEventListener("click", () => app.go(key));
      parts.push(a);
    });
    this.trail.replaceChildren(...parts);
  }

  private renderTabs() {
    const { app, t } = { app: this.app, t: this.app.t };
    const all = app.model?.findings.length ?? 0;
    const tab = (id: Settings["tab"], label: string) => {
      const b = h("button", { className: app.settings.tab === id ? "on" : "" }, label);
      b.addEventListener("click", () => { app.save({ tab: id }); this.renderTabs(); this.renderList(); });
      return b;
    };
    this.tabs.replaceChildren(
      tab("all", t("Everything")),
      tab("findings", t("Findings ({all})", { all })),
    );
  }

  renderList() {
    const { app } = this;
    const m = app.model;
    if (!m) {
      this.list.replaceChildren(h("div", { className: "tm-empty-list" }, app.api.document.isOpen() ? "" : app.t("Open a map to see its triggers.")));
      return;
    }
    if (app.settings.tab === "findings") this.renderFindings(m);
    else this.renderEverything(m);
  }

  private renderEverything(m: Model) {
    const { app, t } = { app: this.app, t: this.app.t };
    const q = app.search.trim().toLowerCase();
    const groups: HTMLElement[] = [];
    const group = (id: string, heading: string, colour: string, rows: { key: NodeKey; name: string; io: string; title?: string }[]) => {
      const hits = q ? rows.filter((r) => r.name.toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q)) : rows;
      if (hits.length === 0) return;
      const details = h("details", q || this.openGroups.has(id) ? { open: "" } : null,
        h("summary", null, h("span", { className: "tm-dot", style: `background:${colour}` }), heading, h("span", { className: "n" }, String(hits.length))));
      const fill = () => {
        if (details.childElementCount > 1) return;
        for (const r of hits.slice(0, 2000)) {
          const row = h("div", { className: `tm-row${r.key === app.focus ? " on" : ""}`, title: r.title ?? r.name },
            h("span", { className: "name" }, r.name), h("span", { className: "io" }, r.io));
          row.addEventListener("click", () => app.go(r.key));
          details.append(row);
        }
      };
      details.addEventListener("toggle", () => {
        if (details.open) { this.openGroups.add(id); fill(); } else if (!q) this.openGroups.delete(id);
      });
      if (details.open) fill();
      groups.push(details);
    };

    group("trigger", t("Triggers"), KIND_COLOUR.trigger, m.list.map((trigger, i) => {
      const node = m.graph.triggers[i];
      const line = triggerLine(app.api, trigger);
      const owners = playersText(node?.owners ?? []);
      return {
        key: triggerKey(i),
        name: `${i + 1}. ${line || owners}`,
        io: `${node?.inputs.length ?? 0}→${node?.outputs.length ?? 0}`,
        title: `${t("Trigger {n}", { n: i + 1 })} · ${owners}\n${line}`,
      };
    }));
    const byKind = new Map<TriggerRefKind, Thing[]>();
    for (const thing of m.graph.things.values()) {
      const list = byKind.get(thing.kind) ?? [];
      list.push(thing);
      byKind.set(thing.kind, list);
    }
    for (const kind of KIND_ORDER) {
      const things = (byKind.get(kind) ?? []).sort(compareThings);
      group(kind, kindHeading(t, kind), KIND_COLOUR[kind], things.map((thing) => ({
        key: thing.key,
        name: thingName(app.api, t, thing),
        io: `${thing.producers.length}→${thing.consumers.length}`,
        title: `${kindLabel(t, thing.kind)}: ${thingName(app.api, t, thing)}\n${t("Written by {w}, read or used by {r}", { w: thing.producers.length, r: thing.consumers.length })}`,
      })));
    }
    this.list.replaceChildren(...(groups.length ? groups : [h("div", { className: "tm-empty-list" }, m.list.length === 0 ? t("This map has no triggers.") : t("Nothing matches."))]));
  }

  private renderFindings(m: Model) {
    const { app, t } = { app: this.app, t: this.app.t };
    const q = app.search.trim().toLowerCase();
    const rows = m.findings.map((f) => ({ f, text: this.findingText(f) })).filter((r) => !q || r.text.toLowerCase().includes(q));
    if (rows.length === 0) {
      this.list.replaceChildren(h("div", { className: "tm-empty-list" }, m.findings.length === 0 ? t("No findings.") : t("Nothing matches.")));
      return;
    }
    this.list.replaceChildren(...rows.map(({ f, text }) => {
      const row = h("div", { className: "tm-finding" }, h("span", { className: `lvl ${f.level}` }), h("span", null, text));
      row.addEventListener("click", () => {
        const key = focusable(m.graph, f);
        if (key) app.go(key);
        if (f.code === "location-unused" && f.id !== undefined) app.api.view.goTo({ kind: "location", index: f.id });
      });
      return row;
    }));
  }

  findingText(f: Finding): string {
    const { app, t } = { app: this.app, t: this.app.t };
    const name = app.nodeName(f.focus);
    const list = f.triggers.slice(0, 6).map((i) => i + 1).join(", ") + (f.triggers.length > 6 ? "…" : "");
    const n = f.triggers.length;
    switch (f.code) {
      case "switch-never-set": return t("Nothing sets “{name}”, so {n, plural, one {trigger {list}, which waits for it, never fires} other {triggers {list}, which wait for it, never fire}}.", { name, n, list });
      case "switch-always-cleared": return t("Nothing sets “{name}”, so testing it as cleared is always true ({n, plural, one {trigger {list}} other {triggers {list}}}).", { name, n, list });
      case "switch-never-read": return t("“{name}” is set ({n, plural, one {trigger {list}} other {triggers {list}}}) but no condition tests it.", { name, n, list });
      case "timer-never-set": return t("Conditions read the countdown timer ({n, plural, one {trigger {list}} other {triggers {list}}}), but no trigger sets it.", { n, list });
      case "deaths-never-read": return t("Set Deaths changes the “{name}” counter ({n, plural, one {trigger {list}} other {triggers {list}}}), but no condition reads it.", { name, n, list });
      case "location-missing": return t("{n, plural, one {Trigger {list} names} other {Triggers {list} name}} location slot {slot}, which the map does not have.", { n, list, slot: (f.id ?? 0) + 1 });
      case "location-unused": return t("No trigger mentions the location “{name}”.", { name });
      case "trigger-disabled": return t("Trigger {list} is disabled.", { list });
      case "trigger-no-owner": return t("Trigger {list} has no players, so it never runs.", { list });
      case "trigger-never": return t("Trigger {list} has a Never condition, so it never fires.", { list });
    }
  }

  /* ── The graph ── */

  private renderGraph() {
    const { app, t } = { app: this.app, t: this.app.t };
    const m = app.model;
    const box = this.graphBox;
    if (!m) {
      const why = !supported(app.api) ? t("Trigger Map needs a newer version of scmJS than this one. Update the editor, then open the map again.")
        : app.api.document.isOpen() ? t("Reading the triggers…") : t("Open a map to see its triggers.");
      box.replaceChildren(h("div", { className: "tm-hint" }, why));
      return;
    }
    if (m.list.length === 0) {
      box.replaceChildren(h("div", { className: "tm-hint" }, t("This map has no triggers.")));
      return;
    }
    if (!app.focus) {
      box.replaceChildren(this.hint(m));
      return;
    }
    const kinds = new Set(app.settings.kinds);
    const hood = neighbourhood(m.graph, app.focus, { kinds, caps: app.caps });
    const columns = hood.columns.map((keys, col) => (hood.hidden[col] > 0 ? [...keys, `more:${col}`] : keys));
    const tallest = Math.max(1, ...columns.map((c) => c.length));
    const height = PAD * 2 + tallest * NODE_H + (tallest - 1) * ROW_GAP;
    const width = COL_X[4] + NODE_W + PAD;
    const pos = new Map<NodeKey, { x: number; y: number }>();
    columns.forEach((keys, col) => {
      const colHeight = keys.length * NODE_H + Math.max(0, keys.length - 1) * ROW_GAP;
      const top = (height - colHeight) / 2;
      keys.forEach((key, row) => pos.set(key, { x: COL_X[col], y: top + row * (NODE_H + ROW_GAP) }));
    });

    const svg = s("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": t("Trigger graph") });
    svg.append(s("defs", {},
      s("marker", { id: "tm-arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, s("path", { d: "M0,0 L8,4 L0,8 z", fill: "#7a8394" })),
      s("marker", { id: "tm-arrow-w", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, s("path", { d: "M0,0 L8,4 L0,8 z", fill: "#c9a24e" })),
    ));
    const edges = s("g");
    const labels = s("g");
    const nodes = s("g");
    svg.append(edges, labels, nodes);

    const edgeEls: { el: SVGPathElement; label: SVGTextElement | null; a: NodeKey; b: NodeKey }[] = [];
    for (const link of hood.links) {
      const tk = triggerKey(link.trigger);
      const [from, to] = link.access === "write" ? [tk, link.thing] : [link.thing, tk];
      const p = pos.get(from), q = pos.get(to);
      if (!p || !q) continue;
      const x1 = p.x + NODE_W, y1 = p.y + NODE_H / 2;
      const x2 = q.x, y2 = q.y + NODE_H / 2;
      const bend = Math.max(40, Math.abs(x2 - x1) / 2);
      const d = x2 > x1
        ? `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`
        // Backwards (a loop through the focus): out of the right side, round below, into the left.
        : `M${x1},${y1} C${x1 + 70},${y1 + 60} ${x2 - 70},${y2 + 60} ${x2},${y2}`;
      const off = link.refs.every((r) => r.disabled);
      const path = s("path", { d, class: `tm-edge ${link.access}${off ? " off" : ""}`, "marker-end": `url(#${link.access === "write" ? "tm-arrow-w" : "tm-arrow"})` });
      const phrase = this.linkPhrase(link);
      path.append(s("title", {}, `${app.nodeName(from)} → ${app.nodeName(to)}\n${phrase}`));
      edges.append(path);
      let label: SVGTextElement | null = null;
      if ((from === app.focus || to === app.focus) && phrase && x2 > x1) {
        // Halfway along, where edges fanning into or out of the focus are still apart.
        label = s("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, "text-anchor": "middle", class: "tm-elabel" }, clip(phrase, 20));
        labels.append(label);
      }
      edgeEls.push({ el: path, label, a: from, b: to });
    }

    for (const [key, { x, y }] of pos) {
      const g = s("g", { class: "tm-node", transform: `translate(${x},${y})` });
      if (key.startsWith("more:")) {
        const col = Number(key.slice(5));
        g.classList.add("more");
        g.append(s("rect", { class: "box", width: NODE_W, height: NODE_H, rx: 5 }), s("text", { x: NODE_W / 2, y: NODE_H / 2 + 4, "text-anchor": "middle" }, t("{n} more…", { n: hood.hidden[col] })));
        g.addEventListener("click", () => app.showMore(col));
        nodes.append(g);
        continue;
      }
      const { kind, label, colour, inert, title } = this.nodeFace(m, key);
      if (key === app.focus) g.classList.add("focus");
      if (inert) g.classList.add("inert");
      g.append(
        s("title", {}, title),
        s("rect", { class: "box", width: NODE_W, height: NODE_H, rx: 5 }),
        s("rect", { x: 0, y: 0, width: 4, height: NODE_H, rx: 2, fill: colour }),
        s("text", { class: "kind", x: 11, y: 15 }, clip(kind, 26)),
        s("text", { class: "label", x: 11, y: 32 }, clip(label, 21)),
      );
      g.addEventListener("click", () => app.go(key));
      g.addEventListener("dblclick", () => { if (isTriggerKey(key)) app.api.view.goTo({ kind: "trigger", index: triggerIndexOf(key) }); });
      g.addEventListener("mouseenter", () => {
        for (const e of edgeEls) {
          const on = e.a === key || e.b === key;
          e.el.classList.toggle("lit", on);
          e.el.classList.toggle("dim", !on);
          e.label?.classList.toggle("dim", !on);
        }
      });
      g.addEventListener("mouseleave", () => { for (const e of edgeEls) { e.el.classList.remove("lit", "dim"); e.label?.classList.remove("dim"); } });
      nodes.append(g);
    }
    box.replaceChildren(svg);
    this.svgSize = { width, height, focus: pos.get(app.focus) ?? null };
    this.fit();
  }

  private svgSize: { width: number; height: number; focus: { x: number; y: number } | null } | null = null;

  /** Size the graph to the box, and keep the focus in view when it still does not fit. */
  private fit() {
    const svg = this.graphBox.querySelector("svg");
    const size = this.svgSize;
    if (!svg || !size) return;
    const scale = Math.max(MIN_SCALE, Math.min(1, (this.graphBox.clientWidth - 2) / size.width));
    svg.setAttribute("width", String(Math.round(size.width * scale)));
    svg.setAttribute("height", String(Math.round(size.height * scale)));
    if (size.focus) {
      this.graphBox.scrollLeft = Math.max(0, (size.focus.x + NODE_W / 2) * scale - this.graphBox.clientWidth / 2);
      this.graphBox.scrollTop = Math.max(0, (size.focus.y + NODE_H / 2) * scale - this.graphBox.clientHeight / 2);
    }
  }

  /** No focus yet: say what to do, and offer the most connected nodes. */
  private hint(m: Model): HTMLElement {
    const { app, t } = { app: this.app, t: this.app.t };
    const degree = (key: NodeKey) => {
      if (isTriggerKey(key)) { const n = m.graph.triggers[triggerIndexOf(key)]; return (n?.inputs.length ?? 0) + (n?.outputs.length ?? 0); }
      const th = m.graph.things.get(key);
      return (th?.producers.length ?? 0) + (th?.consumers.length ?? 0);
    };
    const kinds = new Set(app.settings.kinds);
    const candidates = [...m.graph.things.values()].filter((th) => kinds.has(th.kind) && th.producers.length > 0 && th.consumers.length > 0).map((th) => th.key);
    const hubs = candidates.sort((a, b) => degree(b) - degree(a)).slice(0, 8);
    const outcomes = [...m.graph.things.values()].filter((th) => th.kind === "outcome").map((th) => th.key);
    const chip = (key: NodeKey) => {
      const thing = m.graph.things.get(key);
      const b = h("button", { className: "tm-chip" }, thing ? `${kindLabel(t, thing.kind)}: ${app.nodeName(key)}` : app.nodeName(key));
      b.addEventListener("click", () => app.go(key));
      return b;
    };
    return h("div", { className: "tm-hint" },
      h("div", null, t("Pick a trigger, or anything triggers use, from the list. The graph shows what leads to it on the left and what follows from it on the right.")),
      outcomes.length > 0 && h("div", null, t("How the game can end:")),
      outcomes.length > 0 && h("div", { className: "chips" }, ...outcomes.map(chip)),
      hubs.length > 0 && h("div", null, t("What connects the most triggers:")),
      hubs.length > 0 && h("div", { className: "chips" }, ...hubs.map(chip)),
    );
  }

  /** A node's two lines, colour, tooltip, and whether it is drawn faded. */
  private nodeFace(m: Model, key: NodeKey): { kind: string; label: string; colour: string; inert: boolean; title: string } {
    const { app, t } = { app: this.app, t: this.app.t };
    if (isTriggerKey(key)) {
      const i = triggerIndexOf(key);
      const node = m.graph.triggers[i];
      const record = m.list[i];
      const owners = playersText(node?.owners ?? []);
      const badge = m.claims.get(i);
      const line = record ? triggerLine(app.api, record) : "";
      const kind = [t("Trigger {n}", { n: i + 1 }), owners, badge].filter(Boolean).join(" · ");
      return { kind, label: line || t("(no conditions)"), colour: KIND_COLOUR.trigger, inert: node?.inert ?? false, title: `${kind}\n${line}${node?.inert ? `\n${t("Never runs: disabled, or no players.")}` : ""}` };
    }
    const thing = m.graph.things.get(key);
    if (!thing) return { kind: "", label: key, colour: "#888", inert: false, title: key };
    const name = thingName(app.api, t, thing);
    const kind = kindLabel(t, thing.kind);
    return { kind, label: name, colour: KIND_COLOUR[thing.kind], inert: false, title: `${kind}: ${name}\n${t("Written by {w}, read or used by {r}", { w: thing.producers.length, r: thing.consumers.length })}` };
  }

  /** What the link does, as its label: the first reference's phrase and players, and a count of the rest. */
  private linkPhrase(link: Link): string {
    const { app } = this;
    const m = app.model!;
    const first = link.refs[0];
    const phrase = refPhrase(app.api, app.t, m.list, link.trigger, first);
    const players = refPlayers(app.api, first);
    const more = link.refs.length > 1 ? ` (+${link.refs.length - 1})` : "";
    return `${phrase}${players ? ` · ${players}` : ""}${more}`;
  }

  /* ── The detail strip ── */

  private renderDetail() {
    const { app, t } = { app: this.app, t: this.app.t };
    const { api } = app;
    const w = api.ui.widgets;
    const m = app.model;
    const key = app.focus;
    if (!m || !key) {
      this.detail.replaceChildren(h("div", { className: "body" }, h("div", { className: "sub" },
        m ? t("{t, plural, one {# trigger} other {# triggers}} · {n, plural, one {# thing they use} other {# things they use}} · {f, plural, one {# finding} other {# findings}}", { t: m.list.length, n: m.graph.things.size, f: m.findings.length }) : "")));
      return;
    }
    const about = m.findings.filter((f) => f.focus === key || (isTriggerKey(key) && f.triggers.includes(triggerIndexOf(key)) && f.focus.startsWith("t:")));
    const notes = about.map((f) => h("div", { className: "sub" }, `• ${this.findingText(f)}`));
    if (isTriggerKey(key)) {
      const i = triggerIndexOf(key);
      const record = m.list[i];
      const node = m.graph.triggers[i];
      const text = record ? api.triggers.text.one(record) : "";
      const badge = m.claims.get(i);
      this.detail.replaceChildren(
        h("div", { className: "body" },
          h("div", { className: "title" }, [t("Trigger {n}", { n: i + 1 }), playersText(node?.owners ?? []), badge ? t("made by {badge}", { badge }) : ""].filter(Boolean).join(" · ")),
          ...notes,
          h("pre", null, text),
        ),
        h("div", { className: "acts" },
          w.button(t("Open in Trigger Editor"), { primary: true, onClick: () => api.view.goTo({ kind: "trigger", index: i }) }),
          w.button(t("Copy as text"), { onClick: () => { void navigator.clipboard?.writeText(text).then(() => api.ui.status(t("Copied trigger {n} as text.", { n: i + 1 }))); } }),
        ),
      );
      return;
    }
    const thing = m.graph.things.get(key);
    if (!thing) return;
    const name = thingName(api, t, thing);
    const acts: HTMLElement[] = [];
    if (thing.kind === "location" && thing.id !== api.consts.location.anywhere) {
      acts.push(w.button(t("Show on map"), { onClick: () => { api.view.goTo({ kind: "location", index: thing.id }); api.view.flash({ locations: [thing.id] }); } }));
    }
    const writers = [...new Set(thing.producers.map((l) => l.trigger + 1))];
    const readers = [...new Set(thing.consumers.map((l) => l.trigger + 1))];
    const range = (xs: number[]) => (xs.length === 0 ? t("none") : xs.slice(0, 12).join(", ") + (xs.length > 12 ? "…" : ""));
    this.detail.replaceChildren(
      h("div", { className: "body" },
        h("div", { className: "title" }, `${kindLabel(t, thing.kind)}: ${name}`),
        h("div", { className: "sub" }, t("Written by triggers: {list}", { list: range(writers) })),
        h("div", { className: "sub" }, t("Read or used by triggers: {list}", { list: range(readers) })),
        thing.kind === "memory" && h("div", { className: "sub" }, t("An EUD address: the triggers reach it through the death table, past the counters.")),
        ...notes,
      ),
      ...(acts.length > 0 ? [h("div", { className: "acts" }, ...acts)] : []),
    );
  }

  /* ── Which kinds show ── */

  private kindsDialog() {
    const { app, t } = { app: this.app, t: this.app.t };
    const w = app.api.ui.widgets;
    const picked = new Set(app.settings.kinds);
    const boxes = KIND_ORDER.map((kind) => w.checkbox(kindHeading(t, kind), { value: picked.has(kind), onChange: (v) => { if (v) picked.add(kind); else picked.delete(kind); } }));
    app.api.ui.dialog({
      title: t("Show in the graph"),
      size: "sm",
      mount: (body) => { body.append(h("div", { className: "tm-kinds" }, ...boxes), w.hint(t("Triggers always show. Text, sounds and AI scripts are off at first: most are used once and crowd the graph."))); },
      buttons: [
        { label: t("Cancel") },
        { label: t("OK"), primary: true, run: () => { app.save({ kinds: KIND_ORDER.filter((k) => picked.has(k)) }); this.render(); return true; } },
      ],
    });
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ── Activation ─────────────────────────────────────────── */

export default function activate(api: PluginApi): () => void {
  api.i18n.register({ ko: KO });
  const app = new TriggerMap(api);
  const t = app.t;

  api.commands.register({ id: "open", title: "Trigger Map", run: () => app.toggle() });
  // A stable name other plugins can call: `api.commands.run("trigger-map.focus", "switch:3")`.
  api.commands.register({
    id: "trigger-map.focus",
    title: "Show in Trigger Map",
    run: (target: unknown) => {
      const key = typeof target === "number" ? triggerKey(target) : typeof target === "string" ? target : null;
      app.open(key);
    },
  });
  api.menu.add("Triggers", { label: t("Trigger Map…"), command: "open" });

  // From the Trigger Editor: the selected row, after asking if closing would lose changes.
  api.ui.dialogSlot("triggerEditor", {
    mount(body, dlg) {
      body.append(api.ui.widgets.button(t("Show in Trigger Map"), {
        title: t("Close the Trigger Editor and show the selected trigger in the Trigger Map"),
        onClick: async () => {
          const selected = dlg.fields.selected?.get() ?? "";
          if (dlg.fields.modified?.get() && !(await api.ui.confirm(t("Close the Trigger Editor without applying your changes?"), { confirmLabel: t("Close without applying") }))) return;
          dlg.close();
          app.open(selected === "" ? undefined : triggerKey(Number(selected)));
        },
      }));
    },
  });

  // From the map: the location or unit under the pointer.
  const locationUnder = (ctx: { point: { px: number; py: number } | null; layer: string }) =>
    ctx.point && ctx.layer === "locations" ? api.query.locationAt(ctx.point.px, ctx.point.py) : -1;
  const unitUnder = (ctx: { point: { px: number; py: number } | null; layer: string }) => {
    if (!ctx.point || ctx.layer !== "units") return -1;
    const i = api.query.unitAt(ctx.point.px, ctx.point.py);
    return i < 0 ? -1 : api.document.scenario()?.units[i]?.unitId ?? -1;
  };
  api.contextMenu.add("viewport", {
    label: (ctx) => t("Triggers using “{name}”", { name: api.names.location(locationUnder(ctx)) }),
    visible: (ctx) => locationUnder(ctx) >= 0,
    run: (ctx) => { const i = locationUnder(ctx); app.open(`location:${i}`); },
  });
  api.contextMenu.add("viewport", {
    label: (ctx) => t("Triggers about {unit}", { unit: api.names.unit(unitUnder(ctx)) }),
    visible: (ctx) => unitUnder(ctx) >= 0 && hasThing(`units:${unitUnder(ctx)}`),
    run: (ctx) => app.open(`units:${unitUnder(ctx)}`),
  });
  /** Whether any trigger mentions units of a type — read fresh, since the panel may be shut. */
  const hasThing = (key: NodeKey) => {
    if (app.model) return app.model.graph.things.has(key);
    const id = Number(key.split(":")[1]);
    return supported(api) && api.triggers.references().some((tr) => tr.refs.some((r) => r.kind === "units" && r.id === id));
  };

  for (const event of ["triggers", "locations", "settings"] as const) api.events.on(event, () => app.schedule());
  api.events.on("document", () => app.onDocument());
  api.events.on("language", () => app.relabel());

  if (app.settings.open) app.open();
  return () => app.dispose();
}
