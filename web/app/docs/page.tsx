import type { Metadata } from "next";
import { Nav } from "../nav";
import { Docs } from "./docs";

export const metadata: Metadata = {
  title: "Docs · complier",
  description: "Two assistants share a bank account. Write the rules in CSP, prove them, run under them.",
};

export default function DocsPage() {
  return (
    <>
      <Nav />
      <Docs />
    </>
  );
}
