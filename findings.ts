/**
 * What the graph says is probably a mistake, or at least worth a look. Each finding names
 * the node to focus and the triggers involved; the words are the panel's, from the code.
 *
 * Only what the triggers themselves decide is reported. Death counts, units, ore and score
 * also change in the game (a unit dies, a worker mines), so "read but never written" is
 * not a finding for those. Switches and the countdown timer change only by trigger.
 */
import type { TriggerRecord } from "@scm-js/plugin-api";
import { compareThings, triggerKey, type Graph, type NodeKey } from "./graph";

export type FindingCode =
  /** A condition waits for a switch to be set, and nothing sets it: those triggers never fire. */
  | "switch-never-set"
  /** A condition tests a switch as cleared, and nothing sets it: the test is always true. */
  | "switch-always-cleared"
  /** Triggers set a switch and no condition ever tests it. */
  | "switch-never-read"
  /** A condition reads the countdown timer and no trigger ever starts it. */
  | "timer-never-set"
  /** Set Deaths writes a counter no condition reads. */
  | "deaths-never-read"
  /** A condition or action names a location slot the map does not have. */
  | "location-missing"
  /** A location no trigger mentions. */
  | "location-unused"
  /** The trigger is switched off. */
  | "trigger-disabled"
  /** No player owns the trigger. */
  | "trigger-no-owner"
  /** One of the trigger's conditions is Never. */
  | "trigger-never";

export type FindingLevel = "error" | "warn" | "info";

export interface Finding {
  code: FindingCode;
  level: FindingLevel;
  /** The node the finding is about, to focus in the graph. */
  focus: NodeKey;
  /** The triggers involved, by index. */
  triggers: number[];
  /** The thing's id (switch number, unit id, location slot), when it is about a thing. */
  id?: number;
}

export interface FindingContext {
  /** TRIG as the references were made from. */
  list: readonly TriggerRecord[];
  /** Which location slots are in use (Anywhere included). */
  locationInUse: (index: number) => boolean;
  /** How many location slots the map has. */
  locationCount: number;
  /** From `api.consts.triggers`: condition type Never, a Switch condition's "is set", and the two Disabled flags. */
  never: number;
  switchIsSet: number;
  triggerDisabled: number;
  conditionDisabled: number;
}

const ANYWHERE = 63;
const LEVEL_ORDER: Record<FindingLevel, number> = { error: 0, warn: 1, info: 2 };

export function findings(graph: Graph, ctx: FindingContext): Finding[] {
  const out: Finding[] = [];
  const unique = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
  const things = [...graph.things.values()].sort(compareThings);

  for (const thing of things) {
    const live = (links: typeof thing.producers) => links.filter((l) => !graph.triggers[l.trigger]?.inert && l.refs.some((r) => !r.disabled));
    const producers = live(thing.producers);
    const consumers = live(thing.consumers);
    switch (thing.kind) {
      case "switch": {
        if (producers.length === 0 && consumers.length > 0) {
          const waiting = consumers.filter((l) => l.refs.some((r) => ctx.list[l.trigger]?.conditions[r.slot]?.comparison === ctx.switchIsSet));
          if (waiting.length > 0) out.push({ code: "switch-never-set", level: "warn", focus: thing.key, id: thing.id, triggers: unique(waiting.map((l) => l.trigger)) });
          else out.push({ code: "switch-always-cleared", level: "info", focus: thing.key, id: thing.id, triggers: unique(consumers.map((l) => l.trigger)) });
        } else if (producers.length > 0 && consumers.length === 0) {
          out.push({ code: "switch-never-read", level: "info", focus: thing.key, id: thing.id, triggers: unique(producers.map((l) => l.trigger)) });
        }
        break;
      }
      case "timer":
        if (producers.length === 0 && consumers.length > 0) out.push({ code: "timer-never-set", level: "warn", focus: thing.key, id: 0, triggers: unique(consumers.map((l) => l.trigger)) });
        break;
      case "deaths":
        if (producers.length > 0 && thing.consumers.length === 0) out.push({ code: "deaths-never-read", level: "info", focus: thing.key, id: thing.id, triggers: unique(producers.map((l) => l.trigger)) });
        break;
      case "location":
        if (thing.id !== ANYWHERE && (thing.id >= ctx.locationCount || !ctx.locationInUse(thing.id))) {
          const all = [...thing.producers, ...thing.consumers];
          out.push({ code: "location-missing", level: "error", focus: thing.key, id: thing.id, triggers: unique(all.map((l) => l.trigger)) });
        }
        break;
    }
  }

  for (let i = 0; i < ctx.locationCount; i++) {
    if (i === ANYWHERE || !ctx.locationInUse(i) || graph.things.has(`location:${i}`)) continue;
    out.push({ code: "location-unused", level: "info", focus: `location:${i}`, id: i, triggers: [] });
  }

  for (const t of graph.triggers) {
    const record = ctx.list[t.index];
    if (!record) continue;
    if ((record.flags & ctx.triggerDisabled) !== 0) out.push({ code: "trigger-disabled", level: "info", focus: t.key, triggers: [t.index] });
    else if (t.owners.length === 0) out.push({ code: "trigger-no-owner", level: "warn", focus: t.key, triggers: [t.index] });
    else if (record.conditions.some((c) => c.type === ctx.never && (c.flags & ctx.conditionDisabled) === 0)) out.push({ code: "trigger-never", level: "info", focus: t.key, triggers: [t.index] });
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** A focus key for a finding that names a thing the graph does not hold (an unused location). */
export function focusable(graph: Graph, finding: Finding): NodeKey | null {
  if (finding.focus.startsWith("t:") || graph.things.has(finding.focus)) return finding.focus;
  return finding.triggers.length ? triggerKey(finding.triggers[0]) : null;
}
