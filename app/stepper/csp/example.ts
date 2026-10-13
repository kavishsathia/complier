export const EXAMPLE = `-- A vending machine and a customer who wants one tea.

VM = coin -> (tea -> VM [] coffee -> VM)

CUSTOMER = coin -> tea -> SKIP

MAIN = VM [| {coin, tea, coffee} |] CUSTOMER
`;
