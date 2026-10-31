import { importLDraw } from "../ldraw/import";
export const importMPD = (bytes: Uint8Array, name: string) => importLDraw(bytes, name, "mpd");
