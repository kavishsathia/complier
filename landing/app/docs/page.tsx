import type { Metadata } from "next";
import ContractPlayground from "../components/ContractPlayground";

export const metadata: Metadata = {
  title: "complier docs",
  description:
    "Write a CPL workflow on the left and inspect the compiled runtime graph on the right.",
};

export default function DocsPage() {
  return <ContractPlayground />;
}
