import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sequence from "./sequence";
import "../stepper/stepper.css";
import "./sequence.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "complier · sequence",
};

export default function Page() {
  return (
    <div className={`${sans.variable} ${mono.variable}`}>
      <Sequence />
    </div>
  );
}
