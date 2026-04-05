import type { NodeTypes } from "@xyflow/react";
import ToolNode from "./ToolNode.tsx";
import BranchNode from "./BranchNode.tsx";
import JoinNode from "./JoinNode.tsx";
import LoopNode from "./LoopNode.tsx";
import ForkNode from "./ForkNode.tsx";

export const nodeTypes: NodeTypes = {
  tool: ToolNode,
  branch: BranchNode,
  join: JoinNode,
  loop: LoopNode,
  fork: ForkNode,
};
