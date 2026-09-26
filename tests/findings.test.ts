import { describe, expect, it } from "vitest";
import type { ConditionRecord, TriggerRecord, TriggerRef, TriggerRefs } from "@scm-js/plugin-api";
import { buildGraph } from "../graph";
import { findings, type FindingContext } from "../findings";

const IS_SET = 2, IS_CLEARED = 3, NEVER = 23;

function ref(kind: TriggerRef["kind"], access: TriggerRef["access"], id: number, extra: Partial<TriggerRef> = {}): TriggerRef {
  return { kind, access, id, part: access === "read" ? "condition" : "action", slot: 0, type: 0, players: [], ...extra };
}

function record(conditions: Partial<ConditionRecord>[] = [], flags = 0): TriggerRecord {
  const blank: ConditionRecord = { location: 0, player: 0, amount: 0, unitId: 0, comparison: 0, type: 0, resource: 0, flags: 0, mask: 0 };
  return { conditions: conditions.map((c) => ({ ...blank, ...c })), actions: [], flags, players: [1], currentAction: 0 };
}

function run(refs: TriggerRefs[], list: TriggerRecord[], locations: boolean[] = []) {
  const ctx: FindingContext = {
    list, locationCount: locations.length, locationInUse: (i) => locations[i] ?? false,
    never: NEVER, switchIsSet: IS_SET, triggerDisabled: 0x08, conditionDisabled: 0x02,
  };
  return findings(buildGraph(refs), ctx).map((f) => [f.code, f.id ?? null, f.triggers]);
}

const t = (index: number, refs: TriggerRef[], owners = [0]): TriggerRefs => ({ index, owners, groups: owners, inert: owners.length === 0, refs });

describe("findings", () => {
  it("reports a switch waited for that nothing sets", () => {
    expect(run([t(0, [ref("switch", "read", 5)])], [record([{ type: 11, comparison: IS_SET, resource: 5 }])])).toEqual([["switch-never-set", 5, [0]]]);
  });

  it("calls a cleared test of a switch nothing sets always true, which is milder", () => {
    expect(run([t(0, [ref("switch", "read", 5)])], [record([{ type: 11, comparison: IS_CLEARED, resource: 5 }])])).toEqual([["switch-always-cleared", 5, [0]]]);
  });

  it("does not count a writer that never runs", () => {
    const refs = [t(0, [ref("switch", "write", 5)], []), t(1, [ref("switch", "read", 5)])];
    const list = [record(), record([{ type: 11, comparison: IS_SET, resource: 5 }])];
    expect(run(refs, list)).toContainEqual(["switch-never-set", 5, [1]]);
  });

  it("reports a switch set and never tested, and a counter written and never read", () => {
    const out = run([t(0, [ref("switch", "write", 1), ref("deaths", "write", 60)])], [record()]);
    expect(out).toEqual([["switch-never-read", 1, [0]], ["deaths-never-read", 60, [0]]]);
  });

  it("reports the timer read and never set", () => {
    expect(run([t(0, [ref("timer", "read", 0)])], [record()])).toEqual([["timer-never-set", 0, [0]]]);
  });

  it("reports a location that is not there, and one nothing mentions, but not Anywhere", () => {
    const inUse = Array.from({ length: 64 }, (_, i) => i === 1 || i === 63);
    const out = run([t(0, [ref("location", "use", 7), ref("location", "use", 63)])], [record()], inUse);
    expect(out).toEqual([["location-missing", 7, [0]], ["location-unused", 1, []]]);
  });

  it("reports triggers that cannot run", () => {
    const refs = [t(0, []), t(1, [], []), t(2, [])];
    const list = [record([], 0x08), record(), record([{ type: NEVER }])];
    expect(run(refs, list)).toEqual([["trigger-no-owner", null, [1]], ["trigger-disabled", null, [0]], ["trigger-never", null, [2]]]);
  });
});
