import ToolNode from "./ToolNode.tsx";
import ForkNode from "./ForkNode.tsx";
import JoinNode from "./JoinNode.tsx";
import BranchGroupNode from "./BranchGroupNode.tsx";
import BranchArmGroupNode from "./BranchArmGroupNode.tsx";
import BranchHeaderNode from "./BranchHeaderNode.tsx";
import LoopGroupNode from "./LoopGroupNode.tsx";
import UnorderedGroupNode from "./UnorderedGroupNode.tsx";
import UnorderedHeaderNode from "./UnorderedHeaderNode.tsx";
import UnorderedCaseGroupNode from "./UnorderedCaseGroupNode.tsx";
import AddNode from "./AddNode.tsx";

export const nodeTypes = {
  tool: ToolNode,
  fork: ForkNode,
  join: JoinNode,
  branchGroup: BranchGroupNode,
  branchArmGroup: BranchArmGroupNode,
  branchHeader: BranchHeaderNode,
  loopGroup: LoopGroupNode,
  unorderedGroup: UnorderedGroupNode,
  unorderedHeader: UnorderedHeaderNode,
  unorderedCaseGroup: UnorderedCaseGroupNode,
  addNode: AddNode,
} as const;
