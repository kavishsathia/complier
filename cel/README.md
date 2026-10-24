# CEL translation units

A unit's `.translate({...})` classifies the agent's tool calls into CSP output events with CEL
rules, the mechanism of [kavishsathia.vercel.app/tools/cel/units](https://kavishsathia.vercel.app/tools/cel/units)
brought to complier's runtime. Before any call goes through, complier proves with Google's CEL
verifier that the rules partition the calls: no call matches two rules, and every call matches a
rule or the generated fallback. Unproven units are refused.

```ts
unit(notion).translate({
  tools: ["notion-create-comment", "notion-update-page", "notion-move-pages"],
  schema: { page_id: "optional<string>", command: "optional<string>", page_or_database_ids: "optional<list<string>>" },
  assumption: "...", // a well-formed call; see units/notion.ts
  units: {
    overwrite: { when: "tool == 'notion-update-page' && command.orValue('') == 'replace_content'", emit: "overwritten", value: "page_id.value()" },
    edit: { when: "tool == 'notion-update-page' && command.orValue('') in ['update_content', ...]", emit: "edited", value: "page_id.value()" },
    // ...
  },
  fallback: { emit: "other", value: "tool" },
})
```

## The contract

- **Concrete event.** A call is `tool` (the called tool's name, always declared as `string`) plus
  every argument named in `schema`, typed in the verifier's syntax (`bool`, `int`, `uint`, `double`,
  `string`, `dyn`, `list<T>`, `map<string, V>`). An argument a call may leave out is
  `optional<T>`; it binds `optional.none()` when absent. Each JSON argument is written as a CEL
  literal and type-checked against its field by cel-java; `null`, a missing required argument or a
  wrong type is an input error. Arguments not in the schema still go upstream but don't classify.
  This binding from JSON arguments, and the `tool` field, are complier's additions to the website's
  format, whose events are typed in by hand.
- **Domain.** `tool in [tools] && assumption`. Every proof is under it, and a call outside it is
  refused, never translated.
- **Rules** (`units`): named CEL predicates over the schema, each emitting a fixed CSP event. They
  must compile against the schema and be `bool`.
- **Fallback**: the generated predicate `!(P1 || ... || Pn)`, emitting its own event (default
  `other`, distinct from every rule's). It is an ordinary event: the spec decides whether it is
  allowed, like any other. It is not allow, hide, tau or refuse.
- **Values** (complier's addition): a rule's `value` is a CEL expression over the same fields; its
  result, as JSON, is the event's value (`commented.<page id>`, `moved.["a","b"]`), as the old
  `{channel, value}` events had. Values are compiled at admission but are not part of the proof.

## Admission: what is proven

On `complier machine up`, when `complier proxy` binds, and with `complier check`, every source is
compiled, then with the verifier (all under the same schema and domain):

| check | query | admitted only if |
| --- | --- | --- |
| domain | `isSatisfiable(A)` | satisfiable (an empty domain makes every proof vacuous) |
| each pair | `isSatisfiable(A && Pi && Pj)` | not satisfiable: disjoint |
| exhaustive | `isAlwaysTrue(!A \|\| P1 \|\| ... \|\| Pn \|\| fallback)` | always true |
| fallback disjoint | `isSatisfiable(A && fallback && (P1 \|\| ... \|\| Pn))` | not satisfiable |

Also reported, not required: whether each rule ever matches and whether the fallback ever fires,
with a witness. A satisfiable overlap comes back with the solver's witness. Inconclusive answers
(approximated theories, list quantifiers past the unroll bound, solver unknown), timeouts and
errors are never admitted. Exhaustiveness isn't a tautology in CEL: a predicate that can error in
the domain (say `1000 / amount` at `amount = 0`) is a counterexample.

## Runtime

For each call of a translated tool the proxy evaluates the domain, every rule and the fallback
with cel-java's runtime: one match emits that rule's event, none the fallback's, several is an
ambiguity error (no first match wins). Input errors, rule errors and calls outside the domain are
refused. The event then goes to the machine as the role's action, exactly as before.

Unchanged: polls, readers and their diffs (plain TypeScript, not proven; the guarantee starts at
the events a diff returns), read-only polling, hidden tools (explicit trusted policy; a tool can't
be both hidden and translated), schema hash drift checks, credentials held by the proxy, and
tools neither translated nor hidden are not offered.

## Setup

```sh
cel/build.sh                      # JDK 11+ and curl; writes cel/build/backend.json
complier check units/notion.ts    # prove a unit and print the report
complier translate units/notion.ts notion-update-page '{"page_id": "p1", "command": "replace_content"}'
                                  # -> notion-update-page -> overwritten.p1
```

`build.sh` downloads `dev.cel:verifier:0.14.0` and its dependencies from Maven Central (pinned
with sha256 in `deps.txt`; Z3 4.14.1 comes as z3-turnkey's native library), plus three files of
cel-java's verifier tools package at tag v0.14.0 that the published jar leaves out, which set up
the compiler and verifier as the verifier's CLI and the website do. It compiles
`src/.../ComplierCel.java`, a stdio bridge the CLI runs as a child process. `COMPLIER_CEL` can
point the CLI at another `backend.json`. Without a working backend no translated tool is offered
and no machine with a translation starts.

## Notes

- Write predicates on optionals with `.hasValue()`, `.value()` and `.orValue()`. cel-java 0.14.0's
  verifier models `==` between optionals non-extensionally: it has optionals with value `'r'` that
  aren't `== optional.of('r')`, so such comparisons yield spurious witnesses (a fallback that seems
  to fire, a counterexample printed as `optional("r")`). In our probes real overlaps were still
  found; either way the runtime refuses any call two rules match.
- The proof is about which event a call gets, not about values: a value expression can still fail
  at runtime (then the call is refused).
