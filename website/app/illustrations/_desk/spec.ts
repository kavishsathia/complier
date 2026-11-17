// complier for the order desk: one fulfilment agent, in complier's current syntax: the translation unit
// (YAML with CEL rules) names each tool call's action, and the policy (CSP) says which actions
// may happen when. Both are what `complier machine up` loads; the unit has no `service:` line,
// as the landing page's playground leaves it out.

export const UNIT = `# Which desk calls count as which policy actions.
translate:
  tools: [accept_order, reject_order, set_minimum_inventory]
  schema:
    id: optional<int>
    value: optional<int>
  # Orders are named by id; a new minimum carries its value.
  assumption: "tool == 'set_minimum_inventory' ? value.hasValue() : id.hasValue()"
  rules:
    accept:
      when: tool == 'accept_order'
      emit: accept
      value: id.value()
    reject:
      when: tool == 'reject_order'
      emit: reject
      value: id.value()
    set_minimum:
      when: tool == 'set_minimum_inventory' && value.value() >= 20
      emit: set_minimum
      value: value.value()
    lower_minimum:
      when: tool == 'set_minimum_inventory' && value.value() < 20
      emit: lower_minimum
      value: value.value()
  results:
    default: "ok ? 'done' : 'failed'"
`;

export const POLICY = `-- The fulfilment agent's calls, as the translation unit names them.
datatype Act = accept | reject | set_minimum | lower_minimum
datatype Value = done | failed
Returns(_) = {done, failed}

-- The fulfiller may take any action in any order, but the
-- minimum inventory never drops below 20: lowering it is denied.
Policy = Desk
Desk = Permit(accept, \\ _ @ Desk)
    [] Permit(reject, \\ _ @ Desk)
    [] Permit(set_minimum, \\ _ @ Desk)
    [] Deny(lower_minimum, Desk)

Agent  = ControllableCHAOS
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {refuse}>)
`;
