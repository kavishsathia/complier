// complier for the order desk with two fulfilment agents, in complier's current syntax: the translation unit
// (YAML with CEL rules) names each tool call's action, and the policy (CSP) says which actions
// may happen when. Both are what `complier machine up` loads; the unit has no `service:` line,
// as the landing page's playground leaves it out.

export const UNIT = `# Which desk calls count as which policy actions.
translate:
  tools: [next_order, send_to_recipient, reject_order]
  schema:
    name: optional<string>
    quantity: optional<int>
  # Sending and rejecting name the customer.
  assumption: tool == 'next_order' || name.hasValue()
  rules:
    next:
      when: tool == 'next_order'
      emit: next
    send:
      when: tool == 'send_to_recipient'
      emit: send
      value: name.value()
    reject:
      when: tool == 'reject_order'
      emit: reject
      value: name.value()
  results:
    default: "ok ? 'done' : 'failed'"
`;

export const POLICY = `-- Two roles, one agent each. Each reads the next
-- order, then sends or rejects it.
datatype Role = agent_a | agent_b
datatype Act = next | send | reject
datatype Value = done | failed
Returns(_) = {done, failed}

-- The lock both roles share: after a read, no other read
-- until the reader sends or rejects that order.
Policy = Free
Free = Permit(agent_a, next, \\ _ @ Held(agent_a))
    [] Permit(agent_b, next, \\ _ @ Held(agent_b))
Held(r) = Permit(r, send, \\ _ @ Free)
       [] Permit(r, reject, \\ _ @ Free)

Agent  = ||| r : Role @ ControllableCHAOS(r)
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {|refuse|}>)
`;
