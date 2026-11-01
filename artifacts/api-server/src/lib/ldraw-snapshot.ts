import type { ArchiveBundle } from "./ldraw-archive";

// Explicitly approved official archive. Change only during deliberate maintenance.
// This descriptor is not a credential; object access uses the service's identity.
export const approvedSnapshot: ArchiveBundle = {
  bucket: "replit-objstore-4573e901-08e8-4508-a985-2294fb034194",
  object: "ldraw/approved/023083918da2d3697c794fb4267975509584f3611b993095874206a803fa610f/snapshot.jsonl.gz",
  sha256: "5cd6248dcad355758dae965eecd3c54af2ca6726b6dbd3d7c9f3580663fedd0b",
  archiveSha256: "023083918da2d3697c794fb4267975509584f3611b993095874206a803fa610f",
};
