export const EXAMPLE = `-- The demo machine with data. INBOX holds one deletion until the writer,
-- who drafts first, is ready to take it.

channel page_deleted, deleted, recreate : {0..1}

NOTION = page_deleted?p -> NOTION

INBOX = page_deleted?p -> deleted!p -> INBOX

WRITER = draft -> deleted?p -> recreate!p -> WRITER

MAIN = NOTION [| {page_deleted} |] (INBOX [| {deleted} |] WRITER)

-- A bounded counter: guards and parameters.
COUNT(n : {0..2}) = n < 2 & up -> COUNT(n + 1) [] n > 0 & down -> COUNT(n - 1)
COUNTER = COUNT(0)

-- Termination: both sides tick before c can happen.
BOTH = (a -> SKIP ||| b -> SKIP) ; c -> STOP

-- Internal choice inside external choice.
PICK = (a -> STOP |~| b -> STOP) [] c -> SKIP
`;
