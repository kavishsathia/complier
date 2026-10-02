import Link from "next/link";

export function Nav() {
  return (
    <nav className="nav">
      <Link href="/" className="brand">complier</Link>
      <Link href="/docs">Docs</Link>
      <a href="https://github.com/kavishsathia/complier">GitHub</a>
    </nav>
  );
}
