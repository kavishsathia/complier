import Link from "next/link";

export default function Home() {
  return (
    <main className="hero">
      <h1>complier</h1>
      <p>
        Contracts for agents. Describe what an agent may do as a process, and
        every step it takes is checked against it.
      </p>
      <Link href="/progress" className="link">
        Progress →
      </Link>
    </main>
  );
}
