# Pattern library

Multi-agent topologies as CSP processes, for complier specs with roles. Each pattern arranges the
agents' steps, and complier holds the agents to it: a call out of turn is refused, and a call that
has to wait for other agents is held until they've acted. The pages at
[complier.dev/patterns](https://www.complier.dev/patterns) animate each one.

| pattern | process |
| --- | --- |
| Sequential pipeline | `Pipeline(<P1, P2, ..., Pn>)` |
| Coordinator/dispatcher | `Dispatcher(Route, Specialist)` |
| Parallel fan-out/gather | `FanOut(<B1, ..., Bn>, Gather)` |
| Hierarchical decomposition | `Delegate(r, x, Sub, K)` |
| Generator/critic | `GeneratorCritic(Generate, Critic)` |
| Iterative refinement | `Refinement(n, Generate, Critic, Refine)` |
| Advisor | `Consult(r, x, a, y, K)` |
| Guard | `Guard(r, x, Judge, K, P)` |

They're built from `Step(r, x)` (a phase of one call), `Judgement(r, x, Passing)` (a call whose
result passes or fails) and `Hold(r, x, H, K)` (a call answered only once `H` has run). For stating
what a policy guarantees, the library also has `Before(E, B)`, `AtMost(n, E)` and
`Alternate(E, B)`. [`patterns.csp`](patterns.csp) defines and explains them all.

## Using it

```csp
include "patterns.csp"
datatype Role = writer | critic
datatype Act = draft | review | publish
datatype Value = done | failed | pass | fail
Returns(review) = {pass, fail, failed}
Returns(_)      = {done, failed}

Policy = GeneratorCritic(Step(writer, draft), Judgement(critic, review, {pass})) ; Step(writer, publish)

assert Before({result.critic.review.pass}, {|attempt.writer.publish|}) [T= Policy

Agent  = ||| r : Role @ ControllableCHAOS(r)
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {|refuse|}>)
```

complier-fdr has the library built in (`fdr/build-complier-fdr.sh` embeds this file), so the
include needs no copy next to the spec. Only specs that declare `datatype Role` can include it.

## Examples

[`examples/`](examples) has one runnable spec per pattern. Each one's own assertion states the
pattern's guarantee, and FDR proves it at `complier machine up`; breaking the pattern gets the spec
refused on that assertion. To play one by hand:

```sh
complier machine up guard --spec patterns/examples/guard.csp
complier machine act guard --role agent send & sleep 1   # held until the judge acts
complier machine act guard --role judge review
complier machine result guard --role judge approve        # so agent's held send is allowed
complier machine result guard --role agent done
complier machine down guard
```

## What it relies on

With roles, agents act at the same time: each role has at most one call in flight, and the policy
may take other roles' attempts meanwhile. A policy may also answer an attempt only after other
agents have acted (a held call). The agent's tool call waits in its pre-tool-use hook until the
policy answers. Meanwhile, the agents whose turn it is are told, in their Stop hook, which call is
waiting on them and with what arguments.

Admission checks this per role: each role's attempts are answered before that role's next
attempt, even with other agents acting in between, and an allowed call's results are accepted
whenever they come back.
