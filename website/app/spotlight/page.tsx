import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Spotlight from "./spotlight";
import "../stepper/stepper.css";
import "../sequence/sequence.css";
import "./spotlight.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "complier · workflows",
};

export default function Page() {
  return (
    <div className={`${sans.variable} ${mono.variable}`}>
      <Spotlight />
    </div>
  );
}
