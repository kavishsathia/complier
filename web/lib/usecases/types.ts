// A use case pairs a plain-English description with a CSP encoding that the
// playground can run and prove. Each constraint says whether and how the
// encoding captures it.

export type How = "enforced" | "deadline" | "not-encoded";

export interface Constraint {
  text: string; // the constraint as the user would state it
  how: How;
  detail: string; // how the encoding captures it, or why it does not
}

export interface UseCase {
  slug: string;
  title: string;
  summary: string;
  constraints: Constraint[];
  source: string;
}
