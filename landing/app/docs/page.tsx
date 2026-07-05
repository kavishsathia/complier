import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { promises as fs } from "fs";
import path from "path";
import ContractPlayground from "../components/ContractPlayground";

// Docs are temporarily unpublished while the project pivots to the research framing.
const DOCS_ENABLED = false;

export const metadata: Metadata = {
  title: "complier docs",
  description:
    "Write a CPL workflow on the left and inspect the compiled runtime graph on the right.",
};

async function loadDocsPages() {
  const docsDir = path.join(process.cwd(), "content", "docs");
  const filenames = await fs.readdir(docsDir);

  const pages = await Promise.all(
    filenames
      .filter((filename) => filename.endsWith(".md"))
      .map(async (filename) => {
        const filePath = path.join(docsDir, filename);
        const content = await fs.readFile(filePath, "utf-8");
        const slug = filename.replace(/\.md$/, "");
        const titleMatch = content.match(/^#\s+(.+)$/m);
        return {
          slug,
          title: titleMatch?.[1] ?? slug,
          content,
        };
      }),
  );

  const docsFirst = pages.sort((left, right) => {
    if (left.slug === "docs") {
      return -1;
    }
    if (right.slug === "docs") {
      return 1;
    }
    return left.title.localeCompare(right.title);
  });

  return docsFirst;
}

export default async function DocsPage() {
  if (!DOCS_ENABLED) {
    notFound();
  }
  const docsPages = await loadDocsPages();
  return <ContractPlayground docsPages={docsPages} />;
}
