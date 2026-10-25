import katex from "katex";

// ~ for a world channel, ^ for an agent channel, in the report's notation.
export const W = "{\\sim}";
export const A = "{}^{\\wedge}";

export default function TeX({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" });
  return <span className="tex" dangerouslySetInnerHTML={{ __html: html }} />;
}
