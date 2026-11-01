import { Box3, PerspectiveCamera, Vector3 } from "three";
import type { Contact } from "./types";

export const MARKER_LIMIT = 32;
/** One small renderer-independent overlay. It never participates in picking,
 * instancing, source geometry, inventory or persistence.
 */
export class ConnectionOverlay {
  readonly canvas = document.createElement("canvas");
  contacts: Contact[] = [];
  visible = true;
  constructor(host: HTMLElement) {
    this.canvas.dataset.testid = "connection-overlay";
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "2" });
    host.appendChild(this.canvas);
  }
  draw(camera: PerspectiveCamera, offset: number, bounds: (id: string) => Box3 | null): void {
    const context = this.canvas.getContext("2d"); if (!context) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = Math.max(1, width); this.canvas.height = Math.max(1, height);
    }
    context.clearRect(0, 0, width, height);
    if (!this.visible) return;
    camera.updateMatrixWorld();
    const project = (point: Vector3) => {
      const p = point.project(camera);
      return { x: (p.x + 1) * width / 2, y: (1 - p.y) * height / 2, visible: p.z >= -1 && p.z <= 1 };
    };
    const outlined = new Set<string>();
    for (const contact of this.contacts.slice(0, MARKER_LIMIT)) {
      const point = new Vector3(...contact.position); point.y += offset;
      const p = project(point); if (!p.visible) continue;
      const color = contact.state === "verified" ? "#087b61" : "#d17b12";
      context.strokeStyle = color; context.lineWidth = 2;
      context.fillStyle = contact.state === "verified" ? "#e4fff4" : "#fff3cf";
      context.beginPath(); context.arc(p.x, p.y, 5, 0, Math.PI * 2); context.fill(); context.stroke();
      context.beginPath(); context.moveTo(p.x - 8, p.y); context.lineTo(p.x + 8, p.y);
      context.moveTo(p.x, p.y - 8); context.lineTo(p.x, p.y + 8); context.stroke();
      if (outlined.has(contact.targetId)) continue;
      outlined.add(contact.targetId);
      const box = bounds(contact.targetId); if (!box) continue;
      const points = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(project(new Vector3(x, y + offset, z)));
      if (points.some(v => !v.visible)) continue;
      const xs = points.map(v => v.x), ys = points.map(v => v.y);
      context.save(); context.globalAlpha = 0.65; context.setLineDash([3, 4]); context.lineWidth = 1;
      context.strokeRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      context.restore();
    }
  }
  dispose(): void { this.contacts = []; this.canvas.remove(); }
}
