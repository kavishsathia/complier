export const EXAMPLE = `-- A vending machine. The agent (^) pays and picks a drink; the world (~)
-- can cut the power while the machine waits for a coin.

channel ^coin, ^tea, ^coffee
channel ~power_cut

MAIN = coin -> (tea -> MAIN [] coffee -> MAIN) [] power_cut -> STOP
`;
