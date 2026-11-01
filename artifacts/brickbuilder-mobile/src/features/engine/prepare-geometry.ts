import type { ImportedModel } from "../formats/types";
import { compilePart, hasCompiledPart, installCompiledPart, type Surface } from "./ldraw-geometry";
import type { SceneBuildOptions } from "./imported-scene";

export async function prepareGeometry(model: ImportedModel, options: SceneBuildOptions = {}): Promise<void> {
  options.signal?.throwIfAborted();
  const references = [...new Set(model.instances.filter(instance => instance.part.status === "resolved")
    .map(instance => instance.reference.toLowerCase()))].filter(reference => !hasCompiledPart(model, reference));
  if (!references.length) return;
  if (typeof Worker !== "undefined") {
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL("./geometry-preparation.worker.ts", import.meta.url), { type: "module" });
      const compiler = worker;
      await new Promise<void>((resolve, reject) => {
        let completed = 0;
        const abort = () => { compiler.terminate(); reject(options.signal?.reason ?? new DOMException("Abgebrochen", "AbortError")); };
        const cleanup = () => options.signal?.removeEventListener("abort", abort);
        options.signal?.addEventListener("abort", abort, { once: true });
        compiler.onmessage = (event: MessageEvent<{ kind: string; reference: string; surfaces: Surface[]; message: string }>) => {
          if (options.signal?.aborted) return;
          if (event.data.kind === "part") {
            installCompiledPart(model, event.data.reference, event.data.surfaces);
            options.onProgress?.(++completed, references.length);
          } else if (event.data.kind === "done") { cleanup(); resolve(); }
          else if (event.data.kind === "failure") { cleanup(); reject(new Error(event.data.message)); }
        };
        compiler.onerror = event => { event.preventDefault(); cleanup(); reject(new Error("Geometrie-Worker nicht verfügbar.")); };
        compiler.postMessage({ references, resources: model.resources });
      });
      return;
    } catch (error) {
      options.signal?.throwIfAborted();
      // CSP/worker availability must not discard an otherwise valid project.
      // Remaining work uses the same compiler with cooperative main-thread yields.
    } finally { worker?.terminate(); }
  }
  for (let index = 0; index < references.length; index++) {
    options.signal?.throwIfAborted();
    compilePart(model, references[index], "16");
    options.onProgress?.(index + 1, references.length);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}
