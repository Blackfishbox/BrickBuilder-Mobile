import type { Affine } from "../formats/types";

export type Family = "cylinder" | "clip" | "fingers" | "generic";
export interface Section { shape: string; radius: number; length: number }
export interface Connector {
  id: string;
  clearId: string;
  family: Family;
  frame: Affine;
  gender: "M" | "F";
  group: string;
  sections: Section[];
  length: number;
  centered: boolean;
  slide: boolean;
  caps: string;
  sequence: number[];
  radius: number;
  bounding: string;
  match: string;
  placement: string;
  scale: string;
  mirror: string;
  evidence: { path: string; line: number; sha256: string };
}
export interface Diagnostic { path: string; line?: number; code: string; detail: string }
export interface Description { connectors: Connector[]; diagnostics: Diagnostic[] }
export interface Contact {
  id: string;
  movingId: string;
  movingConnectorId: string;
  targetId: string;
  targetConnectorId: string;
  position: [number, number, number];
  orientation: Affine;
  family: Family;
  state: "verified" | "candidate";
  evidence: Connector["evidence"][];
}
export interface ConnectionTransform {
  matrix: Affine;
  contacts: Contact[];
  status: "verified" | "candidate" | "no-data" | "unconnected";
}
