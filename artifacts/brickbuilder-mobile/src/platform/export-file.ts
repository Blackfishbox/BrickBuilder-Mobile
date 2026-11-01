import { Capacitor } from "@capacitor/core";

/** Browser download or Android's document-sharing sheet; no remote upload. */
export async function exportFile(bytes: Uint8Array, filename: string, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const name = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "project.json";
    const path = `exports/${crypto.randomUUID()}/${name}`;
    // Avoid spreading an entire imported model onto the JavaScript call stack.
    const chunkSize = 192 * 1024; // multiple of 3: concatenate valid base64 chunks
    for (let start = 0; start < Math.max(1, bytes.length); start += chunkSize) {
      const chunk = bytes.subarray(start, start + chunkSize);
      let binary = "";
      for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
      const data = btoa(binary);
      if (start === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
      else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    }
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: name, files: [uri], dialogTitle: "Projekt speichern oder teilen" });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
