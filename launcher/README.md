# Workflow launcher

A native macOS app: a Spotlight-style panel for the workflows saved on this computer
(`~/.complier/workflows`). Press ⌃⌥Space anywhere, type to find a workflow, and copy what you need
to use it: ↩ copies the whole setup, ⌘1–⌘3 copy one command each. Esc or clicking elsewhere hides
it. It lives in the menu bar and only reads; applying a workflow stays in Claude Code, which asks
you first.

```sh
launcher/build.sh --install
```

Builds `Complier Workflows.app`, copies it to `~/Applications` and opens it. Needs Xcode's command
line tools and macOS 14 or later.
