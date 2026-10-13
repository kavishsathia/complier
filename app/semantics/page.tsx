import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";
import Workbench from "./workbench";
import "./semantics.css";

export const metadata: Metadata = {
  title: "complier · semantics",
};

const read = (file: string) => readFileSync(path.join(process.cwd(), "app/semantics/prolog", file), "utf8");

export default function Semantics() {
  return (
    <Workbench
      defaults={{ spec: read("example.csp"), semantics: read("semantics.pl"), parser: read("parser.pl") }}
      glue={read("workbench.pl")}
    />
  );
}
