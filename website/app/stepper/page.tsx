import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Stepper from "./stepper";
import "katex/dist/katex.min.css";
import "./stepper.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "complier · stepper",
};

export default function Page() {
  return (
    <div className={`${sans.variable} ${mono.variable}`}>
      <Stepper />
    </div>
  );
}
