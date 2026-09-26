/**
 * The trigger graph: every trigger, every thing a trigger reads, writes or names, and the
 * links between them, built from `api.triggers.references()`. Pure — the tests build one
 * from hand-made references.
 *
 * Direction follows cause and effect. A trigger *writes* a thing (Set Switch, Set Deaths,
 * Create Unit, Victory); a thing *feeds* a trigger when a condition reads it or an action
 * uses it (the location units appear at, the text shown). So a switch set by trigger 3 and
 * tested by trigger 7 is the path `trigger 3 → switch → trigger 7`.
 */
import type { TriggerRef, TriggerRefKind, TriggerRefs } from "@scm-js/plugin-api";

/** A node's key: `t:<index>` for a trigger, `<kind>:<id>` (or `timer`) for a thing. */
export type NodeKey = string;

export interface Link {
  trigger: number;
  thing: NodeKey;
  /** `write` flows trigger → thing; `read` and `use` flow thing → trigger. */
  access: TriggerRef["access"];
  /** The references behind the link: one per condition or action, in record order. */
  refs: TriggerRef[];
}

export interface Thing {
  key: NodeKey;
  kind: TriggerRefKind;
  id: number;
  /** `memory`: the address. */
  address?: number;
  /** Links whose trigger writes this. */
  producers: Link[];
  /** Links whose trigger reads or uses this. */
  consumers: Link[];
}

export interface TriggerNode {
  key: NodeKey;
  index: number;
  owners: number[];
  inert: boolean;
  /** Links this trigger reads or uses. */
  inputs: Link[];
  /** Links this trigger writes. */
  outputs: Link[];
}

export interface Graph {
  triggers: TriggerNode[];
  things: Map<NodeKey, Thing>;
}

/** The kinds in the order lists and columns show them. */
export const KIND_ORDER: readonly TriggerRefKind[] = [
  "switch", "deaths", "memory", "timer", "resources", "score", "units", "location", "outcome", "string", "wav", "aiScript", "cuwp",
];

export const triggerKey = (index: number): NodeKey => `t:${index}`;

export function isTriggerKey(key: NodeKey): boolean {
  return key.startsWith("t:");
}

export function triggerIndexOf(key: NodeKey): number {
  return Number(key.slice(2));
}

/** The things a reference is about. Ore and gas together is both. */
export function thingKeys(ref: TriggerRef): NodeKey[] {
  switch (ref.kind) {
    case "timer": return ["timer"];
    case "memory": return [`memory:${ref.address ?? 0}`];
    case "resources": return ref.id === 2 ? ["resources:0", "resources:1"] : [`resources:${ref.id}`];
    default: return [`${ref.kind}:${ref.id}`];
  }
}

export function buildGraph(refs: readonly TriggerRefs[]): Graph {
  const things = new Map<NodeKey, Thing>();
  const triggers: TriggerNode[] = refs.map((t) => ({ key: triggerKey(t.index), index: t.index, owners: t.owners, inert: t.inert, inputs: [], outputs: [] }));
  for (const t of refs) {
    const node = triggers[t.index] ?? triggers.find((n) => n.index === t.index)!;
    const links = new Map<string, Link>();
    for (const ref of t.refs) {
      for (const key of thingKeys(ref)) {
        let thing = things.get(key);
        if (!thing) {
          thing = { key, kind: ref.kind, id: ref.kind === "resources" ? Number(key.slice(10)) : ref.id, producers: [], consumers: [] };
          if (ref.kind === "memory") thing.address = ref.address;
          things.set(key, thing);
        }
        const linkKey = `${key}|${ref.access}`;
        let link = links.get(linkKey);
        if (!link) {
          link = { trigger: t.index, thing: key, access: ref.access, refs: [] };
          links.set(linkKey, link);
          if (ref.access === "write") { node.outputs.push(link); thing.producers.push(link); }
          else { node.inputs.push(link); thing.consumers.push(link); }
        }
        link.refs.push(ref);
      }
    }
  }
  return { triggers, things };
}

/** Sort things the way lists show them: by kind, then by id. */
export function compareThings(a: Thing, b: Thing): number {
  return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id - b.id || (a.address ?? 0) - (b.address ?? 0);
}

/* ── The focus view ─────────────────────────────────────── */

/**
 * Five columns around one node, left to right in the direction things happen:
 *
 * - a trigger: what writes its inputs → its inputs → **it** → what it writes → what reads those;
 * - a thing: what the writers read → the triggers writing it → **it** → the triggers reading it → what those write.
 *
 * Each node appears once, in the column nearest the focus it qualifies for. A column
 * longer than its cap shows the first `cap` and counts the rest.
 */
export interface Neighbourhood {
  focus: NodeKey;
  /** Columns -2 … 2, index 2 being the focus. */
  columns: NodeKey[][];
  /** How many more nodes each column holds beyond what it shows. */
  hidden: number[];
  /** Every link between two shown nodes. */
  links: Link[];
}

export interface NeighbourhoodOptions {
  /** Which kinds of thing to show; the focus always shows. */
  kinds: ReadonlySet<TriggerRefKind>;
  /** Most nodes per column; one entry per column, or one for all. */
  caps: number[];
}

export function neighbourhood(graph: Graph, focus: NodeKey, options: NeighbourhoodOptions): Neighbourhood {
  const cap = (col: number) => options.caps[col] ?? options.caps[0] ?? 12;
  const visible = (key: NodeKey) => key === focus || isTriggerKey(key) || options.kinds.has(graph.things.get(key)?.kind ?? "switch");
  const placed = new Set<NodeKey>([focus]);
  const full: NodeKey[][] = [[], [], [focus], [], []];

  const place = (col: number, keys: Iterable<NodeKey>) => {
    for (const key of keys) {
      if (placed.has(key) || !visible(key)) continue;
      placed.add(key);
      full[col].push(key);
    }
  };

  const upstream = (key: NodeKey): NodeKey[] => isTriggerKey(key)
    ? (graph.triggers[triggerIndexOf(key)]?.inputs ?? []).map((l) => l.thing)
    : (graph.things.get(key)?.producers ?? []).map((l) => triggerKey(l.trigger));
  const downstream = (key: NodeKey): NodeKey[] => isTriggerKey(key)
    ? (graph.triggers[triggerIndexOf(key)]?.outputs ?? []).map((l) => l.thing)
    : (graph.things.get(key)?.consumers ?? []).map((l) => triggerKey(l.trigger));

  place(1, sortKeys(graph, upstream(focus)));
  place(3, sortKeys(graph, downstream(focus)));
  const shown = (col: number) => full[col].slice(0, cap(col));
  place(0, shown(1).flatMap(upstream));
  place(4, shown(3).flatMap(downstream));

  const columns = full.map((keys, col) => (col === 2 ? keys : keys.slice(0, cap(col))));
  // The outer columns sit next to the neighbours they connect to.
  columns[0] = byBarycentre(columns[0], columns[1], downstream);
  columns[4] = byBarycentre(columns[4], columns[3], upstream);
  const hidden = full.map((keys, col) => keys.length - columns[col].length);

  const onScreen = new Set(columns.flat());
  const links: Link[] = [];
  for (const key of onScreen) {
    if (!isTriggerKey(key)) continue;
    const t = graph.triggers[triggerIndexOf(key)];
    if (!t) continue;
    for (const link of [...t.inputs, ...t.outputs]) if (onScreen.has(link.thing)) links.push(link);
  }
  return { focus, columns, hidden, links };
}

function sortKeys(graph: Graph, keys: NodeKey[]): NodeKey[] {
  const unique = [...new Set(keys)];
  return unique.sort((a, b) => {
    const ta = isTriggerKey(a), tb = isTriggerKey(b);
    if (ta && tb) return triggerIndexOf(a) - triggerIndexOf(b);
    if (ta !== tb) return ta ? -1 : 1;
    const x = graph.things.get(a), y = graph.things.get(b);
    return x && y ? compareThings(x, y) : a.localeCompare(b);
  });
}

/** Order `keys` by the mean position of their neighbours in `inner`; ties keep their order. */
function byBarycentre(keys: NodeKey[], inner: NodeKey[], neighbours: (key: NodeKey) => NodeKey[]): NodeKey[] {
  const at = new Map(inner.map((k, i) => [k, i]));
  const score = new Map(keys.map((k, i) => {
    const hits = neighbours(k).map((n) => at.get(n)).filter((i): i is number => i !== undefined);
    return [k, hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : inner.length + i / 1000];
  }));
  return keys.map((k, i) => ({ k, i })).sort((a, b) => score.get(a.k)! - score.get(b.k)! || a.i - b.i).map((e) => e.k);
}
