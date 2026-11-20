// The pattern pages' content: what each topology is, how complier holds agents to it, where its
// agents sit in the animation, and the flow the animation plays and the commands replay. Each step
// says what the policy does with it (`expect`); patterns.test.ts checks that against the daemon.

import type { Outcome } from "../engine.ts";

export type Step =
  // The agent in `role` attempts `act`, as its hook would after translating a tool call.
  | { role: string; act: string; expect: Outcome; say: string }
  // The agent's call in flight comes back with `result`.
  | { role: string; result: string; say: string };

export type Node = { role: string; x: number; y: number };

export type Pattern = {
  slug: string;
  name: string;
  short: string;
  // What the topology is, in a few sentences.
  what: string;
  // What complier makes of it: what's enforced, and how.
  enforced: string;
  // The library process, as a spec writes it, and what its arguments are.
  call: string;
  // The library definitions behind it (patterns/patterns.csp), by name.
  defines: string[];
  args: string;
  // The guarantee the example's own assertion states, in words.
  guarantee: string;
  // The animation's stage: where each agent sits (its centre, in a 720 x 250 area above the machine;
  // no two share a column, as calls travel straight down), and which agents hand work to which.
  nodes: Node[];
  links: [string, string][];
  steps: Step[];
};

export const PATTERNS: Pattern[] = [
  {
    slug: "pipeline",
    defines: ["Pipeline"],
    name: "Sequential pipeline",
    short: "Each agent picks up where the one before it left off.",
    what: "Agents work on the same job in a fixed order: a parser turns a document into text, an extractor pulls the data out of it, and a summariser writes it up. Each stage hands over to the next once its part is done.",
    enforced: "Every agent can call its tools at any time, so the order is only an instruction until something checks it. Here an agent that starts early is refused, and a stage whose call fails tries again instead of passing broken work on, because the next stage's turn only comes after a success.",
    call: "Pipeline(<Stage(parser, parse), Stage(extractor, extract), Stage(summariser, summarise)>)",
    args: "Pipeline takes a sequence of phases and runs them in order, each starting once the one before it has ended. The example's Stage(r, x) is a phase that ends only when r's call x succeeds.",
    guarantee: "The extractor never acts before the parser's parse has succeeded, and the summariser never before the extractor's extract has.",
    nodes: [
      { role: "parser", x: 120, y: 110 },
      { role: "extractor", x: 360, y: 110 },
      { role: "summariser", x: 600, y: 110 },
    ],
    links: [
      ["parser", "extractor"],
      ["extractor", "summariser"],
    ],
    steps: [
      { role: "extractor", act: "extract", expect: "refused", say: "The extractor tries to start before there's anything to extract. Refused: it isn't its turn, and the policy stays where it was." },
      { role: "parser", act: "parse", expect: "allowed", say: "The parser parses." },
      { role: "parser", result: "failed", say: "The parse fails. A stage hands over only on success, so it's still the parser's turn." },
      { role: "parser", act: "parse", expect: "allowed", say: "The parser tries again." },
      { role: "parser", result: "done", say: "This time it succeeds, and the extractor's turn begins." },
      { role: "extractor", act: "extract", expect: "allowed", say: "The extractor extracts." },
      { role: "extractor", result: "done", say: "Done: over to the summariser." },
      { role: "summariser", act: "summarise", expect: "allowed", say: "The summariser writes it up." },
      { role: "summariser", result: "done", say: "The last stage has ended, so the policy finishes." },
    ],
  },
  {
    slug: "dispatcher",
    defines: ["Dispatcher"],
    name: "Coordinator/dispatcher",
    short: "One agent decides who handles each request.",
    what: "A coordinator reads each request and routes it to the specialist that handles that kind: billing for refunds, support for faults. The specialist does the work, and the coordinator moves on to the next request.",
    enforced: "complier can't tell whether a route was the right one; that's the coordinator's judgement. What it holds is the routing: a specialist acts only on a request routed to it, the other specialists wait, and the coordinator routes the next request only once the current one is handled. The routing call's result names the specialist.",
    call: "Dispatcher(Route, Specialist)",
    args: "Route is the coordinator's turn: Route(Handle) either hands the request on, by carrying on as Handle(d), or ends. Specialist(d) is the phase of the specialist d names. Once it ends, the coordinator routes again.",
    guarantee: "Billing acts only after a request was routed to billing, and support only after one was routed to support.",
    nodes: [
      { role: "coordinator", x: 360, y: 60 },
      { role: "billing", x: 170, y: 180 },
      { role: "support", x: 550, y: 180 },
    ],
    links: [
      ["coordinator", "billing"],
      ["coordinator", "support"],
    ],
    steps: [
      { role: "billing", act: "refund", expect: "refused", say: "Billing tries to refund before anything was routed to it. Refused." },
      { role: "coordinator", act: "route", expect: "allowed", say: "The coordinator routes the first request." },
      { role: "coordinator", result: "to_billing", say: "Its routing call says billing." },
      { role: "support", act: "troubleshoot", expect: "refused", say: "Support tries to pick it up too. Refused: this one went to billing." },
      { role: "billing", act: "refund", expect: "allowed", say: "Billing handles it." },
      { role: "billing", result: "done", say: "Handled; the coordinator's turn again." },
      { role: "coordinator", act: "route", expect: "allowed", say: "The next request." },
      { role: "coordinator", result: "to_support", say: "This one is for support." },
      { role: "support", act: "troubleshoot", expect: "allowed", say: "Support handles it." },
      { role: "support", result: "done", say: "Handled." },
      { role: "coordinator", act: "close", expect: "allowed", say: "Nothing left: the coordinator closes the desk." },
      { role: "coordinator", result: "done", say: "The policy finishes." },
    ],
  },
  {
    slug: "fan-out",
    defines: ["FanOut"],
    name: "Parallel fan-out/gather",
    short: "Several agents work at once; one gathers their results.",
    what: "Independent pieces of work go to agents that run at the same time, here a security, a style and a performance review of one pull request, and one more agent gathers them once they're all in.",
    enforced: "The reviewers act concurrently: each has its own call in flight, and none waits for another. The summariser is refused until every reviewer's call has come back. Each branch is its own agents; if two branches shared a role, the policy would be ambiguous about whose step a call is, and FDR refuses it.",
    call: "FanOut(<Step(security, review), Step(style, review), Step(performance, review)>, Step(summariser, summarise))",
    args: "FanOut takes a sequence of branches, phases that run at the same time, and a gathering phase that starts once every branch has ended. Step(r, x) is a phase of one call.",
    guarantee: "The summariser acts only once every reviewer's review has come back.",
    nodes: [
      { role: "security", x: 100, y: 60 },
      { role: "style", x: 285, y: 60 },
      { role: "performance", x: 470, y: 60 },
      { role: "summariser", x: 640, y: 175 },
    ],
    links: [
      ["security", "summariser"],
      ["style", "summariser"],
      ["performance", "summariser"],
    ],
    steps: [
      { role: "summariser", act: "summarise", expect: "refused", say: "The summariser can't start with nothing to summarise. Refused." },
      { role: "security", act: "review", expect: "allowed", say: "The security reviewer starts." },
      { role: "style", act: "review", expect: "allowed", say: "So does the style reviewer, while security's call is still running." },
      { role: "performance", act: "review", expect: "allowed", say: "And the performance reviewer: three calls in flight at once." },
      { role: "style", result: "done", say: "Style finishes first." },
      { role: "summariser", act: "summarise", expect: "refused", say: "The summariser tries again. Refused: two reviews are still running." },
      { role: "security", result: "done", say: "Security is done." },
      { role: "performance", result: "done", say: "Performance too: every branch has ended." },
      { role: "summariser", act: "summarise", expect: "allowed", say: "Now the summariser gathers the three reviews." },
      { role: "summariser", result: "done", say: "The policy finishes." },
    ],
  },
  {
    slug: "hierarchy",
    defines: ["Hold", "Delegate"],
    name: "Hierarchical decomposition",
    short: "An agent hands part of its task down, and waits for it.",
    what: "A writer needs research, so it hands that to an assistant, which hands the searching to a searcher in turn and summarises what comes back. Each level waits for the level below it, and carries on with the result.",
    enforced: "The writer's research call doesn't return while the work below it happens: complier holds it. The call is taken, and its answer comes only once the assistant has finished, so the writer's tool call returns with the work done. The assistant delegates the same way, and the searcher acts only inside that delegation.",
    call: "Delegate(writer, research, Assistant, \\ _ @ Step(writer, write))",
    args: "Delegate(r, x, Sub, K) holds r's call x while Sub, the agents below it, works; when Sub ends, the call runs and its result v carries on as K(v). Sub may delegate in turn: here Assistant is Delegate(assistant, search, Step(searcher, browse), ...).",
    guarantee: "The writer's research call runs only once the assistant has summarised, and the assistant's search only once the searcher has browsed.",
    nodes: [
      { role: "writer", x: 150, y: 50 },
      { role: "assistant", x: 360, y: 130 },
      { role: "searcher", x: 570, y: 210 },
    ],
    links: [
      ["writer", "assistant"],
      ["assistant", "searcher"],
    ],
    steps: [
      { role: "writer", act: "research", expect: "held", say: "The writer asks for research. Its call is taken and held: the writer waits while the work below it happens." },
      { role: "searcher", act: "browse", expect: "refused", say: "The searcher tries to start on its own. Refused: nothing has been delegated to it yet." },
      { role: "assistant", act: "search", expect: "held", say: "The assistant delegates the search, and waits in turn." },
      { role: "searcher", act: "browse", expect: "allowed", say: "Now the searcher browses." },
      { role: "searcher", result: "done", say: "Its work is done, so the assistant's search call is answered and runs." },
      { role: "assistant", result: "done", say: "The search comes back to the assistant." },
      { role: "assistant", act: "summarise", expect: "allowed", say: "The assistant summarises what was found." },
      { role: "assistant", result: "done", say: "The research is done, so the writer's call is answered and runs." },
      { role: "writer", result: "done", say: "The research comes back to the writer." },
      { role: "writer", act: "write", expect: "allowed", say: "The writer writes the report." },
      { role: "writer", result: "done", say: "The policy finishes." },
    ],
  },
  {
    slug: "generator-critic",
    defines: ["Judgement", "GeneratorCritic"],
    name: "Generator/critic",
    short: "One agent drafts, another checks, until it passes.",
    what: "A writer drafts and a critic checks the draft against its criteria. A failing draft goes back to the writer with the critic's feedback; a passing one moves on, here to publishing.",
    enforced: "Publishing is refused until the critic has passed a draft, however the writer phrases it or whatever it's told. The critic's result decides, and a failed check (an error, not just a no) counts as a fail.",
    call: "GeneratorCritic(Step(writer, draft), Judgement(critic, review, {pass})) ; Step(writer, publish)",
    args: "GeneratorCritic(Generate, Critic) runs the generator's phase, then the critic's judgement: a pass ends it, a fail sends the work back. Judgement(r, x, Passing) is r's call x, passing when its result is in Passing. The pattern ends, so it composes: ; Step(writer, publish) comes after.",
    guarantee: "Nothing is published before the critic has passed a draft.",
    nodes: [
      { role: "writer", x: 210, y: 130 },
      { role: "critic", x: 510, y: 130 },
    ],
    links: [
      ["writer", "critic"],
      ["critic", "writer"],
    ],
    steps: [
      { role: "writer", act: "publish", expect: "refused", say: "The writer tries to publish straight away. Refused." },
      { role: "writer", act: "draft", expect: "allowed", say: "So it drafts." },
      { role: "writer", result: "done", say: "The draft is ready: the critic's turn." },
      { role: "critic", act: "review", expect: "allowed", say: "The critic reviews it." },
      { role: "critic", result: "fail", say: "It fails, and goes back to the writer." },
      { role: "writer", act: "publish", expect: "refused", say: "Publishing is still refused." },
      { role: "writer", act: "draft", expect: "allowed", say: "The writer revises." },
      { role: "writer", result: "done", say: "Back to the critic." },
      { role: "critic", act: "review", expect: "allowed", say: "Another review." },
      { role: "critic", result: "pass", say: "It passes." },
      { role: "writer", act: "publish", expect: "allowed", say: "Now publishing is allowed." },
      { role: "writer", result: "done", say: "The policy finishes." },
    ],
  },
  {
    slug: "refinement",
    defines: ["Refinement"],
    name: "Iterative refinement",
    short: "Critique and revise, a bounded number of times.",
    what: "A writer drafts, then a critic and an editor take turns improving it: the critic says what to change, the editor revises. It stops when the critic is satisfied, or after a set number of rounds.",
    enforced: "The bound is part of the policy, not a counter an agent keeps: after two revisions the work is finished whatever the critic thinks, and a third critique is refused. A good critique ends it early.",
    call: "Refinement(2, Step(writer, draft), Judgement(critic, critique, {good}), Step(editor, revise))",
    args: "Refinement(n, Generate, Critic, Refine) runs the generator's phase, then at most n rounds: the critic's judgement, and on a fail the refiner's phase. A pass ends it early.",
    guarantee: "The editor revises at most twice.",
    nodes: [
      { role: "writer", x: 130, y: 130 },
      { role: "critic", x: 360, y: 130 },
      { role: "editor", x: 590, y: 130 },
    ],
    links: [
      ["writer", "critic"],
      ["critic", "editor"],
      ["editor", "critic"],
    ],
    steps: [
      { role: "writer", act: "draft", expect: "allowed", say: "The writer drafts." },
      { role: "writer", result: "done", say: "Round one begins." },
      { role: "critic", act: "critique", expect: "allowed", say: "The critic critiques." },
      { role: "critic", result: "needs_work", say: "It needs work." },
      { role: "editor", act: "revise", expect: "allowed", say: "The editor revises." },
      { role: "editor", result: "done", say: "Round two." },
      { role: "critic", act: "critique", expect: "allowed", say: "Another critique." },
      { role: "critic", result: "needs_work", say: "Still not there." },
      { role: "editor", act: "revise", expect: "allowed", say: "The second and last revision." },
      { role: "editor", result: "done", say: "Two rounds are the limit, so the policy finishes." },
      { role: "critic", act: "critique", expect: "refused", say: "The critic wants another round. Refused: the work is finished." },
    ],
  },
  {
    slug: "advisor",
    defines: ["Hold", "Consult"],
    name: "Advisor",
    short: "An agent can ask another agent for advice.",
    what: "A developer works as it likes, and when it's unsure it asks a more experienced agent. It waits for the answer, reads it, and decides what to do; the advisor never does the work itself.",
    enforced: "The developer's ask is held until the advisor has answered, and then runs, so its tool call returns with the answer to read. The advisor gets a turn only when asked, sees the question (the held call's arguments), and can do exactly one thing with it: answer.",
    call: "Consult(developer, ask, advisor, answer, \\ _ @ Work)",
    args: "Consult(r, x, a, y, K) holds r's call x until advisor a has answered with its call y; then r's call runs and its result v carries on as K(v). In the example it's one choice among the developer's steps, so it can ask at any point.",
    guarantee: "The advisor answers only when asked, once per question.",
    nodes: [
      { role: "developer", x: 230, y: 130 },
      { role: "advisor", x: 500, y: 130 },
    ],
    links: [["developer", "advisor"]],
    steps: [
      { role: "advisor", act: "answer", expect: "refused", say: "The advisor offers an answer nobody asked for. Refused." },
      { role: "developer", act: "edit", expect: "allowed", say: "The developer works." },
      { role: "developer", result: "done", say: "An edit is in." },
      { role: "developer", act: "ask", expect: "held", say: "It isn't sure about the next step, so it asks. The ask is held: the developer waits, and the advisor is shown the question." },
      { role: "advisor", act: "answer", expect: "allowed", say: "The advisor answers." },
      { role: "advisor", result: "done", say: "Answered, so the developer's ask runs." },
      { role: "developer", result: "done", say: "The ask returns with the advice." },
      { role: "developer", act: "commit", expect: "allowed", say: "The developer decides, and commits." },
      { role: "developer", result: "done", say: "The policy finishes." },
    ],
  },
  {
    slug: "guard",
    defines: ["Judgement", "Guard"],
    name: "Guard",
    short: "An agent's call wakes a judge, whose verdict decides it.",
    what: "An agent drafts and sends emails. It doesn't ask anyone before sending: it just sends. But every send is put to a judge first, which reads what's about to go out and approves it or not.",
    enforced: "The agent never talks to the judge. Its send is taken and held, and that attempt is what gives the judge its turn; the judge is shown the call it's judging. An approval lets the send run, and anything else denies it. The agent's other calls, here drafting, aren't judged.",
    call: "Guard(agent, send, Judgement(judge, review, {approve}), \\ _ @ Policy, Policy)",
    args: "Guard(r, x, Judge, K, P) is r's call x put to Judge, a judgement: passed, it's allowed and its result v carries on as K(v); failed, it's denied and the policy carries on as P. It sits wherever Permit would.",
    guarantee: "Every send that runs was approved by the judge, each by its own approval.",
    nodes: [
      { role: "agent", x: 200, y: 130 },
      { role: "judge", x: 520, y: 130 },
    ],
    links: [],
    steps: [
      { role: "judge", act: "review", expect: "refused", say: "The judge can't act on its own: there's nothing to judge. Refused." },
      { role: "agent", act: "draft", expect: "allowed", say: "The agent drafts an email. Drafting isn't judged." },
      { role: "agent", result: "done", say: "The draft is ready." },
      { role: "agent", act: "send", expect: "held", say: "The agent sends it. The send is held, and the judge is woken and shown it." },
      { role: "judge", act: "review", expect: "allowed", say: "The judge reviews the email." },
      { role: "judge", result: "reject", say: "It rejects it, so the agent's send is denied and never runs." },
      { role: "agent", act: "send", expect: "held", say: "The agent fixes the email and sends again. Held." },
      { role: "judge", act: "review", expect: "allowed", say: "The judge reviews it." },
      { role: "judge", result: "approve", say: "Approved: the send is allowed and runs." },
      { role: "agent", result: "done", say: "The email went out. The agent carries on drafting and sending, each send judged." },
    ],
  },
];

export const bySlug = (slug: string) => PATTERNS.find((p) => p.slug === slug);
