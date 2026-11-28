# dafny-before-commit

A commit is allowed only if the Dafny in the workspace's `src/` verifies. The commit's attempt starts
`check.dafny.src`; complier runs it itself, in the image `checks/dafny/Dockerfile` builds (Dafny
4.11.0 on Ubuntu 22.04, both pinned), over a read-only snapshot of `src/`. A pass allows the commit
and a fail denies it. The agent never runs the verifier and can't pick its version.

Run it from the project the agent works in (the machine's workspace is the folder it starts in):

```sh
complier machine up dafny path/to/examples/checks/dafny-before-commit
complier machine act dafny --role dev commit   # held while Dafny runs, then allowed or denied
complier machine log dafny                     # check.dafny.src started, then pass or fail
```

Dafny's output goes in the machine's log, in the `checked` entry.
