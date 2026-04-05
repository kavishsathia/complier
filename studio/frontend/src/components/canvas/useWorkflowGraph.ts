import { useMemo } from "react";
import type { WorkflowStep } from "../../types.ts";
import { workflowToFlow } from "./workflowToFlow.ts";
import { layoutGraph } from "./layoutGraph.ts";

export function useWorkflowGraph(steps: WorkflowStep[], selectedStepId: string | null) {
  return useMemo(() => {
    const { nodes: rawNodes, edges } = workflowToFlow(steps);
    const laidOut = layoutGraph(rawNodes, edges);

    const nodes = laidOut.map((n) => {
      const step = (n.data as Record<string, unknown> | undefined)?.step as { id: string } | undefined;
      return {
        ...n,
        selected: n.id === selectedStepId || step?.id === selectedStepId,
      };
    });

    return { nodes, edges };
  }, [steps, selectedStepId]);
}
