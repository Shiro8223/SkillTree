"use client";
import { useRef, useState, useMemo, useEffect } from "react";
import type { WorldState, Point, NodeT } from "@/app/lib/types";

function uid() {
  return "n_" + Math.random().toString(36).slice(2, 9);
}

export default function SkillCanvas() {
  // --- World state (single source of truth)
  const [world, setWorld] = useState<WorldState>({
    panX: 0,
    panY: 0,
    zoom: 1,
    nodes: [],
    edges: [],
    mode: "idle",
    draggingNodeId: null,
  });

  // --- Refs for interactions
  const bgRef = useRef<HTMLDivElement | null>(null);
  const draggingBgRef = useRef(false);
  const lastPointerRef = useRef<Point>({ x: 0, y: 0 });

  // --- Helpers: screen <-> world (zoom=1 for now)
  const screenToWorld = (sx: number, sy: number): Point => ({
    x: sx - world.panX,
    y: sy - world.panY,
  });

  // --- Grid settings
  const gridSize = 40;
  const line1 = "rgba(255,255,255,0.10)";
  const line2 = "rgba(255,255,255,0.05)";
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  const offsetX = mod(world.panX, gridSize);
  const offsetY = mod(world.panY, gridSize);

  const backgroundImage = `
    linear-gradient(to right, ${line1} 1px, transparent 1px),
    linear-gradient(to bottom, ${line1} 1px, transparent 1px),
    linear-gradient(to right, ${line2} 1px, transparent 1px),
    linear-gradient(to bottom, ${line2} 1px, transparent 1px)
  `;
  const backgroundSize = `
    ${gridSize}px ${gridSize}px,
    ${gridSize}px ${gridSize}px,
    ${gridSize * 5}px ${gridSize * 5}px,
    ${gridSize * 5}px ${gridSize * 5}px
  `;
  const backgroundPosition = `
    ${offsetX}px ${offsetY}px,
    ${offsetX}px ${offsetY}px,
    ${mod(world.panX, gridSize * 5)}px ${mod(world.panY, gridSize * 5)}px,
    ${mod(world.panX, gridSize * 5)}px ${mod(world.panY, gridSize * 5)}px
  `;

  // --- Background pointer handlers (pan or place)
  function onBgPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const isLeftMouse = e.pointerType !== "mouse" || e.button === 0;
    if (!isLeftMouse) return;

    // If in add-node mode: place a node at click world coords
    if (world.mode === "add-node") {
      const rect = bgRef.current!.getBoundingClientRect();
      const { x, y } = screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top
      );
      const name = prompt("Node name:", "New Node") ?? "New Node";
      setWorld((w) => ({
        ...w,
        nodes: [...w.nodes, { id: uid(), x, y, name }],
      }));
      // stay in add mode so user can place multiple; press Esc to exit
      return;
    }

    // Otherwise start panning
    draggingBgRef.current = true;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "grabbing";
  }

  function onBgPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingBgRef.current) return;
    const dx = e.clientX - lastPointerRef.current.x;
    const dy = e.clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    setWorld((w) => ({ ...w, panX: w.panX + dx, panY: w.panY + dy }));
  }

  function onBgPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingBgRef.current) return;
    draggingBgRef.current = false;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {}
    document.body.style.cursor = "default";
  }

  // --- Node interactions (drag a node in world space)
  const onNodePointerDown =
    (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      // disable background pan while dragging node
      setWorld((w) => ({ ...w, mode: "drag-node", draggingNodeId: id }));
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
    };

  const onNodePointerMove =
    (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (world.mode !== "drag-node" || world.draggingNodeId !== id) return;
      const dx = e.clientX - lastPointerRef.current.x;
      const dy = e.clientY - lastPointerRef.current.y;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };

      setWorld((w) => ({
        ...w,
        nodes: w.nodes.map((n) =>
          n.id === id ? { ...n, x: n.x + dx, y: n.y + dy } : n
        ),
      }));
    };

  const onNodePointerUp =
    (id: string) => (e: React.PointerEvent<HTMLDivElement>) => {
      if (world.mode !== "drag-node" || world.draggingNodeId !== id) return;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {}
      setWorld((w) => ({ ...w, mode: "idle", draggingNodeId: null }));
    };

  // --- Keyboard: Esc to leave add-node
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setWorld((w) => ({ ...w, mode: "idle" }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-[calc(100vh-56px)] w-full border-t border-white/10">
      {/* Toolbar (temporary, simple controls) */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-white/10 bg-black/30">
        <button
          onClick={() =>
            setWorld((w) => ({
              ...w,
              mode: w.mode === "add-node" ? "idle" : "add-node",
            }))
          }
          className={`px-3 py-1.5 rounded ${
            world.mode === "add-node"
              ? "bg-emerald-600 text-white"
              : "bg-white/10 hover:bg-white/15"
          }`}
        >
          {world.mode === "add-node"
            ? "Add Node: ON (Esc to exit)"
            : "Add Node"}
        </button>

        <button
          onClick={() => setWorld((w) => ({ ...w, panX: 0, panY: 0 }))}
          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
        >
          Reset View
        </button>
      </div>

      {/* Grid layer */}
      <div
        ref={bgRef}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerCancel={onBgPointerUp}
        className="relative w-full h-[calc(100%-56px)] touch-none"
        style={{
          backgroundColor: "#0f1220",
          backgroundImage,
          backgroundSize,
          backgroundPosition,
          cursor: world.mode === "add-node" ? "crosshair" : "grab",
        }}
      >
        {/* World layer: everything inside moves together */}
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `translate(${world.panX}px, ${world.panY}px) scale(${world.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* Render nodes */}
          {world.nodes.map((n) => (
            <div
              key={n.id}
              onPointerDown={onNodePointerDown(n.id)}
              onPointerMove={onNodePointerMove(n.id)}
              onPointerUp={onNodePointerUp(n.id)}
              className="absolute -translate-x-1/2 -translate-y-1/2 select-none"
              style={{ left: n.x, top: n.y, cursor: "grab" }}
              title={n.name}
            >
              <div className="grid place-items-center w-16 h-16 rounded-full border-2 border-sky-400 bg-sky-900/50 shadow">
                <span className="text-xs text-white/90 px-1 text-center">
                  {n.name}
                </span>
              </div>
            </div>
          ))}

          {/* TODO: Render edges here later (SVG or canvas in this layer) */}
        </div>
      </div>
    </div>
  );
}
