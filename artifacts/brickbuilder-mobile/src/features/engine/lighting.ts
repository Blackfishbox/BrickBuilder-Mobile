import { DirectionalLight, Group, HemisphereLight } from "three";

/** Neutral, bounded lighting keeps source sRGB hues free of warm/green casts. */
export function createBuilderLighting(): Group {
  const group = new Group();
  // Three.js Lambert diffuse uses 1 / PI. Budget PI total irradiance, not
  // one, so neutral white does not become grey while avoiding overexposure.
  const hemi = new HemisphereLight(0xffffff, 0x808080, Math.PI * 0.65);
  const sun = new DirectionalLight(0xffffff, Math.PI * 0.35);
  sun.position.set(-8, 18, 11);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.0004;
  group.add(hemi, sun);
  return group;
}
