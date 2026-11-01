# Large-model rendering

## Implemented safeguards

- Compile each normalized LDraw reference once, independently of its inherited
  color. Positions, flat normals and explicit edges use typed buffers.
- Share geometry attributes across color variants. Inherited colors use instance
  colors; fixed painted surfaces are batched by opacity with vertex colors.
  Transparent and opaque source colors remain separate.
- Draw explicit edges with one instanced line object per part type, rather than
  one scene object per brick. Conditional type-5 edges remain unsupported.
- Prepare cold geometry in a Web Worker. Only shared resource files and unique
  references cross the worker boundary, never the original IO byte array, project
  history or complete instance metadata. Typed results are transferred back.
- Build the scene cooperatively between part types, with progress, cancellation
  and retry. A single unusually complex part can still exceed one timeslice.
- Render on demand. While the camera moves, temporarily hide imported edges and
  reduce pixel ratio; restore both after input settles. The vertical camera axis
  remains inverted.
- Fit and resize using cached model bounds rather than repeatedly traversing
  every imported object.
- Dispose instance matrix/color buffers as well as materials and geometry when
  scenes or editable-brick batches are replaced.
- List saved projects from small derived metadata records. Do not load another
  complete copy of every project's IO archive and geometry just to show its name
  and brick count. Legacy summaries are created transactionally, one project at
  a time, without a schema migration.
- Avoid autosaving an unchanged restored project again. Real edits and new
  documents still autosave, and explicit saves remain available.

## Memory and compatibility behavior

Before uploading an imported scene, enforce a buffer budget of 96 MiB, reduced
to 64 MiB on browsers reporting at most 2 GB RAM and 32 MiB at at most 1 GB.
This is a safety budget, **not** a guarantee about actual device GPU memory.
Browsers that do not expose device memory use the default budget.

An exceeded budget, lost WebGL context or unavailable WebGL switches to an
explicitly labeled software compatibility preview. It uses at most 32,000
sampled **real source triangles**, reduced further during movement. It does not
claim to display every surface. Large editable-brick software views are also
bounded and culled outside the viewport. No placeholder parts are asserted to
be original geometry.

The complete instances, source files, unknown metadata and original archive
remain in the project. Reducing display detail never deletes model references.
The software preview is a stability measure, not a full-fidelity replacement
for hardware-accelerated rendering.

## Measured reference

The supplied encrypted Studio reference was imported through the verified
same-origin archive resolver. No private upload is checked into this repository.

| Measurement | Previous renderer estimate | Optimized renderer |
| --- | ---: | ---: |
| Parsed external model instances | 8,590 | 8,590 |
| Instances with available complete geometry | 8,536 | 8,536 |
| Imported drawing objects | 9,814 | 1,002 |
| Geometry and instancing buffers | 82.5 MiB | 51.8 MiB |

The previous columns are reconstructed from the previous reference/color
batching rules, without allocating that crash-prone scene. The optimized scene
was actually constructed. Its setup took approximately 0.4 seconds in the
workspace's Node benchmark; this is **not** a phone frame-rate measurement.
The complete scene contains approximately 4.95 million rendered triangles.
Missing references remain reported by their original part numbers; this change
does not invent geometry for the 54 unavailable instances.

A separate 10,000-instance, multicolor synthetic model uses four drawing
objects and about 1.81 MiB of buffers. Its two-million-triangle software input
is bounded to a 30,000-triangle preview. These are structural regression tests,
not claims that every 10,000-part model has the same complexity.

## Reproduce

```sh
pnpm --filter @workspace/brickbuilder-mobile test
pnpm --filter @workspace/brickbuilder-mobile typecheck
PORT=4173 BASE_PATH=/ pnpm --filter @workspace/brickbuilder-mobile build
```

The optional private benchmark requires the original reference upload in its
local fixture location, a running frontend and the configured approved archive
resolver. Set a local preview origin, not a third-party service:

```sh
BRICKBUILDER_BENCH_URL="https://your-development-preview/" \
  pnpm --filter @workspace/brickbuilder-mobile exec vitest run \
  src/features/engine/performance.test.ts --reporter=verbose --silent=false
```

The private case skips when its upload or explicit benchmark origin is absent.
Ordinary tests do not require a network service. Tests cover typed geometry
sharing, instanced edges, original/fixed/translucent colors, partial-build
cancellation, memory-budget rejection, instance-buffer disposal, bounded
software preparation, worker payloads, summary backfill and summary deletion.

## Remaining limits

- No physical Android device or real-device FPS/memory trace was available for
  this change. Do not describe the Node benchmark as Android certification.
- Actual performance depends on GPU, browser, thermals, viewport and part
  complexity, not just brick count. Full geometry is still expensive on weak
  hardware; the compatibility preview intentionally sacrifices visible detail.
- The importer's existing unsupported flexible/inline geometry and unavailable
  source parts are unchanged.
- Hardware-accelerated occlusion optimization and detailed geometry LOD are
  separate future work. No unlimited-size or universal 60 FPS claim is made.
