import { useEffect, useRef, useState } from "react";
import {
  BoxGeometry,
  Box3,
  Box3Helper,
  BufferGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  GridHelper,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createImportedGroupAsync, disposeImportedScene, SceneBudgetExceeded } from "./imported-scene";
import { prepareGeometry } from "./prepare-geometry";
import { reuseGeometryCache } from "./ldraw-geometry";
import { importedSelectionBounds, pickSoftwareInstance } from "./imported-selection";
import { createSoftwareScene, updateSoftwareScene, previewSoftware, restoreSoftware, INTERACTIVE_TRIANGLE_BUDGET, type SoftwareScene } from "./software-scene";
import { InstanceIndex, instanceIndex } from "./instance-index";
import { activeConnections, magneticConstructionTransform, hasUsableConnections } from "../connections/engine";
import type { MagneticLatch } from "../connections/engine";
import { ConnectionOverlay } from "../connections/overlay";
import type { ConnectionTransform } from "../connections/types";
import { createBuilderLighting } from "./lighting";
import type { Affine, ImportedModel } from "../formats/types";
import { cameraGesture, type GestureStart, type PointerPoint } from "./camera-gesture";

import {
  BRICK_DEFINITIONS,
  BRICK_HEIGHT,
  GRID_STEP,
  type Brick,
  type BrickType,
  type Position3,
  type ToolMode,
} from "@/features/editor/model";

interface BuilderCanvasProps {
  projectId?: string;
  bricks: Brick[];
  imported?: ImportedModel;
  selectedId: string | null;
  selectedType: BrickType;
  selectedColor: string;
  toolMode: ToolMode;
  onPlace: (position: Position3) => void;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: Position3, transform?: Affine) => void;
}

interface DragCandidate {
  id: string;
  pointerId: number;
  start: PointerPoint;
  origin: Position3;
  moved: boolean;
  destination: Position3 | null;
  needsSnap?: boolean;
  matrix?: Affine;
  connection?: ConnectionTransform;
  magneticLatch?: MagneticLatch;
  planeStart: Position3 | null;
}

interface BrickHit {
  id: string;
  point: Vector3;
}

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

class FallbackRenderer {
  readonly domElement = document.createElement("canvas");
  private readonly context = this.domElement.getContext("2d");
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
  private width = 1;
  private height = 1;

  constructor() {
    if (!this.context) throw new Error("2D canvas fallback is unavailable.");
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.domElement.width = Math.max(1, Math.round(width * this.pixelRatio));
    this.domElement.height = Math.max(1, Math.round(height * this.pixelRatio));
    this.domElement.style.width = `${width}px`;
    this.domElement.style.height = `${height}px`;
  }

  render(
    camera: PerspectiveCamera,
    target: Vector3,
    bricks: Brick[],
    selectedId: string | null,
    imported?: SoftwareScene,
    importOffset = 0,
    interactive = false,
  ): void {
    const context = this.context;
    if (!context) return;
    camera.updateMatrixWorld(true);
    const forward = target.clone().sub(camera.position).normalize();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    const focalLength = (this.height / 2) / Math.tan((camera.fov * Math.PI) / 360);
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    context.fillStyle = "#eef1ec";
    context.fillRect(0, 0, this.width, this.height);

    const project = (x: number, y: number, z: number): ProjectedPoint => {
      const relative = new Vector3(x, y, z).sub(camera.position);
      const depth = relative.dot(forward);
      return {
        x: this.width / 2 + (relative.dot(right) * focalLength) / depth,
        y: this.height / 2 - (relative.dot(up) * focalLength) / depth,
        depth,
      };
    };

    const board = [
      project(-8, -0.025, -8),
      project(8, -0.025, -8),
      project(8, -0.025, 8),
      project(-8, -0.025, 8),
    ];
    fillPolygon(context, board, "#e1e6df", "#d2d9d1");
    context.save();
    polygonPath(context, board);
    context.clip();
    context.lineWidth = 0.7;
    context.strokeStyle = "rgba(118, 139, 126, 0.35)";
    for (let coordinate = -8; coordinate <= 8; coordinate += GRID_STEP) {
      const isMajorLine = Math.abs(coordinate % 1) < 0.001;
      context.lineWidth = isMajorLine ? 0.7 : 0.45;
      context.strokeStyle = isMajorLine
        ? "rgba(118, 139, 126, 0.35)"
        : "rgba(118, 139, 126, 0.17)";
      const xLine = [
        project(coordinate, -0.018, -8),
        project(coordinate, -0.018, 8),
      ];
      const zLine = [
        project(-8, -0.018, coordinate),
        project(8, -0.018, coordinate),
      ];
      for (const line of [xLine, zLine]) {
        context.beginPath();
        context.moveTo(line[0].x, line[0].y);
        context.lineTo(line[1].x, line[1].y);
        context.stroke();
      }
    }
    context.restore();

    // Bounded, pretransformed source triangles; never traverse the full model
    // or allocate millions of world-space vectors for a camera movement.
    if (imported) {
      const faces: { points: ProjectedPoint[]; depth: number; color: string; alpha: number; selected: boolean }[] = [];
      const stride = interactive ? Math.max(1, Math.ceil(imported.triangleCount / INTERACTIVE_TRIANGLE_BUDGET)) : 1;
      for (let triangle = 0; triangle < imported.triangleCount; triangle += stride) {
            if (imported.alpha[triangle] === 0) continue;
            const index = triangle * 9, vertices = imported.positions;
            const points = [0, 3, 6].map(offset => project(vertices[index + offset], vertices[index + offset + 1] + importOffset, vertices[index + offset + 2]));
            if (points.some(p => p.depth < 0.1)) continue;
            const area = (points[1].x - points[0].x) * (points[2].y - points[0].y) - (points[1].y - points[0].y) * (points[2].x - points[0].x);
            if (Math.abs(area) < 0.08) continue;
            faces.push({ points, depth: points.reduce((s, p) => s + p.depth, 0) / 3, color: imported.colors[triangle], alpha: imported.alpha[triangle], selected: imported.triangleIds[triangle] === selectedId });
      }
      faces.sort((a, b) => b.depth - a.depth);
      for (const face of faces) {
        polygonPath(context, face.points);
        context.globalAlpha = face.alpha;
        context.fillStyle = face.color;
        context.fill();
        if (face.selected) {
          context.globalAlpha = 1;
          context.strokeStyle = "#e45e32"; context.lineWidth = 1.5; context.stroke();
        }
      }
      context.globalAlpha = 1;
    }

    const orderedBricks = [...bricks].sort(
      (first, second) =>
        camera.position.distanceTo(new Vector3(second.x, second.y, second.z)) -
        camera.position.distanceTo(new Vector3(first.x, first.y, first.z)),
    );
    let visibleBricks = 0;
    for (const brick of orderedBricks) {
      const center = project(brick.x, brick.y, brick.z);
      if (center.depth < 0.1 || center.x < -96 || center.x > this.width + 96 || center.y < -96 || center.y > this.height + 96) continue;
      if (visibleBricks++ >= (interactive ? 300 : 1200) && brick.id !== selectedId) continue;
      const definition = BRICK_DEFINITIONS[brick.type];
      const theta = (brick.rotation * Math.PI) / 180;
      const corners = [
        [-definition.studsX / 2, -definition.studsZ / 2],
        [definition.studsX / 2, -definition.studsZ / 2],
        [definition.studsX / 2, definition.studsZ / 2],
        [-definition.studsX / 2, definition.studsZ / 2],
      ].map(([localX, localZ]) => ({
        x: brick.x + localX * Math.cos(theta) + localZ * Math.sin(theta),
        z: brick.z - localX * Math.sin(theta) + localZ * Math.cos(theta),
      }));
      const bottom = corners.map(({ x, z }) => project(x, brick.y, z));
      const topY = brick.y + BRICK_HEIGHT - 0.08;
      const top = corners.map(({ x, z }) => project(x, topY, z));
      const color = new Color(brick.color);
      const cameraDirection = new Vector2(
        camera.position.x - brick.x,
        camera.position.z - brick.z,
      );
      const visibleSides = corners
        .map((corner, index) => {
          const next = corners[(index + 1) % corners.length];
          const dx = next.x - corner.x;
          const dz = next.z - corner.z;
          const normal = new Vector2(dz, -dx);
          const towardCamera = normal.dot(cameraDirection);
          const face = [
            bottom[index],
            bottom[(index + 1) % bottom.length],
            top[(index + 1) % top.length],
            top[index],
          ];
          const centerDepth = face.reduce((sum, point) => sum + point.depth, 0) / face.length;
          return { face, towardCamera, centerDepth };
        })
        .filter((side) => side.towardCamera > 0)
        .sort((first, second) => second.centerDepth - first.centerDepth);
      for (const [index, side] of visibleSides.entries()) {
        const shade = index === 0 ? 0.72 : 0.84;
        fillPolygon(context, side.face, color.clone().multiplyScalar(shade).getStyle(), "#7d453b");
      }
      fillPolygon(
        context,
        top,
        color.clone().lerp(new Color("#ffffff"), 0.12).getStyle(),
        "#75433a",
      );

      for (let x = 0; x < definition.studsX; x += 1) {
        for (let z = 0; z < definition.studsZ; z += 1) {
          const localX = x - (definition.studsX - 1) / 2;
          const localZ = z - (definition.studsZ - 1) / 2;
          const worldX = brick.x + localX * Math.cos(theta) + localZ * Math.sin(theta);
          const worldZ = brick.z - localX * Math.sin(theta) + localZ * Math.cos(theta);
          const center = project(worldX, brick.y + BRICK_HEIGHT, worldZ);
          const radiusPoint = project(worldX + 0.22, brick.y + BRICK_HEIGHT, worldZ);
          const radius = Math.max(1.6, Math.min(8, Math.abs(radiusPoint.x - center.x)));
          context.beginPath();
          context.ellipse(center.x, center.y, radius, Math.max(1.4, radius * 0.62), 0, 0, Math.PI * 2);
          context.fillStyle = color.clone().lerp(new Color("#ffffff"), 0.24).getStyle();
          context.fill();
          context.strokeStyle = color.clone().multiplyScalar(0.7).getStyle();
          context.lineWidth = 0.8;
          context.stroke();
        }
      }

      if (selectedId === brick.id) {
        const selectionTop = corners.map(({ x, z }) =>
          project(x, brick.y + BRICK_HEIGHT + 0.18, z),
        );
        polygonPath(context, selectionTop);
        context.strokeStyle = "#b84e37";
        context.lineWidth = 2;
        context.setLineDash([4, 3]);
        context.stroke();
        context.setLineDash([]);
      }
    }
  }
}

const geometryCache = new Map<BrickType, ReturnType<typeof mergeGeometries>>();

function polygonPath(context: CanvasRenderingContext2D, points: ProjectedPoint[]): void {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
}

function fillPolygon(
  context: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  fill: string,
  stroke: string,
): void {
  polygonPath(context, points);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 0.85;
  context.stroke();
}

function brickGeometry(type: BrickType) {
  const cached = geometryCache.get(type);
  if (cached) return cached;

  const definition = BRICK_DEFINITIONS[type];
  const bodyHeight = BRICK_HEIGHT - 0.08;
  const studHeight = 0.16;
  const pieces: BufferGeometry[] = [];
  const body = new BoxGeometry(
    definition.studsX - 0.035,
    bodyHeight,
    definition.studsZ - 0.035,
  );
  body.translate(0, bodyHeight / 2, 0);
  pieces.push(body);

  for (let x = 0; x < definition.studsX; x += 1) {
    for (let z = 0; z < definition.studsZ; z += 1) {
      const cylinder = new CylinderGeometry(0.27, 0.27, studHeight, 16);
      cylinder.translate(
        x - (definition.studsX - 1) / 2,
        bodyHeight + studHeight / 2,
        z - (definition.studsZ - 1) / 2,
      );
      pieces.push(cylinder);
    }
  }

  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error(`Could not build geometry for ${type}.`);
  merged.computeVertexNormals();
  geometryCache.set(type, merged);
  return merged;
}

function makeCameraPosition(
  camera: PerspectiveCamera,
  target: Vector3,
  theta: number,
  phi: number,
  distance: number,
) {
  camera.position.set(
    target.x + distance * Math.sin(phi) * Math.sin(theta),
    target.y + distance * Math.cos(phi),
    target.z + distance * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(target);
}

function fitImportedView(
  camera: PerspectiveCamera,
  bounds: Box3,
  state: { target: Vector3; distance: number; theta: number; phi: number },
): void {
  if (bounds.isEmpty()) return;
  bounds.getCenter(state.target);
  // Fit the bounding sphere against the narrower field of view, including portrait.
  const halfVertical = camera.fov * Math.PI / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
  const radius = bounds.getSize(new Vector3()).length() / 2;
  state.distance = Math.max(8, radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.08);
  camera.far = Math.max(2000, (state.distance + radius) * 8);
  camera.updateProjectionMatrix();
  makeCameraPosition(camera, state.target, state.theta, state.phi, state.distance);
}

function getFootprint(brick: Brick) {
  const definition = BRICK_DEFINITIONS[brick.type];
  const swapped = Math.abs(brick.rotation % 180) === 90;
  return {
    width: swapped ? definition.studsZ : definition.studsX,
    depth: swapped ? definition.studsX : definition.studsZ,
  };
}

function softwareWarning(scene: SoftwareScene): string {
  const samples = scene.triangleCount - scene.free.length;
  return `Kompatibilitätsansicht ohne WebGL: ${samples.toLocaleString("de-DE")} von ${scene.sourceTriangles.toLocaleString("de-DE")} Dreiecken. Während der Bewegung sind Details reduziert; alle Projektdaten bleiben erhalten.`;
}

export function BuilderCanvas({
  projectId,
  bricks,
  imported,
  selectedId,
  selectedType,
  selectedColor,
  toolMode,
  onPlace,
  onSelect,
  onMove,
}: BuilderCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const rendererRef = useRef<WebGLRenderer | FallbackRenderer | null>(null);
  const brickRootRef = useRef<Group | null>(null);
  const importedRootRef = useRef<Group | null>(null);
  const sceneModelRef = useRef<ImportedModel | undefined>(undefined);
  const sceneProjectRef = useRef<string | undefined>(undefined);
  const selectionOutlineRef = useRef<Box3Helper | null>(null);
  const importedBoundsRef = useRef<Box3 | null>(null);
  const softwareSceneRef = useRef<SoftwareScene | undefined>(undefined);
  const importedOffsetRef = useRef(0);
  const interactionTimeRef = useRef(-Infinity);
  const buildControllerRef = useRef<AbortController | null>(null);
  const [sceneStatus, setSceneStatus] = useState<string | null>(null);
  const [renderWarning, setRenderWarning] = useState<string | null>(null);
  const [buildAttempt, setBuildAttempt] = useState(0);
  const [forceCompatibility, setForceCompatibility] = useState(false);
  const pendingPreviewRef = useRef<(() => void) | null>(null);
  const rollbackRef = useRef<(() => void) | null>(null);
  const previewBrickRef = useRef<Brick | null>(null);
  const attemptRef = useRef(-1);
  const overlayRef = useRef<ConnectionOverlay | null>(null);
  const [showConnections, setShowConnections] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState("");
  const refreshConnections = () => {
    const overlay = overlayRef.current, model = propsRef.current.imported, id = propsRef.current.selectedId;
    if (!overlay) return;
    if (model !== sceneModelRef.current) { overlay.contacts = []; setConnectionStatus(""); return; }
    overlay.contacts = model && id ? activeConnections(model, id) : [];
    const instance = model?.instances.find(value => value.id === id);
    setConnectionStatus(overlay.contacts.length ? `${overlay.contacts.length} geprüfte Verbindung${overlay.contacts.length === 1 ? "" : "en"}` :
      instance && model ? hasUsableConnections(model, instance.id) ? "Keine aktive Verbindung" : "Keine nutzbaren Verbindungsdaten · freie Platzierung" : "");
  };
  const updateImportedSelection = () => {
    const old = selectionOutlineRef.current;
    const id = propsRef.current.selectedId, root = importedRootRef.current;
    const bounds = id && root ? importedSelectionBounds(root, id) : null;
    if (old && bounds) { old.box.copy(bounds); invalidatorRef.current?.(); return; }
    if (old) { sceneRef.current?.remove(old); old.geometry.dispose(); disposeMaterial(old.material); selectionOutlineRef.current = null; }
    if (id && root) {
      if (bounds) {
        const outline = new Box3Helper(bounds, 0xe45e32);
        for (const material of Array.isArray(outline.material) ? outline.material : [outline.material]) material.depthTest = false;
        outline.renderOrder = 100;
        sceneRef.current?.add(outline); selectionOutlineRef.current = outline;
      }
    }
    invalidatorRef.current?.();
  };
  const invalidatorRef = useRef<(() => void) | null>(null);
  const raycasterRef = useRef(new Raycaster());
  const propsRef = useRef({
    projectId,
    bricks,
    imported,
    selectedId,
    selectedType,
    selectedColor,
    toolMode,
    onPlace,
    onSelect,
    onMove,
  });
  const pointersRef = useRef(new Map<number, PointerPoint>());
  const pointerLastRef = useRef(new Map<number, PointerPoint>());
  const gestureStartRef = useRef<GestureStart | null>(null);
  const gesturePairRef = useRef<readonly [number, number] | null>(null);
  const cameraOnlyRef = useRef(false);
  const dragRef = useRef<DragCandidate | null>(null);
  const clickRef = useRef<{ id: number; start: PointerPoint; moved: boolean } | null>(
    null,
  );
  const cameraStateRef = useRef({
    theta: 0.72,
    phi: 0.93,
    distance: 17,
    target: new Vector3(0, 0, 0),
  });

  propsRef.current = {
    projectId,
    bricks,
    imported,
    selectedId,
    selectedType,
    selectedColor,
    toolMode,
    onPlace,
    onSelect,
    onMove,
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new Scene();
    scene.background = new Color("#eef1ec");
    const camera = new PerspectiveCamera(42, 1, 0.1, 4000);
    let renderer: WebGLRenderer | FallbackRenderer;
    const renderCanvas = document.createElement("canvas");
    const webglContext = renderCanvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (webglContext) {
      renderer = new WebGLRenderer({
        canvas: renderCanvas,
        context: webglContext,
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFSoftShadowMap;
    } else {
      renderer = new FallbackRenderer();
      renderer.domElement.setAttribute("data-renderer", "canvas-fallback");
    }
    renderer.domElement.setAttribute("class", "builder-webgl-canvas");
    renderer.domElement.setAttribute("aria-label", "Interactive 3D brick building area");
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.userSelect = "none";
    host.appendChild(renderer.domElement);
    const overlay = new ConnectionOverlay(host);
    overlayRef.current = overlay;
    const contextLost = (event: Event) => {
      if (rendererRef.current !== renderer) return;
      event.preventDefault();
      setForceCompatibility(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    scene.add(createBuilderLighting());

    const board = new Mesh(
      new BoxGeometry(34, 0.14, 34),
      new MeshLambertMaterial({ color: "#e1e6df" }),
    );
    board.position.y = -0.1;
    board.receiveShadow = true;
    scene.add(board);
    const grid = new GridHelper(34, 34, 0x96a99d, 0xc5cec7);
    grid.position.y = -0.025;
    scene.add(grid);

    const brickRoot = new Group();
    scene.add(brickRoot);
    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    brickRootRef.current = brickRoot;

    const cameraState = cameraStateRef.current;
    makeCameraPosition(
      camera,
      cameraState.target,
      cameraState.theta,
      cameraState.phi,
      cameraState.distance,
    );

    let animationFrame: number | null = null;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    const invalidate = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        const preview = pendingPreviewRef.current;
        pendingPreviewRef.current = null;
        preview?.();
        const interactive = performance.now() - interactionTimeRef.current < 180;
        const activeRenderer = rendererRef.current ?? renderer;
        if (activeRenderer instanceof WebGLRenderer) {
          const ratio = interactive ? 0.85 : Math.min(window.devicePixelRatio || 1, 1.25);
          if (ratio !== lastPixelRatio) { activeRenderer.setPixelRatio(ratio); lastPixelRatio = ratio; }
          importedRootRef.current?.children.forEach(child => {
            if (child.name === "ldraw:instanced-edges") child.visible = !interactive;
          });
          try { activeRenderer.render(scene, camera); }
          catch { setForceCompatibility(true); }
        } else {
          activeRenderer.render(
            camera,
            cameraStateRef.current.target,
            previewBrickRef.current ? propsRef.current.bricks.map(brick => brick.id === previewBrickRef.current!.id ? previewBrickRef.current! : brick) : propsRef.current.bricks,
            propsRef.current.selectedId,
            softwareSceneRef.current,
            importedOffsetRef.current,
            interactive,
          );
        }
        overlay.draw(camera, importedOffsetRef.current, id => {
          const box = importedRootRef.current ? instanceIndex(importedRootRef.current)?.records.get(id)?.bounds : softwareSceneRef.current?.instanceBounds.get(id);
          return box ?? null;
        });
        if (interactive) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(invalidate, 190);
        }
      });
    };
    invalidatorRef.current = invalidate;

    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setRendererSize(rendererRef.current ?? renderer, width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (importedBoundsRef.current) fitImportedView(camera, importedBoundsRef.current, cameraStateRef.current);
      invalidate();
    });
    resizeObserver.observe(host);
    invalidate();

    return () => {
      overlay.dispose(); if (overlayRef.current === overlay) overlayRef.current = null;
      resizeObserver.disconnect();
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      clearTimeout(settleTimer);
      invalidatorRef.current = null;
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      if (importedRootRef.current) {
        scene.remove(importedRootRef.current);
        disposeImported(importedRootRef.current);
        importedRootRef.current = null;
      }
      scene.traverse((object) => {
        if (object instanceof InstancedMesh) object.dispose();
        if (object instanceof Mesh) {
          disposeMaterial(object.material);
          if (!geometryCacheHas(object.geometry)) object.geometry.dispose();
        } else if (object instanceof LineSegments) {
          disposeMaterial(object.material);
          object.geometry.dispose();
        }
      });
      if (renderer instanceof WebGLRenderer) renderer.dispose();
      renderer.domElement.remove();
      if (rendererRef.current && rendererRef.current !== renderer) rendererRef.current.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      brickRootRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;
    const previous = importedRootRef.current;
    const previousModel = sceneModelRef.current;
    const sameModel = sceneProjectRef.current === projectId && !!imported && previousModel?.originalBytes === imported.originalBytes;
    const previousOffset = importedOffsetRef.current;
    rollbackRef.current?.();
    const retry = attemptRef.current !== buildAttempt;
    attemptRef.current = buildAttempt;
    if (imported) reuseGeometryCache(previousModel, imported);
    if (imported && sameModel && !retry && !forceCompatibility) {
      try {
        const index = previous && instanceIndex(previous);
        const software = softwareSceneRef.current;
        if ((index && index.update(imported)) || (software && updateSoftwareScene(software, imported))) {
          sceneModelRef.current = imported;
          setSceneStatus(null);
          if (software) setRenderWarning(softwareWarning(software));
          updateImportedSelection();
          refreshConnections();
          return;
        }
      } catch (error) {
        setRenderWarning(`Darstellung konnte nicht aktualisiert werden: ${error instanceof Error ? error.message : String(error)}. Die bisherige Ansicht bleibt erhalten.`);
        return;
      }
    }
    // Software stays incremental after an explicit switch to compatibility mode.
    if (imported && sameModel && !retry && softwareSceneRef.current && forceCompatibility) {
      try {
        if (updateSoftwareScene(softwareSceneRef.current, imported)) {
          sceneModelRef.current = imported; setSceneStatus(null);
          refreshConnections();
          setRenderWarning(softwareWarning(softwareSceneRef.current));
          invalidatorRef.current?.(); return;
        }
      } catch (error) { setRenderWarning(`Kompatibilitätsansicht konnte nicht aktualisiert werden: ${String(error)}`); return; }
    }
    const controller = new AbortController();
    buildControllerRef.current = controller;
    setRenderWarning(null);
    setSceneStatus(imported ? "3D-Modell wird vorbereitet …" : null);
    const build = async () => {
      if (!imported) {
        if (previous) { scene.remove(previous); disposeImported(previous); }
        importedRootRef.current = null; softwareSceneRef.current = undefined;
        importedBoundsRef.current = null; importedOffsetRef.current = 0; sceneModelRef.current = undefined;
        updateImportedSelection();
        return;
      }
      let lastProgress = 0;
      const progress = (stage: string) => (completed: number, total: number) => {
        if (controller.signal.aborted || performance.now() - lastProgress < 80) return;
        lastProgress = performance.now();
        setSceneStatus(`${stage}: ${completed} / ${total}`);
      };
      await prepareGeometry(imported, { signal: controller.signal, onProgress: progress("Geometrie") });
      let root: Group | null = null, bounds: Box3;
      let software: SoftwareScene | undefined;
      if (rendererRef.current instanceof WebGLRenderer && !forceCompatibility) {
        try {
          const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
          const maxGeometryBytes = (memory <= 1 ? 32 : memory <= 2 ? 64 : 96) * 1024 * 1024;
          root = await createImportedGroupAsync(imported, {
            signal: controller.signal, onProgress: progress("3D-Szene"), maxGeometryBytes,
          });
        } catch (error) {
          if (!(error instanceof SceneBudgetExceeded)) throw error;
          // Budget is checked before GPU upload; switch instead of risking a
          // driver/context crash or throwing away the user's model.
        }
      }
      if (root) {
        try {
          const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
          new InstanceIndex(root, imported, (memory <= 1 ? 32 : memory <= 2 ? 64 : 96) * 1024 * 1024);
          bounds = new Box3().setFromObject(root);
        } catch (error) { disposeImported(root); throw error; }
      }
      else {
        software = await createSoftwareScene(imported, { signal: controller.signal, onProgress: progress("Kompatibilitätsansicht") });
        controller.signal.throwIfAborted();
        if (rendererRef.current instanceof WebGLRenderer) {
          const previousRenderer = rendererRef.current;
          previousRenderer.dispose();
          previousRenderer.domElement.remove();
          const fallback = new FallbackRenderer();
          fallback.domElement.className = "builder-webgl-canvas";
          fallback.domElement.setAttribute("data-renderer", "canvas-fallback");
          fallback.domElement.setAttribute("aria-label", "3D-Kompatibilitätsansicht");
          fallback.domElement.style.touchAction = "none";
          const rectangle = hostRef.current!.getBoundingClientRect();
          fallback.setSize(rectangle.width, rectangle.height);
          hostRef.current!.appendChild(fallback.domElement);
          rendererRef.current = fallback;
        }
        bounds = software.bounds.clone();
        setRenderWarning(softwareWarning(software));
      }
      if (controller.signal.aborted) { if (root) disposeImported(root); return; }
      if (previous) { scene.remove(previous); disposeImported(previous); }
      importedRootRef.current = null;
      softwareSceneRef.current = software;
      sceneModelRef.current = imported;
      sceneProjectRef.current = projectId;
      if (!bounds.isEmpty()) {
        const offset = sameModel ? previousOffset : Math.max(0, -bounds.min.y);
        if (root) root.position.y = offset;
        importedOffsetRef.current = offset;
        bounds.translate(new Vector3(0, offset, 0));
        importedBoundsRef.current = bounds;
        const rectangle = hostRef.current?.getBoundingClientRect();
        if (rectangle && rectangle.height > 0) {
          camera.aspect = rectangle.width / rectangle.height;
          camera.updateProjectionMatrix();
        }
        if (!sameModel) fitImportedView(camera, bounds, cameraStateRef.current);
      }
      if (root) { scene.add(root); importedRootRef.current = root; }
      updateImportedSelection();
      refreshConnections();
      setSceneStatus(null);
      invalidatorRef.current?.();
    };
    void build().catch(error => {
      if (controller.signal.aborted) return;
      setSceneStatus(null);
      setRenderWarning(`3D-Aufbau fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}. Projektdaten bleiben erhalten.`);
    });
    invalidatorRef.current?.();
    return () => {
      controller.abort();
    };
  }, [imported, buildAttempt, forceCompatibility, projectId]);

  useEffect(() => { rollbackRef.current?.(); }, [projectId, toolMode]);
  useEffect(() => {
    if (dragRef.current && (dragRef.current.id !== selectedId || sceneModelRef.current !== imported)) rollbackRef.current?.();
    if (!dragRef.current) refreshConnections();
    invalidatorRef.current?.();
  }, [imported, selectedId, projectId]);
  useEffect(() => {
    if (overlayRef.current) overlayRef.current.visible = showConnections;
    invalidatorRef.current?.();
  }, [showConnections]);

  useEffect(() => { updateImportedSelection(); }, [selectedId]);

  useEffect(() => {
    const scene = sceneRef.current;
    const previousRoot = brickRootRef.current;
    if (!scene || !previousRoot) return;
    scene.remove(previousRoot);
    previousRoot.traverse((object) => {
      if (object instanceof InstancedMesh) object.dispose();
      if (object instanceof Mesh) {
        disposeMaterial(object.material);
        if (!geometryCacheHas(object.geometry)) object.geometry.dispose();
      } else if (object instanceof LineSegments) {
        disposeMaterial(object.material);
        object.geometry.dispose();
      }
    });

    const nextRoot = new Group();
    const groups = new Map<string, Brick[]>();
    for (const brick of bricks) {
      const key = `${brick.type}|${brick.color.toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(brick);
      groups.set(key, group);
    }

    const dummy = new Object3D();
    for (const groupBricks of groups.values()) {
      const first = groupBricks[0];
      const material = new MeshLambertMaterial({ color: first.color });
      const instances = new InstancedMesh(
        brickGeometry(first.type),
        material,
        groupBricks.length,
      );
      instances.castShadow = true;
      instances.receiveShadow = true;
      instances.userData.brickIds = groupBricks.map((brick) => brick.id);
      instances.name = `brick-group-${first.type}`;
      groupBricks.forEach((brick, index) => {
        dummy.position.set(brick.x, brick.y, brick.z);
        dummy.rotation.set(0, (brick.rotation * Math.PI) / 180, 0);
        dummy.updateMatrix();
        instances.setMatrixAt(index, dummy.matrix);
      });
      instances.instanceMatrix.needsUpdate = true;
      nextRoot.add(instances);
    }

    const selected = bricks.find((brick) => brick.id === selectedId);
    if (selected) {
      const { width, depth } = getFootprint(selected);
      const outlineHeight = BRICK_HEIGHT + 0.24;
      const outlineGeometry = new EdgesGeometry(
        new BoxGeometry(width + 0.1, outlineHeight, depth + 0.1),
      );
      outlineGeometry.translate(0, outlineHeight / 2, 0);
      const outline = new LineSegments(
        outlineGeometry,
        new LineBasicMaterial({ color: "#b84e37", transparent: true, opacity: 0.9 }),
      );
      outline.position.set(selected.x, selected.y, selected.z);
      outline.rotation.y = (selected.rotation * Math.PI) / 180;
      outline.userData.isSelectionOutline = true;
      nextRoot.add(outline);
    }

    scene.add(nextRoot);
    brickRootRef.current = nextRoot;
    invalidatorRef.current?.();
  }, [bricks, selectedId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateCamera = (
      theta: number,
      phi: number,
      distance: number,
      target = cameraStateRef.current.target,
    ) => {
      const cameraState = cameraStateRef.current;
      const camera = cameraRef.current;
      if (!camera) return;
      cameraState.theta = theta;
      cameraState.phi = Math.max(0.25, Math.min(1.42, phi));
      const maxDistance = Math.max(1500, camera.far / 2);
      cameraState.distance = Math.max(3, Math.min(maxDistance, distance));
      cameraState.target.copy(target);
      interactionTimeRef.current = performance.now();
      makeCameraPosition(
        camera,
        cameraState.target,
        cameraState.theta,
        cameraState.phi,
        cameraState.distance,
      );
      invalidatorRef.current?.();
    };

    const makeRay = (point: PointerPoint) => {
      const rect = host.getBoundingClientRect();
      const ndc = new Vector2(
        ((point.x - rect.left) / rect.width) * 2 - 1,
        -((point.y - rect.top) / rect.height) * 2 + 1,
      );
      const camera = cameraRef.current;
      if (!camera) return null;
      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(ndc, camera);
      return raycaster;
    };

    const findBrick = (point: PointerPoint): BrickHit | null => {
      const raycaster = makeRay(point);
      const root = brickRootRef.current;
      if (!raycaster || !root) return null;
      importedRootRef.current?.updateMatrixWorld(true);
      const brickMeshes = root.children.filter(
        (child): child is Mesh =>
          child instanceof Mesh &&
          (typeof child.userData.brickId === "string" ||
            Array.isArray(child.userData.brickIds)),
      );
      const intersections = raycaster.intersectObjects(brickMeshes, false);
      const hit = intersections[0];
      const sceneMatches = sceneModelRef.current === propsRef.current.imported && sceneProjectRef.current === propsRef.current.projectId;
      const importedRoot = sceneMatches ? importedRootRef.current : null;
      const importedHit = importedRoot ? instanceIndex(importedRoot)?.pick(raycaster) : null;
      const software = sceneMatches ? softwareSceneRef.current : undefined;
      const softwareHit = software ? pickSoftwareInstance(raycaster.ray, software, importedOffsetRef.current) : null;
      const sourceHit = importedHit ?? softwareHit;
      if (sourceHit && (!hit || sourceHit.point.distanceTo(raycaster.ray.origin) < hit.distance)) return sourceHit;
      if (!hit) return null;
      let id = hit.object.userData.brickId as string | undefined;
      if (!id && hit.instanceId !== undefined) {
        const ids = hit.object.userData.brickIds as string[] | undefined;
        id = ids?.[hit.instanceId];
      }
      return id ? { id, point: hit.point.clone() } : null;
    };

    const projectToPlane = (point: PointerPoint, y: number): Position3 | null => {
      const raycaster = makeRay(point);
      if (!raycaster) return null;
      const plane = new Plane(new Vector3(0, 1, 0), -y);
      const intersection = raycaster.ray.intersectPlane(plane, new Vector3());
      return intersection
        ? { x: intersection.x, y, z: intersection.z }
        : null;
    };

    const rollback = () => {
      pendingPreviewRef.current = null;
      const drag = dragRef.current;
      if (drag) {
        if (importedRootRef.current) instanceIndex(importedRootRef.current)?.restore(drag.id);
        if (softwareSceneRef.current) restoreSoftware(softwareSceneRef.current, drag.id);
        const brick = propsRef.current.bricks.find(value => value.id === drag.id);
        if (brick) applyBrickPreview(brick);
      }
      previewBrickRef.current = null;
      dragRef.current = null; clickRef.current = null;
      if (overlayRef.current) overlayRef.current.contacts = [];
      setConnectionStatus("");
      updateImportedSelection();
    };
    rollbackRef.current = rollback;
    const applyBrickPreview = (brick: Brick) => {
      const dummy = new Object3D();
      dummy.position.set(brick.x, brick.y, brick.z); dummy.rotation.y = brick.rotation * Math.PI / 180; dummy.updateMatrix();
      for (const child of brickRootRef.current?.children ?? []) {
        if (child instanceof InstancedMesh) {
          const index = (child.userData.brickIds as string[]).indexOf(brick.id);
          if (index >= 0) { child.setMatrixAt(index, dummy.matrix); child.instanceMatrix.needsUpdate = true; child.boundingSphere = null; }
        } else if (child.userData.isSelectionOutline) child.position.set(brick.x, brick.y, brick.z);
      }
    };
    const resolveDrag = (drag: DragCandidate) => {
      if (!drag.destination || !drag.needsSnap) return;
      if (drag.matrix && propsRef.current.imported) {
        const offset = importedOffsetRef.current;
        const magnetic = magneticConstructionTransform(propsRef.current.imported, drag.id,
          { ...drag.destination, y: drag.destination.y - offset }, drag.magneticLatch);
        drag.magneticLatch = magnetic.latch;
        const result = magnetic.transform;
        drag.connection = result;
        if (overlayRef.current) overlayRef.current.contacts = result.contacts;
        setConnectionStatus(result.status === "candidate" ? `Magnetisch eingerastet · ${result.contacts.length} Verbindung${result.contacts.length === 1 ? "" : "en"} · zum Lösen weiterziehen` :
          result.status === "no-data" ? "Keine nutzbaren Verbindungsdaten · freie Platzierung" : "Keine passende Verbindung · freie Platzierung");
        const position = { x: result.matrix[3] / 20, y: -result.matrix[7] / 20, z: result.matrix[11] / 20 };
        drag.destination = { ...position, y: position.y + offset };
      } else {
        drag.destination.x = Math.round(drag.destination.x * 2) / 2;
        drag.destination.z = Math.round(drag.destination.z * 2) / 2;
      }
      drag.needsSnap = false;
    };
    const queuePreview = (drag: DragCandidate) => {
      pendingPreviewRef.current = () => {
        if (dragRef.current !== drag || !drag.destination) return;
        resolveDrag(drag);
        const position = drag.destination;
        if (drag.matrix) {
          const matrix = [...(drag.connection?.matrix ?? drag.matrix)] as Affine;
          // Connection matrices are already in original LDU coordinates.
          // A scene-unit/floor-offset round trip changes exact off-grid values
          // and must not make the visible preview differ from the transaction.
          if (!drag.connection) {
            matrix[3] = position.x * 20; matrix[7] = -(position.y - importedOffsetRef.current) * 20; matrix[11] = position.z * 20;
          }
          if (importedRootRef.current) instanceIndex(importedRootRef.current)?.preview(drag.id, matrix);
          if (softwareSceneRef.current) previewSoftware(softwareSceneRef.current, drag.id, matrix);
          updateImportedSelection();
        } else {
          const brick = propsRef.current.bricks.find(value => value.id === drag.id);
          if (brick) { previewBrickRef.current = { ...brick, ...position }; applyBrickPreview(previewBrickRef.current); }
        }
      };
      interactionTimeRef.current = performance.now();
      invalidatorRef.current?.();
    };

    const startGesture = () => {
      const ids = [...pointersRef.current.keys()];
      if (ids.length < 2) {
        gestureStartRef.current = null;
        gesturePairRef.current = null;
        return;
      }
      gesturePairRef.current = [ids[0], ids[1]];
      cameraOnlyRef.current = true;
      const cameraState = cameraStateRef.current;
      gestureStartRef.current = {
        points: [pointersRef.current.get(ids[0])!, pointersRef.current.get(ids[1])!],
        camera: { ...cameraState, target: cameraState.target.clone() },
      };
      rollback();
      clickRef.current = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      host.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      pointersRef.current.set(event.pointerId, point);
      pointerLastRef.current.set(event.pointerId, point);
      if (pointersRef.current.size > 1) {
        if (!gesturePairRef.current) startGesture();
        return;
      }

      clickRef.current = { id: event.pointerId, start: point, moved: false };
      const hit = findBrick(point);
      const current = propsRef.current;
      if (current.toolMode === "select") {
        if (hit) {
          current.onSelect(hit.id);
          const brick = current.bricks.find((item) => item.id === hit.id);
          const instance = current.imported?.instances.find(item => item.id === hit.id);
          const origin = brick ? { x: brick.x, y: brick.y, z: brick.z } :
            instance ? { x: instance.matrix[3] / 20, y: -instance.matrix[7] / 20 + importedOffsetRef.current, z: instance.matrix[11] / 20 } : null;
          if (origin) {
            dragRef.current = {
              id: hit.id,
              pointerId: event.pointerId,
              start: point,
              origin,
              moved: false,
              destination: null,
              matrix: instance?.matrix,
              planeStart: projectToPlane(point, origin.y),
            };
          }
        } else {
          dragRef.current = null;
        }
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      event.preventDefault();
      const previous = pointerLastRef.current.get(event.pointerId);
      const currentPoint = { x: event.clientX, y: event.clientY };
      pointerLastRef.current.set(event.pointerId, currentPoint);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointersRef.current.size >= 2) {
        const start = gestureStartRef.current;
        const pair = gesturePairRef.current;
        if (!start || !pair) {
          startGesture();
          return;
        }
        if (!pair.includes(event.pointerId)) return;
        const rect = host.getBoundingClientRect();
        const next = cameraGesture(start, [pointersRef.current.get(pair[0])!, pointersRef.current.get(pair[1])!],
          { width: rect.width, height: rect.height, fov: cameraRef.current!.fov });
        updateCamera(next.theta, next.phi, next.distance, next.target);
        return;
      }
      // A remaining finger must not resume the part action or orbit after takeover.
      if (cameraOnlyRef.current) return;

      const start = dragRef.current;
      const click = clickRef.current;
      if (
        click?.id === event.pointerId &&
        Math.hypot(event.clientX - click.start.x, event.clientY - click.start.y) > 5
      ) {
        click.moved = true;
      }
      if (
        start &&
        start.pointerId === event.pointerId &&
        propsRef.current.toolMode === "select"
      ) {
        const dx = event.clientX - start.start.x;
        const dy = event.clientY - start.start.y;
        if (Math.hypot(dx, dy) > 5) start.moved = true;
        if (start.moved) {
          const destination = projectToPlane(
            { x: event.clientX, y: event.clientY },
            start.origin.y,
          );
          if (destination) {
            start.destination = {
              x: start.origin.x + destination.x - (start.planeStart?.x ?? start.origin.x),
              y: start.origin.y,
              z: start.origin.z + destination.z - (start.planeStart?.z ?? start.origin.z),
            };
            start.needsSnap = true;
            queuePreview(start);
          }
          return;
        }
      }

      if (!start) {
        const deltaX = previous ? currentPoint.x - previous.x : 0;
        const deltaY = previous ? currentPoint.y - previous.y : 0;
        const cameraState = cameraStateRef.current;
        updateCamera(
          cameraState.theta - deltaX * 0.008,
          cameraState.phi - deltaY * 0.006,
          cameraState.distance,
        );
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      const point = { x: event.clientX, y: event.clientY };
      const current = propsRef.current;
      const click = clickRef.current;
      if (pointersRef.current.size === 1 && !cameraOnlyRef.current) {
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId && drag.moved) {
          resolveDrag(drag);
          if (drag.destination) {
            const destination = { ...drag.destination, y: drag.destination.y - (drag.matrix ? importedOffsetRef.current : 0) };
            const changed = drag.destination.x !== drag.origin.x || drag.destination.y !== drag.origin.y || drag.destination.z !== drag.origin.z ||
              !!drag.connection?.matrix.some((value, i) => value !== drag.matrix?.[i]);
            const transform = drag.connection?.matrix;
            rollback();
            if (changed) current.onMove(drag.id, destination, transform);
          }
        } else if (current.toolMode === "build" && click && !click.moved) {
          const hit = findBrick(point);
          let destination: Position3 | null = null;
          if (hit) {
            const brick = current.bricks.find((item) => item.id === hit.id);
            const y = brick ? brick.y + BRICK_HEIGHT : Math.max(0, hit.point.y);
            destination = projectToPlane(point, y);
          } else {
            destination = projectToPlane(point, 0);
          }
          if (destination) current.onPlace({ ...destination, y: destination.y - importedOffsetRef.current });
        } else if (current.toolMode === "delete" && click && !click.moved) {
          const hit = findBrick(point);
          if (hit) current.onSelect(hit.id);
        } else if (current.toolMode === "select" && !drag && click && !click.moved) {
          const hit = findBrick(point);
          current.onSelect(hit?.id ?? null);
        }
      }

      pointersRef.current.delete(event.pointerId);
      pointerLastRef.current.delete(event.pointerId);
      clickRef.current = null;
      if (gesturePairRef.current?.includes(event.pointerId)) startGesture();
      if (pointersRef.current.size === 0) cameraOnlyRef.current = false;
      if (pointersRef.current.size === 0) dragRef.current = null;
      if (host.hasPointerCapture(event.pointerId)) {
        host.releasePointerCapture(event.pointerId);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      // Releasing capture after a completed pointerup emits this too. That is
      // not a cancellation and must not clear newly verified committed ports.
      if (!pointersRef.current.has(event.pointerId) && dragRef.current?.pointerId !== event.pointerId) return;
      pointersRef.current.delete(event.pointerId);
      pointerLastRef.current.delete(event.pointerId);
      rollback();
      if (gesturePairRef.current?.includes(event.pointerId)) startGesture();
      if (pointersRef.current.size === 0) cameraOnlyRef.current = false;
      clickRef.current = null;
    };

    host.addEventListener("pointerdown", onPointerDown, { passive: false });
    host.addEventListener("pointermove", onPointerMove, { passive: false });
    host.addEventListener("pointerup", onPointerUp, { passive: false });
    host.addEventListener("pointercancel", onPointerCancel, { passive: false });
    host.addEventListener("lostpointercapture", onPointerCancel);
    const onBlur = () => {
      rollback(); pointersRef.current.clear(); pointerLastRef.current.clear();
      gestureStartRef.current = null; gesturePairRef.current = null; cameraOnlyRef.current = false;
    };
    window.addEventListener("blur", onBlur);
    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerCancel);
      host.removeEventListener("lostpointercapture", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      rollback(); rollbackRef.current = null;
    };
  }, []);

  const compatibilityHint = rendererRef.current instanceof FallbackRenderer && bricks.length > 1200
    ? "Kompatibilitätsansicht ohne WebGL: begrenzte Details bei großen Projekten; alle Steine bleiben gespeichert."
    : null;
  return <div ref={hostRef} className="builder-canvas" data-testid="canvas-3d" style={{ position: "relative" }}>
    <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center gap-2 pointer-events-none">
      <button type="button" className="pointer-events-auto rounded-xl border bg-white/95 px-3 py-3 text-xs font-semibold shadow-sm"
        aria-pressed={showConnections} aria-label="Verbindungen anzeigen"
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={() => setShowConnections(value => !value)}>
        Verbindungen {showConnections ? "an" : "aus"}
      </button>
      {showConnections && connectionStatus && <span role="status" data-testid="connection-status" className="rounded-lg bg-white/95 px-2 py-2 text-xs shadow-sm">{connectionStatus}</span>}
    </div>
    {(sceneStatus || renderWarning || compatibilityHint) && <div
      role="status"
      className="absolute left-2 right-2 top-2 z-10 rounded-lg bg-white/95 p-3 text-xs text-stone-700 shadow"
      style={{ pointerEvents: "none" }}
    >
      <p>{sceneStatus ?? renderWarning ?? compatibilityHint}</p>
      {sceneStatus ? <button type="button" className="mt-2 underline"
        style={{ pointerEvents: "auto" }}
        onPointerDown={event => event.stopPropagation()}
        onClick={() => {
          buildControllerRef.current?.abort();
          setSceneStatus(null);
          setRenderWarning("3D-Aufbau abgebrochen. Das Projekt bleibt unverändert gespeichert.");
        }}>Vorbereitung abbrechen</button> : <button type="button" className="mt-2 underline"
          style={{ pointerEvents: "auto" }}
          onPointerDown={event => event.stopPropagation()}
          onClick={() => setBuildAttempt(value => value + 1)}>Darstellung neu aufbauen</button>}
    </div>}
  </div>;
}

function geometryCacheHas(geometry: InstancedMesh["geometry"]): boolean {
  return [...geometryCache.values()].some((cached) => cached === geometry);
}

function disposeImported(root: Group): void {
  disposeImportedScene(root);
}

function setRendererSize(
  renderer: WebGLRenderer | FallbackRenderer,
  width: number,
  height: number,
): void {
  if (renderer instanceof WebGLRenderer) {
    renderer.setSize(width, height, false);
  } else {
    renderer.setSize(width, height);
  }
}

function disposeMaterial(material: Material | Material[]): void {
  if (Array.isArray(material)) {
    for (const item of material) item.dispose();
  } else {
    material.dispose();
  }
}

export default BuilderCanvas;
