import { promises as fs } from "fs";
import path from "path";

const PYTHON_SOURCE_PATHS = [
  "src/complier/contract/ast.py",
  "src/complier/contract/compiler.py",
  "src/complier/contract/model.py",
  "src/complier/contract/parser.py",
  "src/complier/contract/runtime.py",
  "src/complier/contract/transformer.py",
  "src/complier/integration/model.py",
  "src/complier/memory/model.py",
  "src/complier/visualizer/graph.py",
];

const PYTHON_STUB_FILES: Record<string, string> = {
  "complier/__init__.py": '"""Minimal complier package for the browser playground."""\n',
  "complier/contract/__init__.py":
    '"""Contract package surface for the browser playground."""\n',
  "complier/integration/__init__.py":
    'from .model import Integration\n\n__all__ = ["Integration"]\n',
  "complier/memory/__init__.py": 'from .model import Memory\n\n__all__ = ["Memory"]\n',
  "complier/visualizer/__init__.py":
    'from .graph import contract_to_graph\n\n__all__ = ["contract_to_graph"]\n',
};

export async function GET() {
  const repoRoot = path.resolve(process.cwd(), "..");

  const sourceFiles = await Promise.all(
    PYTHON_SOURCE_PATHS.map(async (relativePath) => {
      const absolutePath = path.join(repoRoot, relativePath);
      const source = await fs.readFile(absolutePath, "utf-8");
      return [relativePath.replace(/^src\//, ""), source] as const;
    }),
  );

  return Response.json({
    files: {
      ...PYTHON_STUB_FILES,
      ...Object.fromEntries(sourceFiles),
    },
  });
}
