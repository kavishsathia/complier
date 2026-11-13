---
name: complier-workflows
description: Notice when the user asks for work that looks repeatable (a sequence of steps with an order or a gate, such as "edit, run the tests, then commit"), ask whether to turn it into a complier workflow, save it on this computer once they agree, and with their separate permission apply it to this session so complier enforces it on your own tool calls. Also use when the user mentions complier workflows, or a saved workflow matches what they ask for.
---

# Complier workflows

A complier workflow is a proven rule about the order of an agent's tool calls: a CSP **spec** (which
steps may happen when) and YAML **units** (which tool calls count as which steps). Saved workflows
live in `~/.complier/workflows/<name>/` on this computer. Applying one binds **this Claude Code
session** to it: complier's hooks then check each of your tool calls against the spec and refuse the
ones that are out of turn.

Saving a workflow enforces nothing. Only `complier workflow apply` does, and only through this
plugin's hooks.

## 1. Notice, then ask

While doing the user's actual request, watch for work that is likely to come back in the same shape:

- a fixed order ("draft, get it reviewed, then publish"; "edit, test, commit");
- a gate ("never push before the tests pass"; "only post after I approve");
- something they have asked for before in the same way, or call routine ("every time", "as usual").

Finish or continue their task first; don't interrupt it with a long proposal. Then ask once, briefly:

> This looks repeatable: *edit → run the tests → commit only once they pass*. Want me to save it as a
> complier workflow, so it can be enforced on me next time?

If they say no or don't answer, drop it. Don't create, save or apply anything without a yes. A yes to
saving is not a yes to applying, and neither is permission for anything else.

Before proposing a new one, run `complier workflow ls`: if a saved workflow already fits, offer to
apply that one instead.

## 2. Check complier can run

```sh
complier doctor
```

It needs complier itself, Java 11+ (the CEL verifier) and the user's own licensed FDR. If a line shows
✗, tell the user which part is missing and point them to complier's README; you can still draft the
workflow for them, but it can't be saved (saving proves it) or applied until `doctor` says `ready`.

## 3. Draft it

Write a spec and units in a scratch folder outside the user's project, e.g.
`/tmp/complier-workflow-<name>/`. Keep the workflow general: steps, not this task's file names.

**Spec** (`policy.csp`, exactly one `.csp` in the folder): a `datatype Act` listing the steps, a
`datatype Value` for results, `Returns`, and a `Policy` built from `Permit(act, \ v @ Next)` (allow,
then continue with the result `v`), `Deny(act, Next)`, external choice `[]`, `if ... then ... else`,
and `SKIP` when the work is done. Then define the agent and the system explicitly, exactly as in
the template's last two definitions: `Agent = ControllableCHAOS` (the most general agent) and
`System`, that agent against `ComplierGuard(Policy)`. complier refuses a spec without them, or
with any other agent or system. Template, from complier's `examples/workflows/test-before-commit`:

```csp
datatype Act = edit | test | commit | other
datatype Value = done | failed
Returns(_) = {done, failed}

Policy = Untested

Untested =
     Permit(edit, \ _ @ Untested)
  [] Permit(other, \ _ @ Untested)
  [] Permit(test, \ v @ if v == done then Tested else Untested)
  [] Deny(commit, Untested)

Tested =
     Permit(edit, \ _ @ Untested)
  [] Permit(other, \ _ @ Tested)
  [] Permit(test, \ v @ if v == done then Tested else Untested)
  [] Permit(commit, \ v @ if v == done then SKIP else Tested)

Agent  = ControllableCHAOS
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {refuse}>)
```

End the policy with `SKIP` once the workflow's goal is reached: that is what releases the session.
Every state should permit a catch-all step (`other`), or you will be stuck on ordinary commands.

**Units** (`*.yaml`): one per service whose tools the steps use. Name a service complier ships
(`claude-code` for your built-in tools, `notion`, `claude-in-chrome`), not a path. Each rule says
which calls are which step, in CEL; complier proves that no call matches two rules and that every call
matches a rule or the fallback:

```yaml
service: claude-code
translate:
  tools: [Bash, Edit, Write, NotebookEdit]
  schema:
    command: optional<string>
  rules:
    edit:
      when: tool != 'Bash'
      emit: edit
    test:
      when: tool == 'Bash' && (command.orValue('').contains('cargo test') || command.orValue('').contains('npm test'))
      emit: test
    commit:
      when: >-
        tool == 'Bash' && command.orValue('').contains('git commit')
          && !(command.orValue('').contains('cargo test') || command.orValue('').contains('npm test'))
      emit: commit
  fallback:
    emit: other
  results:
    default: "ok ? 'done' : 'failed'"
hidden: [Read, ToolSearch]
```

While a workflow is applied, a built-in tool its `claude-code` unit neither translates nor hides is
blocked, and so is every MCP tool no unit covers. List every tool the work needs. `hidden` may only
name tools the service marks read-only (for `claude-code`: Read, LSP, ToolSearch, ListAgents,
TaskStop, CronList).

Check the drafts as you go; both print what they proved or why they failed:

```sh
complier verify /tmp/complier-workflow-<name>/policy.csp
complier check /tmp/complier-workflow-<name>/claude-code.yaml
```

## 4. Save it (after the user's yes)

```sh
complier workflow save <name> /tmp/complier-workflow-<name> \
  --description "<what it makes the agent do>" \
  --noticed "<the request that looked repeatable>"
```

Claude Code asks the user to confirm this command. `save` proves the spec with FDR and every unit with
the CEL verifier, and saves nothing that fails; fix the draft and run it again. `--noticed` records
where the workflow came from, so the user can later see which kinds of work produce workflows.
Overwriting an existing workflow needs `--replace`, and the user's agreement.

Tell the user it's saved and where, and that it isn't enforced yet.

## 5. Apply it to this session (separate permission)

Ask before applying, and say what it will mean:

> Apply *test-before-commit* to this session now? Until a tested commit finishes it, complier will
> refuse my tool calls that are out of order, block tools the workflow doesn't list, and keep me
> working instead of ending my turn. You can stop it any time from your own terminal with
> `complier workflow release test-before-commit`.

Only on a yes:

```sh
complier workflow apply <name>
```

Claude Code asks the user to confirm this too. It binds the session it runs in (Claude Code gives it
`CLAUDE_CODE_SESSION_ID`). Report its output as it is: what's checked and what's allowed now.

Then do the work. A refusal from complier is the workflow telling you what has to happen first; follow
it, don't route around it. You can't release, edit or stop the workflow yourself; if you're stuck,
say so and ask the user to run `complier workflow release <name>`. When the policy reaches `SKIP`, the
session is let go automatically.

## Commands

| command | what it does |
| --- | --- |
| `complier workflow ls` | saved workflows, and which are applied |
| `complier workflow show <name>` | a workflow's description, spec and units |
| `complier workflow save <name> <dir> --description ...` | prove and save a draft |
| `complier workflow apply <name>` | enforce it on this session |
| `complier workflow release <name>` | stop it (the user runs this) |
| `complier workflow rm <name>` | delete a saved workflow |
