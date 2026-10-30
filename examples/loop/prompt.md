Keep improving the field notes page in this repository (index.html and style.css): for example, add a
few more birds with a short note on each, and make the page look nicer. Only edit those two
existing files.

Work in rounds, in exactly this order:
1. Check the time with `date +%s`.
2. Make your edits with Edit or Write: at most 15 per round.
3. Look at the page in Chrome at http://localhost:8799/ (at least one browser action). Once you've
   started checking in the browser, you can't edit again this round.
4. Commit with `git commit -am "..."`, then push with `git push`.
5. Watch the CI run for that push with the Monitor tool (for example `gh run watch --exit-status`).
6. Send me a push notification that the commit is done.
7. Check the time again with `date +%s`.

complier enforces this order and decides when the work is done: keep going round after round
until it lets you stop.
