# The 30-minute loop

One Claude Code session improves a small static page in rounds, and complier keeps it going for 30
minutes. Each round: check the time, make up to 15 edits, look at the page in Chrome, commit, push,
watch CI, send a push notification, and check the time again. Under 30 minutes since the first
check, another round; otherwise the machine finishes and the session may stop.

The workflow isn't in this folder: it lives in the page's own repo,
[complier-loop-test](https://github.com/kavishsathia/complier-loop-test), under `.complier/loop`
(`workflow.csp`, `claude-code.yaml`, `chrome.yaml` and the task in `prompt.md`).

From the launcher, ⌘↩ copies this folder to `~/complier-demos/loop`, clones the page into `site/`,
pushes it to a private `complier-loop-demo` repo on your GitHub account (created the first time,
force-pushed back to the fresh page after that), and starts the `loop` machine. It opens three
Terminal windows: the page server on port 8799, the machine's log, and the agent, already given its
task.

You need the GitHub CLI signed in and Claude in Chrome connected (check with `/chrome` once the
agent's session opens). For a quick try, lower `30` in `site/.complier/loop/workflow.csp`, then run
`complier machine down loop` and `complier machine up loop .complier/loop` from `site/` again.
