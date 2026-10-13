import type { Metadata } from "next";
import Stepper from "./stepper";
import "katex/dist/katex.min.css";
import "./stepper.css";

export const metadata: Metadata = {
  title: "complier · stepper",
};

export default function Page() {
  return <Stepper />;
}
