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

```sh
launcher/build.sh --install
```

Builds `Complier Workflows.app`, copies it to `~/Applications` and opens it. Needs Xcode's command
line tools and macOS 14 or later.
