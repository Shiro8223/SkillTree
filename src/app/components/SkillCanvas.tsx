"use client";
import { useRef, useState, useMemo, useEffect } from "react";
import type { WorldState, Point, NodeT, EdgeT } from "@/app/lib/types";

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
  // Safe helpers
  const hasLS = () =>
    typeof window !== "undefined" && typeof window.localStorage !== "undefined";

  const lsGet = (key: string) =>
    hasLS() ? window.localStorage.getItem(key) : null;
  const lsSet = (key: string, val: string) => {
    if (hasLS()) window.localStorage.setItem(key, val);
  };

  // ---- Persistence helpers/types ----
  type ProjectJSON = {
    version: 1;
    meta: {
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    };
    view: { panX: number; panY: number; zoom: number };
    nodes: NodeT[];
    edges: EdgeT[];
  };

  const STORAGE_PREFIX = "skilltree:project:";
  const PROJECTS_KEY = "skilltree:projects"; // list of {name, id, updatedAt}
  const LAST_OPENED = "skilltree:lastOpened";

  function safeParse<T>(raw: string | null): T | null {
    try {
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  // ---- Project state ----
  const [projectName, setProjectName] = useState<string>("Untitled");
  const [projectId, setProjectId] = useState<string>(
    () => "proj_" + uid().slice(2)
  );
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  //connector
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 2;
  const ZOOM_STEP = 1.1; // 10% per wheel 'tick'

  const [snap, setSnap] = useState(false);

  function snapTo(v: number, step: number) {
    return Math.round(v / step) * step;
  }

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

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
  //History state
  const HIST_LIMIT = 100;

  const [undoStack, setUndoStack] = useState<WorldState[]>([]);
  const [redoStack, setRedoStack] = useState<WorldState[]>([]);

  // Deep clone helper
  function cloneWorld(w: WorldState): WorldState {
    return JSON.parse(JSON.stringify(w));
  }

  // Take a snapshot of the *current* world and push to undo
  function commit() {
    setUndoStack((s) => {
      const next = [...s, cloneWorld(world)];
      return next.length > HIST_LIMIT
        ? next.slice(next.length - HIST_LIMIT)
        : next;
    });
    setRedoStack([]); // new action invalidates redo
  }

  // Undo and Redo
  function undo() {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setRedoStack((r) => [...r, cloneWorld(world)]);
      // restore previous world
      setWorld(prev);
      // clear selection & modes
      setSelectedNodeId?.(null);
      setSelectedEdgeId?.(null);
      setConnectingFromId(null);
      setRenameOpen(false);
      return s.slice(0, -1);
    });
  }

  function redo() {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setUndoStack((s) => [...s, cloneWorld(world)]);
      setWorld(next);
      setSelectedNodeId?.(null);
      setSelectedEdgeId?.(null);
      setConnectingFromId(null);
      setRenameOpen(false);
      return r.slice(0, -1);
    });
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

  function serialize(): ProjectJSON {
    const now = new Date().toISOString();
    return {
      version: 1,
      meta: {
        id: projectId,
        name: projectName,
        createdAt: lastSavedAt ?? now,
        updatedAt: now,
      },
      view: { panX: world.panX, panY: world.panY, zoom: world.zoom },
      nodes: world.nodes,
      edges: world.edges,
    };
  }

  function deserialize(p: ProjectJSON) {
    // minimal validation / defaults
    if (p.version !== 1) throw new Error("Unsupported version");
    const nodeIds = new Set(p.nodes.map((n) => n.id));
    const edges = p.edges.filter(
      (e) => nodeIds.has(e.fromId) && nodeIds.has(e.toId)
    );
    setWorld({
      panX: p.view.panX ?? 0,
      panY: p.view.panY ?? 0,
      zoom: p.view.zoom ?? 1,
      nodes: p.nodes.map((n) => ({
        ...n,
        color: n.color ?? "sky",
        size: n.size ?? "small",
      })),
      edges,
      mode: "idle",
      draggingNodeId: null,
    });

    setProjectName(p.meta.name);
    setProjectId(p.meta.id);
    setLastSavedAt(p.meta.createdAt);
  }

  function projectKey(name: string) {
    return STORAGE_PREFIX + name;
  }

  function listProjects(): { name: string; id: string; updatedAt: string }[] {
    const list = safeParse<{ name: string; id: string; updatedAt: string }[]>(
      lsGet(PROJECTS_KEY)
    );
    return Array.isArray(list) ? list : [];
  }

  function upsertProjectIndex(name: string, id: string, updatedAt: string) {
    const list = listProjects(); // uses lsGet internally
    const i = list.findIndex((x) => x.name === name);
    if (i >= 0) list[i] = { name, id, updatedAt };
    else list.push({ name, id, updatedAt });
    lsSet(PROJECTS_KEY, JSON.stringify(list)); // ← use lsSet
    return list; // ← handy for updating UI state
  }

  function saveProject(name = projectName) {
    const data = serialize();
    data.meta.name = name;
    lsSet(projectKey(name), JSON.stringify(data));
    lsSet(LAST_OPENED, name);
    setProjectName(name);
    setSaving(false);
    setLastSavedAt(data.meta.updatedAt);
    const updated = upsertProjectIndex(name, data.meta.id, data.meta.updatedAt);
    setProjectOptions(updated.map((p) => p.name));
  }

  function loadProject(name: string): boolean {
    const raw = lsGet(projectKey(name));
    const p = safeParse<ProjectJSON>(raw);
    if (!p) return false;
    deserialize(p);
    lsSet(LAST_OPENED, name);
    return true;
  }

  function ensureUniqueName(base: string): string {
    // Only run this if we’re in the browser
    if (typeof window === "undefined") return base;

    const list = listProjects(); // internally uses lsGet now
    const names = new Set(list.map((p) => p.name));

    if (!names.has(base)) return base;

    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  // --- Background pointer handlers (pan or place)
  function onBgPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const isLeftMouse = e.pointerType !== "mouse" || e.button === 0;
    if (!isLeftMouse) return;
    if (world.mode === "connect") return;

    // If in add-node mode: create the node and open the modal
    if (world.mode === "add-node") {
      const rect = bgRef.current!.getBoundingClientRect();
      const { x, y } = screenToWorld(
        e.clientX - rect.left,
        e.clientY - rect.top
      );
      let px = x,
        py = y;
      if (snap) {
        px = snapTo(x, gridSize);
        py = snapTo(y, gridSize);
      }

      const newNode: NodeT = {
        id: uid(),
        x: px,
        y: py,
        name: "New Node",
        color: "sky",
        size: "small",
      };

      commit();
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
    // Clear selection when clicking empty space
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
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
  function onBgWheel(e: React.WheelEvent<HTMLDivElement>) {
    // Only zoom when ctrl/cmd is held (prevents accidental zoom on scroll)
    // Note: on many browsers, trackpad pinch sets e.ctrlKey = true.
    if (!(e.ctrlKey || e.metaKey)) return;

    e.preventDefault();

    const rect = bgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left; // screen coords inside the grid
    const sy = e.clientY - rect.top;

    // world coords under cursor BEFORE zoom
    const wx = (sx - world.panX) / world.zoom;
    const wy = (sy - world.panY) / world.zoom;

    // zoom delta
    const direction = e.deltaY > 0 ? 1 : -1; // wheel down = zoom out
    const factor = direction > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;

    const newZoom = clamp(world.zoom * factor, ZOOM_MIN, ZOOM_MAX);

    // keep cursor point stable: solve pan' so (sx - panX')/newZoom = wx
    const newPanX = sx - wx * newZoom;
    const newPanY = sy - wy * newZoom;

    setWorld((w) => ({ ...w, zoom: newZoom, panX: newPanX, panY: newPanY }));
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

      commit();
      setWorld((w) => {
        if (!snap) return { ...w, mode: "idle", draggingNodeId: null };
        return {
          ...w,
          nodes: w.nodes.map((n) =>
            n.id === id
              ? { ...n, x: snapTo(n.x, gridSize), y: snapTo(n.y, gridSize) }
              : n
          ),
          mode: "idle",
          draggingNodeId: null,
        };
      });
    };

  const [projectOptions, setProjectOptions] = useState<string[]>([]);

  // only runs in the browser
  useEffect(() => {
    const list = listProjects(); // this uses lsGet internally
    setProjectOptions(list.map((p) => p.name));
  }, []);

  // --- Keyboard: Esc to leave add-node
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (renameOpen) {
          setRenameOpen(false);
          setEditingNodeId(null);
        } else {
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setWorld((w) => ({ ...w, mode: "idle" }));
        }
        return;
      }
      //snap
      if (e.key.toLowerCase() === "g") {
        setSnap((s) => !s);
        return;
      }
      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        // If a node is selected, delete node + attached edges
        if (selectedNodeId) {
          commit();
          setWorld((w) => ({
            ...w,
            nodes: w.nodes.filter((n) => n.id !== selectedNodeId),
            edges: w.edges.filter(
              (ed) => ed.fromId !== selectedNodeId && ed.toId !== selectedNodeId
            ),
          }));
          setSelectedNodeId(null);
          return;
        }
        // If an edge is selected, delete the edge
        if (selectedEdgeId) {
          commit();
          setWorld((w) => ({
            ...w,
            edges: w.edges.filter((ed) => ed.id !== selectedEdgeId),
          }));
          setSelectedEdgeId(null);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renameOpen, selectedNodeId, selectedEdgeId]);

  // ---- Load last project or create new ----
  useEffect(() => {
    if (!hasLS()) return; // just to be 100% safe in SSR

    const last = lsGet(LAST_OPENED);
    if (last && loadProject(last)) return;

    // no saved project → start a fresh one
    const name = ensureUniqueName("Untitled");
    setProjectName(name);
    setProjectId("proj_" + uid().slice(2));
    setWorld((w) => ({
      ...w,
      panX: 0,
      panY: 0,
      zoom: 1,
      nodes: [],
      edges: [],
    }));
    setTimeout(() => saveProject(name), 0);
  }, []);

  // ---- Autosave (debounced) ----
  useEffect(() => {
    setSaving(true);
    const t = setTimeout(() => saveProject(projectName), 500);
    return () => clearTimeout(t);
  }, [world, projectName]);

  return (
    <div className="relative h-[calc(100vh-56px)] w-full border-t border-white/10">
      {/* Toolbar (temporary, simple controls) */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-white/10 bg-black relative z-50">
        {/* Project name */}
        <span className="text-white/80 mr-2">
          {projectName}
          <span className="ml-2 text-xs text-white/40">
            {saving ? "Saving…" : lastSavedAt ? "Saved ✓" : ""}
          </span>
        </span>

        {/* New */}
        <button
          onClick={() => {
            const name = ensureUniqueName("Untitled");
            setProjectName(name);
            setProjectId("proj_" + uid().slice(2));
            setWorld((w) => ({
              ...w,
              panX: 0,
              panY: 0,
              zoom: 1,
              nodes: [],
              edges: [],
            }));
            setTimeout(() => saveProject(name), 0);
          }}
          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
        >
          New
        </button>

        {/* Save As */}
        <button
          onClick={() => {
            const name = prompt("Save As:", projectName) || projectName;
            const final = ensureUniqueName(name.trim());
            saveProject(final);
          }}
          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
        >
          Save As…
        </button>

        {/* Open */}
        <div className="relative">
          <select
            value={projectName}
            onChange={(e) => {
              const ok = loadProject(e.target.value);
              if (!ok) alert("Could not load project.");
            }}
            className="px-3 py-1.5 rounded bg-white/10 border border-white/20 text-white"
          >
            {[
              projectName,
              ...projectOptions.filter((n) => n !== projectName),
            ].map((name) => (
              <option key={name} value={name} className="text-black bg-white">
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* Export */}
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(serialize(), null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${projectName}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
        >
          Export
        </button>

        {/* Import (hidden input) */}
        <label className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15 cursor-pointer">
          Import
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              const p = safeParse<ProjectJSON>(text);
              if (!p) {
                alert("Invalid JSON");
                return;
              }
              try {
                deserialize(p);
                const finalName = ensureUniqueName(p.meta.name || "Imported");
                setProjectName(finalName);
                setProjectId(p.meta.id || "proj_" + uid().slice(2));
                saveProject(finalName);
              } catch {
                alert("Import failed.");
              } finally {
                e.currentTarget.value = "";
              }
            }}
          />
        </label>

        {/* Existing buttons: Add Node / Reset View / Connect */}
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
          onClick={() => {
            commit();
            setWorld((w) => ({ ...w, panX: 0, panY: 0, zoom: 1 }));
          }}
          className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
        >
          Reset View
          <span className="ml-2 text-white/60 text-sm">
            {(world.zoom * 100).toFixed(0)}%
          </span>
        </button>

        <button
          onClick={() => {
            setWorld((w) => ({
              ...w,
              mode: w.mode === "connect" ? "idle" : "connect",
            }));
            setConnectingFromId(null);
          }}
          className={`px-3 py-1.5 rounded ${
            world.mode === "connect"
              ? "bg-sky-600 text-white"
              : "bg-white/10 hover:bg-white/15"
          }`}
        >
          {world.mode === "connect" ? "Connect: ON (Esc to exit)" : "Connect"}
        </button>

        {/* Snap button */}
        <button
          onClick={() => setSnap((s) => !s)}
          className={`px-3 py-1.5 rounded ${
            snap ? "bg-indigo-600 text-white" : "bg-white/10 hover:bg-white/15"
          }`}
        >
          {snap ? "Snap: ON" : "Snap: OFF"}
        </button>

        {/* undo and redo buttons */}
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          className={`px-3 py-1.5 rounded ${
            undoStack.length
              ? "bg-white/10 hover:bg-white/15"
              : "bg-white/5 text-white/40 cursor-not-allowed"
          }`}
        >
          Undo
        </button>

        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          className={`px-3 py-1.5 rounded ${
            redoStack.length
              ? "bg-white/10 hover:bg-white/15"
              : "bg-white/5 text-white/40 cursor-not-allowed"
          }`}
        >
          Redo
        </button>
      </div>

      {/* Grid layer */}
      <div
        ref={bgRef}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={onBgPointerUp}
        onPointerCancel={onBgPointerUp}
        onWheel={onBgWheel}
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
          {/* Edges layer (SVG so lines sit under nodes) */}
          <svg
            className="absolute inset-0 overflow-visible" // ← remove pointer-events-none
            width="100%"
            height="100%"
          >
            {world.edges.map((e) => {
              const a = world.nodes.find((n) => n.id === e.fromId);
              const b = world.nodes.find((n) => n.id === e.toId);
              if (!a || !b) return null;

              const isSelected = selectedEdgeId === e.id;

              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={
                    isSelected
                      ? "rgba(56,189,248,0.95)"
                      : "rgba(255,255,255,0.6)"
                  } // sky-400 when selected
                  strokeWidth={isSelected ? 4 : 2}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: "pointer", pointerEvents: "stroke" }}
                  onPointerDown={(evt) => {
                    evt.stopPropagation(); // don’t start a pan
                    if (world.mode === "connect") return; // ignore while connecting
                    setSelectedEdgeId(e.id);
                    setSelectedNodeId(null);
                  }}
                />
              );
            })}
          </svg>

          {world.nodes.map((n) => {
            const px = nodeSizePx(n); // size
            const col = nodeColors(n); // color
            const isSelected = selectedNodeId === n.id;
            const isConnectingStart =
              world.mode === "connect" && connectingFromId === n.id;

            return (
              <div
                key={n.id}
                onPointerDown={(e) => {
                  if (world.mode === "connect") {
                    e.stopPropagation();

                    // 1st click: pick a start node
                    if (!connectingFromId) {
                      setConnectingFromId(n.id);
                    } else if (connectingFromId !== n.id) {
                      // avoid duplicates (A→B or B→A)
                      const exists = world.edges.some(
                        (ed) =>
                          (ed.fromId === connectingFromId &&
                            ed.toId === n.id) ||
                          (ed.fromId === n.id && ed.toId === connectingFromId)
                      );
                      if (!exists) {
                        commit();
                        setWorld((w) => ({
                          ...w,
                          edges: [
                            ...w.edges,
                            {
                              id: uid(),
                              fromId: connectingFromId!,
                              toId: n.id,
                            },
                          ],
                        }));
                      }
                      setConnectingFromId(null); // reset for next connection
                    } else {
                      // clicked the same node again → cancel
                      setConnectingFromId(null);
                    }

                    return; // don't begin drag when connecting
                  }

                  // Normal click: select this node, clear any edge selection, then start drag
                  setSelectedNodeId(n.id);
                  setSelectedEdgeId(null);
                  onNodePointerDown(n.id)(e);
                }}
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
                    // highlight if selected or the starting node in connect mode
                    boxShadow:
                      isSelected || isConnectingStart
                        ? "0 0 0 4px rgba(56,189,248,0.35)"
                        : undefined,
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
                  commit();
                  setWorld((w) => ({
                    ...w,
                    nodes: w.nodes.filter((nd) => nd.id !== editingNodeId),
                    edges: w.edges.filter(
                      (e) =>
                        e.fromId !== editingNodeId && e.toId !== editingNodeId
                    ),
                  }));
                  setSelectedNodeId(null);
                  setSelectedEdgeId(null);
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
                      commit();
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
