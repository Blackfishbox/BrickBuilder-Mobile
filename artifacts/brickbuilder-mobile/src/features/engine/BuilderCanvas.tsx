import { useEffect, useRef } from "react";
import {
  BoxGeometry,
  Box3,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  GridHelper,
  Group,
  HemisphereLight,
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
import { compilePart, createImportedGroup, worldMatrix } from "./ldraw-geometry";
import { resolveColor } from "../formats/colors";
import type { ImportedModel } from "../formats/types";

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
  bricks: Brick[];
  imported?: ImportedModel;
  selectedId: string | null;
  selectedType: BrickType;
  selectedColor: string;
  toolMode: ToolMode;
  onPlace: (position: Position3) => void;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: Position3) => void;
}

interface PointerPoint {
  x: number;
  y: number;
}

interface GestureStart {
  center: PointerPoint;
  distance: number;
  angle: number;
  theta: number;
  phi: number;
  cameraDistance: number;
  target: Vector3;
}

interface DragCandidate {
  id: string;
  pointerId: number;
  start: PointerPoint;
  origin: Position3;
  moved: boolean;
  destination: Position3 | null;
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
  private pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
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
    imported?: ImportedModel,
    importOffset = 0,
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

    // Exact LDraw triangles in the software renderer, not replacement boxes.
    if (imported) {
      const faces: { points: ProjectedPoint[]; depth: number; color: string; alpha: number }[] = [];
      const vertex = new Vector3();
      const light = new Vector3(-0.4, 0.8, 0.5).normalize();
      for (const instance of imported.instances) {
        if (instance.part.status !== "resolved") continue;
        const matrix = worldMatrix(instance.matrix);
        matrix.elements[13] += importOffset;
        for (const surface of compilePart(imported, instance.reference, instance.colorCode)) {
          const mapping = resolveColor(surface.colorCode);
          const color = new Color(mapping?.hex ?? "#ff00ff");
          for (let index = 0; index < surface.positions.length; index += 9) {
            const world = [];
            for (let v = 0; v < 9; v += 3) {
              world.push(vertex.fromArray(surface.positions, index + v).applyMatrix4(matrix).clone());
            }
            const points = world.map(p => project(p.x, p.y, p.z));
            if (points.some(p => p.depth < 0.1)) continue;
            const area = (points[1].x - points[0].x) * (points[2].y - points[0].y) - (points[1].y - points[0].y) * (points[2].x - points[0].x);
            if (Math.abs(area) < 0.08) continue;
            const normal = world[1].clone().sub(world[0]).cross(world[2].clone().sub(world[0])).normalize();
            const shade = 0.6 + 0.4 * Math.abs(normal.dot(light));
            faces.push({ points, depth: points.reduce((s, p) => s + p.depth, 0) / 3, color: color.clone().multiplyScalar(shade).getStyle(), alpha: (mapping?.alpha ?? 255) / 255 });
          }
        }
      }
      faces.sort((a, b) => b.depth - a.depth);
      for (const face of faces) {
        polygonPath(context, face.points);
        context.globalAlpha = face.alpha;
        context.fillStyle = face.color;
        context.fill();
      }
      context.globalAlpha = 1;
    }

    const orderedBricks = [...bricks].sort(
      (first, second) =>
        camera.position.distanceTo(new Vector3(second.x, second.y, second.z)) -
        camera.position.distanceTo(new Vector3(first.x, first.y, first.z)),
    );
    for (const brick of orderedBricks) {
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
  root: Group,
  state: { target: Vector3; distance: number; theta: number; phi: number },
): void {
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) return;
  bounds.getCenter(state.target);
  // Fit the bounding sphere against the narrower field of view, including portrait.
  const halfVertical = camera.fov * Math.PI / 360;
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
  const radius = bounds.getSize(new Vector3()).length() / 2;
  state.distance = Math.max(8, radius / Math.sin(Math.min(halfVertical, halfHorizontal)) * 1.08);
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

function pointerCenter(points: PointerPoint[]): PointerPoint {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function pointerDistance(first: PointerPoint, second: PointerPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

export function BuilderCanvas({
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
  const importedOffsetRef = useRef(0);
  const invalidatorRef = useRef<(() => void) | null>(null);
  const raycasterRef = useRef(new Raycaster());
  const propsRef = useRef({
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
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
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

    const hemi = new HemisphereLight(0xffffff, 0x738177, 2.15);
    scene.add(hemi);
    const sun = new DirectionalLight(0xfff4dc, 3.1);
    sun.position.set(-8, 18, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

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
    const invalidate = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        if (renderer instanceof WebGLRenderer) {
          renderer.render(scene, camera);
        } else {
          renderer.render(
            camera,
            cameraStateRef.current.target,
            propsRef.current.bricks,
            propsRef.current.selectedId,
            propsRef.current.imported,
            importedOffsetRef.current,
          );
        }
      });
    };
    invalidatorRef.current = invalidate;

    const resizeObserver = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setRendererSize(renderer, width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (importedRootRef.current) fitImportedView(camera, importedRootRef.current, cameraStateRef.current);
      invalidate();
    });
    resizeObserver.observe(host);
    invalidate();

    return () => {
      resizeObserver.disconnect();
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      invalidatorRef.current = null;
      scene.traverse((object) => {
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
    if (previous) { scene.remove(previous); disposeImported(previous); }
    importedRootRef.current = null;
    importedOffsetRef.current = 0;
    if (imported) {
      const root = createImportedGroup(imported);
      const bounds = new Box3().setFromObject(root);
      if (!bounds.isEmpty()) {
        const offset = Math.max(0, -bounds.min.y);
        root.position.y = offset;
        importedOffsetRef.current = offset;
        bounds.translate(new Vector3(0, offset, 0));
        const rectangle = hostRef.current?.getBoundingClientRect();
        if (rectangle && rectangle.height > 0) {
          camera.aspect = rectangle.width / rectangle.height;
          camera.updateProjectionMatrix();
        }
        fitImportedView(camera, root, cameraStateRef.current);
      }
      scene.add(root);
      importedRootRef.current = root;
    }
    invalidatorRef.current?.();
    return () => {
      if (importedRootRef.current) {
        scene.remove(importedRootRef.current);
        disposeImported(importedRootRef.current);
        importedRootRef.current = null;
      }
    };
  }, [imported]);

  useEffect(() => {
    const scene = sceneRef.current;
    const previousRoot = brickRootRef.current;
    if (!scene || !previousRoot) return;
    scene.remove(previousRoot);
    previousRoot.traverse((object) => {
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
      cameraState.theta = theta;
      cameraState.phi = Math.max(0.25, Math.min(1.42, phi));
      cameraState.distance = Math.max(3, Math.min(1500, distance));
      cameraState.target.copy(target);
      const camera = cameraRef.current;
      if (!camera) return;
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
      const brickMeshes = root.children.filter(
        (child): child is Mesh =>
          child instanceof Mesh &&
          (typeof child.userData.brickId === "string" ||
            Array.isArray(child.userData.brickIds)),
      );
      const intersections = raycaster.intersectObjects(brickMeshes, false);
      const hit = intersections[0];
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

    const startGesture = () => {
      const points = [...pointersRef.current.values()];
      if (points.length < 2) return;
      const [first, second] = points;
      const cameraState = cameraStateRef.current;
      gestureStartRef.current = {
        center: pointerCenter(points),
        distance: pointerDistance(first, second),
        angle: Math.atan2(second.y - first.y, second.x - first.x),
        theta: cameraState.theta,
        phi: cameraState.phi,
        cameraDistance: cameraState.distance,
        target: cameraState.target.clone(),
      };
      dragRef.current = null;
      clickRef.current = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      host.setPointerCapture(event.pointerId);
      const point = { x: event.clientX, y: event.clientY };
      pointersRef.current.set(event.pointerId, point);
      pointerLastRef.current.set(event.pointerId, point);
      if (pointersRef.current.size > 1) {
        startGesture();
        return;
      }

      clickRef.current = { id: event.pointerId, start: point, moved: false };
      const hit = findBrick(point);
      const current = propsRef.current;
      if (current.toolMode === "select") {
        if (hit) {
          current.onSelect(hit.id);
          const brick = current.bricks.find((item) => item.id === hit.id);
          if (brick) {
            dragRef.current = {
              id: hit.id,
              pointerId: event.pointerId,
              start: point,
              origin: { x: brick.x, y: brick.y, z: brick.z },
              moved: false,
              destination: null,
            };
          }
        } else {
          dragRef.current = null;
        }
      } else if (current.toolMode === "delete" && hit) {
        current.onSelect(hit.id);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      event.preventDefault();
      const previous = pointerLastRef.current.get(event.pointerId);
      const currentPoint = { x: event.clientX, y: event.clientY };
      pointerLastRef.current.set(event.pointerId, currentPoint);
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...pointersRef.current.values()];
      if (points.length >= 2) {
        const start = gestureStartRef.current;
        if (!start) {
          startGesture();
          return;
        }
        const [first, second] = points;
        const center = pointerCenter(points);
        const angle = Math.atan2(second.y - first.y, second.x - first.x);
        let angleDelta = angle - start.angle;
        if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
        if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
        const distance = pointerDistance(first, second);
        const zoom = start.distance > 0 ? start.distance / Math.max(1, distance) : 1;
        const centerX = (center.x - start.center.x) * 0.004;
        const deltaX = (center.x - start.center.x) * start.cameraDistance * 0.002;
        const deltaY = (center.y - start.center.y) * start.cameraDistance * 0.002;
        const target = start.target.clone();
        target.x -= deltaX * Math.cos(start.theta);
        target.z += deltaX * Math.sin(start.theta);
        target.y -= deltaY;
        updateCamera(
          start.theta + angleDelta + centerX,
          start.phi,
          start.cameraDistance * zoom,
          target,
        );
        return;
      }

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
          start.destination = projectToPlane(
            { x: event.clientX, y: event.clientY },
            start.origin.y,
          );
          return;
        }
      }

      if (!start || !findBrick(start.start)) {
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
      const point = { x: event.clientX, y: event.clientY };
      const current = propsRef.current;
      const click = clickRef.current;
      if (pointersRef.current.size === 1) {
        const drag = dragRef.current;
        if (drag?.pointerId === event.pointerId && drag.moved) {
          if (drag.destination) current.onMove(drag.id, drag.destination);
        } else if (current.toolMode === "build" && click && !click.moved) {
          const hit = findBrick(point);
          let destination: Position3 | null = null;
          if (hit) {
            const brick = current.bricks.find((item) => item.id === hit.id);
            const y = brick ? brick.y + BRICK_HEIGHT : BRICK_HEIGHT;
            destination = projectToPlane(point, y);
          } else {
            destination = projectToPlane(point, 0);
          }
          if (destination) current.onPlace(destination);
        } else if (current.toolMode === "select" && !drag) {
          const hit = findBrick(point);
          current.onSelect(hit?.id ?? null);
        }
      }

      pointersRef.current.delete(event.pointerId);
      pointerLastRef.current.delete(event.pointerId);
      clickRef.current = null;
      if (pointersRef.current.size < 2) gestureStartRef.current = null;
      if (pointersRef.current.size === 0) dragRef.current = null;
      if (host.hasPointerCapture(event.pointerId)) {
        host.releasePointerCapture(event.pointerId);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      pointersRef.current.delete(event.pointerId);
      pointerLastRef.current.delete(event.pointerId);
      dragRef.current = null;
      gestureStartRef.current = null;
      clickRef.current = null;
    };

    host.addEventListener("pointerdown", onPointerDown, { passive: false });
    host.addEventListener("pointermove", onPointerMove, { passive: false });
    host.addEventListener("pointerup", onPointerUp, { passive: false });
    host.addEventListener("pointercancel", onPointerCancel, { passive: false });
    return () => {
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  return <div ref={hostRef} className="builder-canvas" data-testid="canvas-3d" />;
}

function geometryCacheHas(geometry: InstancedMesh["geometry"]): boolean {
  return [...geometryCache.values()].some((cached) => cached === geometry);
}

function disposeImported(root: Group): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse(object => {
    if (object instanceof Mesh || object instanceof LineSegments) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
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
