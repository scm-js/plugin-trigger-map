# Trigger Map

A plugin for [scmJS](https://scmjs.dev/editor/), the StarCraft and Brood War map editor that
runs in the browser. It shows a map's triggers as a graph you can walk through, and lists the
places where they do not fit together.

Triggers affect each other through things they share. One trigger sets a switch and another
waits for it. One adds to a death counter and another checks it. One moves a location and
another creates units there. The Trigger Editor shows one trigger at a time, and Trigger Map
shows these connections. Pick a trigger to see what it waits for and what it changes. Pick a
switch to see every trigger that sets it and every trigger that reads it.

It needs scmJS 0.6.0 or later.

## Install

In scmJS, open **Plugins ▸ Browse Plugins…** and press **Install** next to Trigger Map. Or open
**Plugins ▸ Manage Plugins…**, paste

```
https://github.com/scm-js/plugin-trigger-map
```

and press **Add**. To pin a version, add a tag: `github:scm-js/plugin-trigger-map@v0.1.1`.

## Use

Open it with **Triggers ▸ Trigger Map…**. You can also get to it from:

- The Trigger Editor: **Show in Trigger Map** at the bottom closes the editor and
  shows the selected trigger. If you have changes you have not applied, it asks first.
- The map: on the Locations layer, right-click a location and choose **Triggers using**
  followed by its name. On the Units layer, right-click a unit whose type a trigger mentions
  and choose **Triggers about** followed by the unit's name.

### The list

**Everything** lists the triggers, then what they use, grouped by kind:

- switches and death counters
- memory addresses (EUD)
- the countdown timer, ore and gas, and scores
- units and locations
- game endings
- text, sounds and AI scripts
- unit property slots

The numbers beside each row are how many triggers write it → how many read or use it. For a
trigger, they are how many things it reads → how many it writes. The box at the top searches
every group. Click a row to show it in the graph.

A trigger is named by its Comment action if it has one, otherwise by its conditions.

### The graph

The graph has five columns, and things happen from left to right.

- For a trigger: the triggers that set up what it waits for, then what it waits for,
  then the trigger itself, then what it changes, then the triggers that read those changes.
- For a switch, counter, location or anything else: what the writing triggers wait for,
  then the triggers that write it, then the item itself, then the triggers that read or use
  it, then what those triggers change.

- Gold edges are writes (Set Switch, Set Deaths, Create Unit, Victory).
- Grey edges are reads (a condition).
- Dashed edges are uses, where an action names something without changing it, such as the
  location units are created at or the text a message shows.

The edges next to the focus say what they do: *is set*, *≥ 3*, *+ 500 · P1–P8*, *Create
Unit*. Hover over any edge for the same text, and over a node to light up its edges.

Click a node to move to it. **◀** and **▶** go back and forward, and the trail beside
them shows the last few steps. Double-click a trigger to open it in the Trigger Editor.
A column with more than ten nodes ends in **N more…**; click it to show more. Faded
triggers never run, because they are disabled or have no players.

**Show…** picks which kinds of thing the graph draws. Text, sounds and AI scripts start
off, because most are used once and crowd the graph. Triggers always show, and so does
whatever you picked.

With nothing picked, the graph offers the game endings and the things that connect the
most triggers as places to start.

### The detail strip

Under the graph is the picked item. For a trigger, it shows the trigger in the text format,
with **Open in Trigger Editor** and **Copy as text**. For anything else, it lists which
triggers write it and which read it. A location also gets **Show on map**. Findings about
the picked item are listed here too.

### Findings

The **Findings** tab lists what looks wrong. Click one to show it in the graph.

| Finding | What it means |
| --- | --- |
| Nothing sets a switch that a trigger waits for | Switches start cleared, so a trigger waiting for *is set* never fires. |
| Nothing sets a switch that is tested as cleared | The test is always true. Harmless, but often a leftover. |
| A switch is set but never tested | Something set up a switch that nothing uses. |
| The countdown timer is read but never set | The timer does not run unless a trigger sets it. |
| Set Deaths changes a counter nothing reads | Often a counter left behind after its reader was removed. |
| A trigger names a location slot the map does not have | The action or condition points at an empty slot. |
| No trigger mentions a location | Informational. Some locations are only there for the map maker. |
| A trigger is disabled, has no players, or has a Never condition | It never fires. |

Only switches and the countdown timer are checked for "read but never written". Death
counts, units, ore and scores also change during play, when a unit dies or a worker mines. A
condition on those can be true without any trigger touching them.

A writer that never runs does not count. If the only trigger that sets a switch is
disabled, the switch counts as never set.

### How players are read

Player groups are resolved against the map's forces: *Force 1* means the players in
Force 1, *All Players* means players 1 to 8, and *Current Player* means whoever owns the
trigger. *Foes*, *Allies*, *Neutral Players* and *Non Allied Victory Players* are only
settled during play, so the edge shows the group's name instead of a list of players.

A Set Deaths or Deaths with a player value past the 27 groups is an EUD memory access.
It appears as a **Memory** node with the address it reaches through the death table, and
with the mask when the record is masked (StarCraft: Remastered).

## Other plugins

Another plugin can open the map on something with the command `trigger-map.focus`:

```js
api.commands.run("trigger-map.focus", 12);            // trigger 13 (0-based index)
api.commands.run("trigger-map.focus", "switch:3");     // Switch 4
api.commands.run("trigger-map.focus", "location:0");   // the first location
```

A key is `t:<index>` for a trigger, and `<kind>:<id>` for anything else, with the kinds
and ids of `api.triggers.references()`. The countdown timer is `timer`, and a memory
address is `memory:<address>`.

## Development

```sh
npm install
npm test          # the graph, the findings, the words and the Korean catalogue
npm run typecheck
npm run build     # dist/plugin.js, the bundle the editor loads
npm run dev       # the same, rebuilt on every change
```

Serve the folder with any static server that sends `Access-Control-Allow-Origin: *` and
add its address (`http://localhost:3000/plugin.json`) in Plugins ▸ Manage Plugins….

| File | What is in it |
| --- | --- |
| `graph.ts` | The nodes and links built from `api.triggers.references()`, and the five columns around the focus. No DOM; `tests/graph.test.ts` covers it. |
| `findings.ts` | The checks. `tests/findings.test.ts` covers each one. |
| `describe.ts` | Names for nodes and the short phrases on edges, from `api.names` and `api.consts.triggers`. |
| `plugin.ts` | The panel (plain DOM and SVG), the menu item, the Trigger Editor button, the right-click items and the command. |
| `ko.ts` | The Korean catalogue; `tests/ko.test.ts` fails when a string is missing from it. |

The editor does the reading. `api.triggers.references()` says what each condition and
action reads, writes or uses, with player groups resolved. `view.goTo({ kind: "trigger",
index })` opens the Trigger Editor on a trigger, and the Trigger Editor lends its
`selected` and `modified` fields to plugin buttons. All of these are described in the
editor's [plugin guide](https://docs.scmjs.dev/plugins/).

## Licence

MIT.
