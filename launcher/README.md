# Workflow launcher

A native macOS app: a Spotlight-style panel for the workflows saved on this computer
(`~/.complier/workflows`). Press ⌃⌥Space anywhere, type to find a workflow, and copy what you need
to use it: ↩ copies the whole setup, ⌘1–⌘3 copy one command each. Esc or clicking elsewhere hides
it. It lives in the menu bar. Saved workflows are never applied from here; that stays in Claude
Code, which asks you first.

Demos that come with complier (`~/.complier/examples/<name>/launch.json`) also launch: ⌘↩ copies
the demo to `~/complier-demos/<name>`, runs its `prepare` commands (starting its machine) and opens
one Terminal window per entry in `windows`. For the two-agents demo that's the machine's log, the
writer and the reviewer, each Claude Code session already given its prompt.
`ComplierWorkflows --launch <name>` does the same without the panel.

A demo whose `launch.json` says `"tmux": true` opens as one Terminal window instead, its windows as
panes of a tmux session (`complier-<name>`), if tmux is installed. The layout comes from the demo's
spec: when its policy is built with a pattern library process that has a lead (`FanOut`,
`Dispatcher`, `Delegate`, `Consult`, `Guard`), the lead's pane takes the left side, with the
machine's log in a strip under it, and the rest of the team shares the right side equally. A fan-out's
lead is whoever acts outside its branches; a dispatcher's is its coordinator; a delegation's, an
advice or a guard's is the role whose call it is. Otherwise every agent gets an equal column over
the log. `ComplierWorkflows --topology <spec.csp>` prints who leads in a spec.

```sh
launcher/build.sh --install
```

Builds `Complier Workflows.app`, copies it to `~/Applications` and opens it. Needs Xcode's command
line tools and macOS 14 or later.
