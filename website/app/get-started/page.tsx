import type { Metadata } from "next";
import Install from "./Install";
import Shell from "./shell";

export const metadata: Metadata = {
  title: "Get started: install | complier",
  description: "Install complier, with your own FDR, and check it works.",
};

export default function GetStarted() {
  return (
    <Shell current="/get-started" title="Get started" lede="Install complier and check it works. About five minutes, most of it getting FDR.">
      <Install />
    </Shell>
  );
}
