// The joint account walkthrough used by the docs page, one source per step.

export const naiveAccount = `-- Two assistants share one bank account.

datatype Agent = Alice | Bob
channel withdraw, settle : Agent.Int

-- The bank approves a withdrawal if it fits the balance,
-- and moves the money when the payment settles.
Account(bal) =
     withdraw?a?x:{1..bal} -> Account(bal)
  [] settle?a?x -> Account(bal - x)

-- Each assistant asks for some amount, then waits for it to settle.
Assistant(a) = withdraw!a?x -> Paying(a, x)
Paying(a, x) = settle!a!x -> Assistant(a)

System =
  (Assistant(Alice) ||| Assistant(Bob))
    [| {| withdraw, settle |} |]
  Account(100)

assert Account :[always bal >= 0]
`;

export const heldAccount = `-- Two assistants share one bank account.

datatype Agent = Alice | Bob
channel withdraw, settle : Agent.Int

-- The bank now holds approved amounts until they settle,
-- and only approves what is not already held.
Account(bal, held) =
     withdraw?a?x:{1..bal - held} -> Account(bal, held + x)
  [] settle?a?x -> Account(bal - x, held - x)

-- Each assistant asks for some amount, then waits for it to settle.
Assistant(a) = withdraw!a?x -> Paying(a, x)
Paying(a, x) = settle!a!x -> Assistant(a)

System =
  (Assistant(Alice) ||| Assistant(Bob))
    [| {| withdraw, settle |} |]
  Account(100, 0)

assert Account :[always bal >= 0]
`;
