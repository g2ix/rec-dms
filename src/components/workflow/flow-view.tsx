"use client";

import { useMemo } from "react";
import { Background, ReactFlow, type Edge, type Node } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { WorkflowGraph } from "@/lib/workflow/graph";

const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;

export function FlowView({
  graph,
  selected,
  errors,
  onSelect,
}: {
  graph: WorkflowGraph;
  selected: string | null;
  errors: ReadonlySet<string>;
  onSelect: (key: string) => void;
}) {
  const { nodes, edges } = useMemo(() => layout(graph, selected, errors), [graph, selected, errors]);
  return (
    <div className="rec-card" style={{ height: "28rem" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        onNodeClick={(_event, node) => onSelect(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}

function layout(graph: WorkflowGraph, selected: string | null, errors: ReadonlySet<string>): { nodes: Node[]; edges: Edge[] } {
  const graphlib = new dagre.graphlib.Graph();
  graphlib.setDefaultEdgeLabel(() => ({}));
  graphlib.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 72 });
  for (const step of graph.steps) graphlib.setNode(step.key, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const transition of graph.transitions) {
    if (graph.steps.some((step) => step.key === transition.from) && graph.steps.some((step) => step.key === transition.to)) {
      graphlib.setEdge(transition.from, transition.to);
    }
  }
  dagre.layout(graphlib);
  const nodes: Node[] = graph.steps.map((step) => {
    const point = graphlib.node(step.key);
    return {
      id: step.key,
      position: { x: (point?.x ?? 0) - NODE_WIDTH / 2, y: (point?.y ?? 0) - NODE_HEIGHT / 2 },
      data: { label: `${step.name} · ${step.type}` },
      style: {
        width: NODE_WIDTH,
        background: selected === step.key ? "var(--primary-soft)" : "var(--surface)",
        color: selected === step.key ? "var(--primary-ink)" : "var(--ink)",
        border: errors.has(step.key) ? "1px solid var(--danger)" : "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        font: "500 13px/18px var(--font-sans)",
      },
    };
  });
  const edges: Edge[] = graph.transitions
    .filter((transition) => graph.steps.some((step) => step.key === transition.from) && graph.steps.some((step) => step.key === transition.to))
    .map((transition, index) => ({
      id: `${transition.from}-${transition.to}-${index}`,
      source: transition.from,
      target: transition.to,
      label: transition.label || (transition.when ? "when" : ""),
    }));
  return { nodes, edges };
}
