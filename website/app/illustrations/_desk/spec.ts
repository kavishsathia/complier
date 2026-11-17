// complier for the order desk: one fulfilment agent, in complier's current syntax: the translation unit
// (YAML with CEL rules) names each tool call's action, and the policy (CSP) says which actions
// may happen when. Both are what `complier machine up` loads; the unit has no `service:` line,
// as the landing page's playground leaves it out.
//
// As in the deck's spec, an accept carries the order's quantity and the policy tracks the stock
// and the minimum: it takes accept.q only while stock - q stays at or above the minimum. The unit
// reads each order's quantity from the desk's six orders (model.ts), and the desk's reply to
// set_minimum_inventory gives the policy its new minimum.

export const UNIT = `# Which desk calls count as which policy actions.
translate:
  tools: [accept_order, reject_order, set_minimum_inventory]
  schema:
    id: optional<int>
    value: optional<int>
  # Accepts name one of the desk's six orders; a new minimum
  # carries its value, at most 100.
  assumption: >-
    tool == 'accept_order' ? id.orValue(0) in [1, 2, 3, 4, 5, 6] :
    tool == 'set_minimum_inventory' ? value.orValue(101) <= 100 : true
  rules:
    # Accepting an order carries the order's quantity, read from
    # the desk: Acme Co 15, Brightline 25, Northwind 10,
    # Harbor Foods 20, Kestrel Labs 15, Northwind 12.
    accept_10:
      when: tool == 'accept_order' && id.value() == 3
      emit: accept.10
    accept_12:
      when: tool == 'accept_order' && id.value() == 6
      emit: accept.12
    accept_15:
      when: tool == 'accept_order' && id.value() in [1, 5]
      emit: accept.15
    accept_20:
      when: tool == 'accept_order' && id.value() == 4
      emit: accept.20
    accept_25:
      when: tool == 'accept_order' && id.value() == 2
      emit: accept.25
    reject:
      when: tool == 'reject_order'
      emit: reject
      value: id.orValue(0)
    set_minimum:
      when: tool == 'set_minimum_inventory' && value.value() >= 20
      emit: set_minimum
      value: value.value()
    lower_minimum:
      when: tool == 'set_minimum_inventory' && value.value() < 20
      emit: lower_minimum
      value: value.value()
  results:
    # The desk's reply says its minimum; the policy keeps it.
    set_minimum: "ok ? 'minimum.' + regex.extract(output, 'Minimum inventory: ([0-9]+)').value() : 'failed'"
    default: "ok ? 'done' : 'failed'"
`;

export const POLICY = `-- The fulfilment agent's calls, as the translation unit names them.
-- Accepting an order carries the order's quantity.
datatype Act = accept.{10, 12, 15, 20, 25} | reject | set_minimum | lower_minimum
datatype Value = done | failed | minimum.{20..100}
Returns(set_minimum) = {| minimum, failed |}
Returns(_) = {done, failed}

-- Inventory tracks stock and the minimum. Accepts keep
-- stock >= min, and min never drops below 20.
Policy = Inventory(100, 20)
Inventory(stock, min) =
     ([] q : {10, 12, 15, 20, 25} @ q <= stock - min & Permit(accept.q, \\ _ @ Inventory(stock - q, min)))
  [] Permit(reject, \\ _ @ Inventory(stock, min))
  [] Permit(set_minimum, \\ v @ Minimum(stock, min, v))
  [] Deny(lower_minimum, Inventory(stock, min))

-- The desk reports its new minimum in set_minimum's result.
Minimum(stock, _, minimum.m) = Inventory(stock, m)
Minimum(stock, min, _) = Inventory(stock, min)

Agent  = ControllableCHAOS
System = prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy),
                    <{|attempt|}, {refuse}>)
`;
