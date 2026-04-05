import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

export interface AddEdgeData {
  onAdd: () => void;
  [key: string]: unknown;
}

export default function AddEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onAdd = (data as AddEdgeData | undefined)?.onAdd;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className="add-edge-button-wrapper"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          <button
            className="add-edge-button"
            onClick={(e) => {
              e.stopPropagation();
              onAdd?.();
            }}
          >
            +
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
