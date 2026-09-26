import { describe, expect, it } from "vitest";
import type { TriggerRef, TriggerRefs } from "@scm-js/plugin-api";
import { buildGraph, neighbourhood, triggerKey, type NodeKey } from "../graph";

const ALL = new Set(["switch", "deaths", "memory", "timer", "resources", "score", "units", "location", "outcome"] as const);

function ref(kind: TriggerRef["kind"], access: TriggerRef["access"], id: number, extra: Partial<TriggerRef> = {}): TriggerRef {
  return { kind, access, id, part: access === "read" ? "condition" : "action", slot: 0, type: 0, players: [], ...extra };
}

function trig(index: number, refs: TriggerRef[], owners = [0]): TriggerRefs {
  return { index, owners, groups: owners, inert: owners.length === 0, refs };
}

// 0 sets switch 1. 1 waits for switch 1, sets switch 2 and moves location 4. 2 waits for switch 2 and wins.
const CHAIN = [
  trig(0, [ref("switch", "write", 1)]),
  trig(1, [ref("switch", "read", 1), ref("switch", "write", 2), ref("location", "write", 4)]),
  trig(2, [ref("switch", "read", 2), ref("outcome", "write", 1, { players: [0] })]),
];

describe("buildGraph", () => {
  it("links writers to things and things to readers", () => {
    const g = buildGraph(CHAIN);
    expect(g.things.get("switch:1")!.producers.map((l) => l.trigger)).toEqual([0]);
    expect(g.things.get("switch:1")!.consumers.map((l) => l.trigger)).toEqual([1]);
    expect(g.triggers[1].inputs.map((l) => l.thing)).toEqual(["switch:1"]);
    expect(g.triggers[1].outputs.map((l) => l.thing)).toEqual(["switch:2", "location:4"]);
  });

  it("folds several references to one thing into one link", () => {
    const g = buildGraph([trig(0, [ref("switch", "write", 3), { ...ref("switch", "write", 3), slot: 1 }])]);
    expect(g.triggers[0].outputs).toHaveLength(1);
    expect(g.triggers[0].outputs[0].refs).toHaveLength(2);
  });

  it("splits ore and gas together into both", () => {
    const g = buildGraph([trig(0, [ref("resources", "read", 2)])]);
    expect([...g.things.keys()].sort()).toEqual(["resources:0", "resources:1"]);
    expect(g.things.get("resources:1")!.id).toBe(1);
  });

  it("keys memory by address", () => {
    const g = buildGraph([trig(0, [ref("memory", "write", 0, { address: 0x58a364 })])]);
    expect([...g.things.keys()]).toEqual([`memory:${0x58a364}`]);
  });
});

describe("neighbourhood", () => {
  const g = buildGraph(CHAIN);
  const around = (focus: NodeKey, kinds: ReadonlySet<TriggerRef["kind"]> = ALL, caps = [10]) => neighbourhood(g, focus, { kinds, caps });

  it("puts a trigger's causes on the left and its effects on the right", () => {
    const n = around(triggerKey(1));
    expect(n.columns).toEqual([["t:0"], ["switch:1"], ["t:1"], ["switch:2", "location:4"], ["t:2"]]);
  });

  it("puts a thing's writers on the left and its readers on the right", () => {
    const n = around("switch:2");
    expect(n.columns).toEqual([["switch:1"], ["t:1"], ["switch:2"], ["t:2"], ["outcome:1"]]);
  });

  it("hides the kinds that are switched off, but never the focus", () => {
    const n = around(triggerKey(1), new Set(["switch"] as const));
    expect(n.columns[3]).toEqual(["switch:2"]);
    expect(around("location:4", new Set(["switch"] as const)).columns[2]).toEqual(["location:4"]);
  });

  it("caps a column and counts the rest", () => {
    const many = buildGraph([trig(0, Array.from({ length: 15 }, (_, i) => ref("switch", "write", i)))]);
    const n = neighbourhood(many, triggerKey(0), { kinds: ALL, caps: [4] });
    expect(n.columns[3]).toHaveLength(4);
    expect(n.hidden[3]).toBe(11);
  });

  it("shows each node once, even in a loop", () => {
    // 0 sets switch 1 and waits for switch 2; 1 waits for switch 1 and sets switch 2.
    const loop = buildGraph([
      trig(0, [ref("switch", "read", 2), ref("switch", "write", 1)]),
      trig(1, [ref("switch", "read", 1), ref("switch", "write", 2)]),
    ]);
    const n = neighbourhood(loop, triggerKey(0), { kinds: ALL, caps: [10] });
    expect(n.columns).toEqual([["t:1"], ["switch:2"], ["t:0"], ["switch:1"], []]);
    // Every link between shown nodes is drawn, the loop's way back included.
    expect(n.links.map((l) => `${l.trigger}${l.access === "write" ? ">" : "<"}${l.thing}`).sort()).toEqual(["0<switch:2", "0>switch:1", "1<switch:1", "1>switch:2"]);
  });
});
