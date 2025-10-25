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

  // node sizes
  const SIZE_MAP: Record<NonNullable<NodeT["size"]>, number> = {
    small: 1,
    medium: 1.5,
    large: 2,
  };
  //node colours
  const COLOR_MAP: Record<
    NonNullable<NodeT["color"]>,
    { border: string; bg: string }
  > = {
    sky: { border: "#38bdf8", bg: "rgba(56,189,248,0.15)" },
    emerald: { border: "#34d399", bg: "rgba(52,211,153,0.15)" },
    amber: { border: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
    rose: { border: "#f43f5e", bg: "rgba(244,63,94,0.15)" },
    violet: { border: "#8b5cf6", bg: "rgba(139,92,246,0.15)" },
  };
  //node size calcuator
  function nodeSizePx(n: NodeT) {
    const base = 64; //  current small = 64px
    const factor = SIZE_MAP[n.size ?? "small"];
    return Math.round(base * factor);
  }
  //node colour setter
  function nodeColors(n: NodeT) {
    return COLOR_MAP[n.color ?? "sky"];
  }

  // Modal (rename) UI state
  const [renameOpen, setRenameOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [tempLabel, setTempLabel] = useState("");
  const [tempColor, setTempColor] =
    useState<NonNullable<NodeT["color"]>>("sky");
  const [tempSize, setTempSize] = useState<NonNullable<NodeT["size"]>>("small");

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
    // If in add-node mode: create the node and open the modal
    if (world.mode === "add-node") {
      const rect = bgRef.current!.getBoundingClientRect();
      const { x, y } = screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top
      );

      const newNode: NodeT = {
        id: uid(),
        x,
        y,
        name: "New Node",
        color: "sky", // default
        size: "small", // default
      };

      setWorld((w) => ({ ...w, nodes: [...w.nodes, newNode] }));

      // Preload modal fields and open it
      setEditingNodeId(newNode.id);
      setTempLabel(newNode.name);
      setTempColor(newNode.color ?? "sky");
      setTempSize(newNode.size ?? "small");
      setRenameOpen(true);

      // Stay in add-node mode so user can keep adding after closing the modal
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
      if (e.key === "Escape") {
        if (renameOpen) {
          setRenameOpen(false);
          setEditingNodeId(null);
        } else {
          setWorld((w) => ({ ...w, mode: "idle" }));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renameOpen, setWorld]);

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
          {world.nodes.map((n) => {
            const px = nodeSizePx(n); // ← uses SIZE_MAP
            const col = nodeColors(n); // ← uses COLOR_MAP

            return (
              <div
                key={n.id}
                onPointerDown={onNodePointerDown(n.id)}
                onPointerMove={onNodePointerMove(n.id)}
                onPointerUp={onNodePointerUp(n.id)}
                onDoubleClick={() => {
                  setEditingNodeId(n.id);
                  setTempLabel(n.name);
                  setTempColor(n.color ?? "sky");
                  setTempSize(n.size ?? "small");
                  setRenameOpen(true);
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 select-none"
                style={{ left: n.x, top: n.y, cursor: "grab" }}
                title={n.name}
              >
                {/* Circle with dynamic size + color */}
                <div
                  className="grid place-items-center rounded-full shadow select-none"
                  style={{
                    width: px,
                    height: px,
                    border: `2px solid ${col.border}`,
                    background: col.bg,
                  }}
                >
                  <span className="text-xs text-white/90 px-1 text-center">
                    {n.name}
                  </span>
                </div>
              </div>
            );
          })}

          {/* TODO: Render edges here later (SVG or canvas in this layer) */}
        </div>
      </div>
      {renameOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setRenameOpen(false);
              setEditingNodeId(null);
            }
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-gray-900 text-white shadow-2xl border border-white/10 p-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-3">Node settings</h2>

            {/* Label */}
            <label className="block text-sm mb-1">Label</label>
            <input
              autoFocus
              value={tempLabel}
              onChange={(e) => setTempLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  // same as Save button
                  if (editingNodeId) {
                    setWorld((w) => ({
                      ...w,
                      nodes: w.nodes.map((nd) =>
                        nd.id === editingNodeId
                          ? {
                              ...nd,
                              name: tempLabel.trim() || nd.name,
                              color: tempColor,
                              size: tempSize,
                            }
                          : nd
                      ),
                    }));
                  }
                  setRenameOpen(false);
                  setEditingNodeId(null);
                } else if (e.key === "Escape") {
                  setRenameOpen(false);
                  setEditingNodeId(null);
                }
              }}
              className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-500 mb-3"
              placeholder="Node label"
            />

            {/* Size */}
            <label className="block text-sm mb-1">Size</label>
            <select
              value={tempSize}
              onChange={(e) =>
                setTempSize(e.target.value as NonNullable<NodeT["size"]>)
              }
              className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-sky-500 mb-3"
            >
              <option className="text-black bg-white" value="small">
                Small (default)
              </option>
              <option className="text-black bg-white" value="medium">
                Medium (1.5×)
              </option>
              <option className="text-black bg-white" value="large">
                Large (2×)
              </option>
            </select>

            <select
              value={tempColor}
              onChange={(e) =>
                setTempColor(e.target.value as NonNullable<NodeT["color"]>)
              }
              className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-sky-500 mb-4"
            >
              <option className="text-black bg-white" value="sky">
                Sky
              </option>
              <option className="text-black bg-white" value="emerald">
                Emerald
              </option>
              <option className="text-black bg-white" value="amber">
                Amber
              </option>
              <option className="text-black bg-white" value="rose">
                Rose
              </option>
              <option className="text-black bg-white" value="violet">
                Violet
              </option>
            </select>

            <div className="mt-2 flex justify-between items-center">
              {/* Delete */}
              <button
                onClick={() => {
                  if (!editingNodeId) return;
                  setWorld((w) => ({
                    ...w,
                    nodes: w.nodes.filter((nd) => nd.id !== editingNodeId),
                    edges: w.edges.filter(
                      (e) =>
                        e.fromId !== editingNodeId && e.toId !== editingNodeId
                    ),
                  }));
                  setRenameOpen(false);
                  setEditingNodeId(null);
                }}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white"
              >
                Delete Node
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setRenameOpen(false);
                    setEditingNodeId(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (editingNodeId) {
                      setWorld((w) => ({
                        ...w,
                        nodes: w.nodes.map((nd) =>
                          nd.id === editingNodeId
                            ? {
                                ...nd,
                                name: tempLabel.trim() || nd.name,
                                color: tempColor,
                                size: tempSize,
                              }
                            : nd
                        ),
                      }));
                    }
                    setRenameOpen(false);
                    setEditingNodeId(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
