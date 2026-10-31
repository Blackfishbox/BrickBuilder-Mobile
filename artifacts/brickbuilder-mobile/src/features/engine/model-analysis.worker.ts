import { BRICK_DEFINITIONS, BRICK_HEIGHT, type Brick } from "../editor/model";

interface AnalyzeRequest {
  requestId: number;
  bricks: Brick[];
}

interface AnalyzeResponse {
  requestId: number;
  count: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  overlapCount: number;
}

const workerScope = self as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<AnalyzeRequest>) => void,
  ) => void;
  postMessage: (message: AnalyzeResponse) => void;
};

workerScope.addEventListener("message", (event) => {
  const { requestId, bricks } = event.data;
  if (!bricks.length) {
    workerScope.postMessage({
      requestId,
      count: 0,
      bounds: null,
      overlapCount: 0,
    });
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const occupied = new Map<string, string>();
  const overlaps = new Set<string>();

  for (const brick of bricks) {
    const definition = BRICK_DEFINITIONS[brick.type];
    const rotated = Math.abs(brick.rotation % 180) === 90;
    const width = rotated ? definition.studsZ : definition.studsX;
    const depth = rotated ? definition.studsX : definition.studsZ;
    const left = brick.x - width / 2;
    const right = brick.x + width / 2;
    const front = brick.z - depth / 2;
    const back = brick.z + depth / 2;

    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minZ = Math.min(minZ, front);
    maxZ = Math.max(maxZ, back);

    const minCellX = Math.round(left * 2);
    const maxCellX = Math.round(right * 2);
    const minCellZ = Math.round(front * 2);
    const maxCellZ = Math.round(back * 2);
    const layer = Math.round(brick.y / BRICK_HEIGHT);
    for (let x = minCellX; x < maxCellX; x += 1) {
      for (let z = minCellZ; z < maxCellZ; z += 1) {
        const key = `${layer}:${x}:${z}`;
        const existing = occupied.get(key);
        if (existing && existing !== brick.id) {
          overlaps.add([existing, brick.id].sort().join(":"));
        } else {
          occupied.set(key, brick.id);
        }
      }
    }
  }

  workerScope.postMessage({
    requestId,
    count: bricks.length,
    bounds: { minX, maxX, minZ, maxZ },
    overlapCount: overlaps.size,
  });
});
