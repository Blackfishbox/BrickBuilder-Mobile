import type { Position3 } from "./model";
import "./fine-position.css";

const directions: { label: string; axis: keyof Position3; sign: number }[] = [
  { label: "Links · X−", axis: "x", sign: -1 },
  { label: "Rechts · X+", axis: "x", sign: 1 },
  { label: "Vor · Z−", axis: "z", sign: -1 },
  { label: "Zurück · Z+", axis: "z", sign: 1 },
  { label: "Höher · Y+", axis: "y", sign: 1 },
  { label: "Tiefer · Y−", axis: "y", sign: -1 },
];
export default function FinePositionControls({ onNudge }: { onNudge(delta: Position3): void }) {
  return <details className="fine-position">
    <summary aria-label="Feinjustierung öffnen">Fein</summary>
    <div className="fine-position-panel" role="group" aria-label="Feinjustierung in Weltachsen">
      <strong>Feinjustierung</strong>
      <small>1 LDU (0,4 mm) pro Schritt · Weltachsen</small>
      <div className="fine-position-grid">
        {directions.map(({ label, axis, sign }) => <button key={label} type="button"
          aria-label={`Feinjustierung: ${label}`} onClick={() => onNudge({ x: 0, y: 0, z: 0, [axis]: sign * 0.05 })}>
          {label}
        </button>)}
      </div>
    </div>
  </details>;
}
