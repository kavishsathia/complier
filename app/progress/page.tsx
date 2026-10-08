import type { Metadata } from "next";
import Deck from "./deck";
import "./progress.css";

export const metadata: Metadata = {
  title: "complier · progress",
};

export default async function Progress({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { s } = await searchParams;
  const initial = Number(typeof s === "string" ? s : 1) - 1;
  return <Deck initial={Number.isInteger(initial) ? initial : 0} />;
}
