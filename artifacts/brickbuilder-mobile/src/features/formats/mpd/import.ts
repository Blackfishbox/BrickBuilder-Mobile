import { importLDraw } from "../ldraw/import";
import type { ResolveOptions } from "../online-geometry";
export const importMPD = (bytes: Uint8Array, name: string, options: ResolveOptions = {}) => importLDraw(bytes, name, "mpd", bytes, options);
