const lessons = [
  {
    name: "Finding the right formalism",
    happened: "KAT and LTLf/LDLf took two weeks each; CSP followed a discussion with Prof Dong Jin Song, who pointed us to CSP#",
    lesson: "Consult formal methods experts early",
  },
  {
    name: "Balancing competing goals",
    happened: "KAT's cost to agent autonomy showed only once we wrote realistic policies in it",
    lesson: "Judge a formalism on concrete scenarios, not on paper",
  },
  {
    name: "Learning curve",
    happened: "CSP and its semantics, CSP#, KAT, LTLf/LDLf: all new this semester",
    lesson: "Designing CSPio meant understanding them well enough to adapt them",
  },
  {
    name: "Integrating with agents",
    happened: "Unclear where a gatekeeper could sit without modifying the agent",
    lesson: "Studying agent infrastructure shaped the harness objective (O4)",
  },
];

export default function Lessons() {
  return (
    <section className="slide lessons">
      <p className="eyebrow">19 · Challenges and lessons learned</p>
      <h2>Four challenges this semester, and what each taught us.</h2>

      <div className="table">
        <span className="label">Challenge</span>
        <span className="label">What happened</span>
        <span className="label">Lesson</span>
        {lessons.map((l) => (
          <div key={l.name} className="row">
            <strong>{l.name}</strong>
            <p>{l.happened}</p>
            <p className="lesson">{l.lesson}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
