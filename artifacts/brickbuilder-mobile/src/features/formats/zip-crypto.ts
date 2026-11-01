// Traditional PKZIP encryption used by older Studio IO archives.
// The fixed format key is public documentation, not a user's credential:
// https://wiki.ldraw.org/wiki/IO
const STUDIO_FORMAT_KEY = 'soho0909';
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});
const crcStep = (crc: number, byte: number) => ((crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255]) >>> 0;

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcStep(crc, byte);
  return (crc ^ 0xffffffff) >>> 0;
}

export function decryptStudioZipEntry(encrypted: Uint8Array, checkByte: number): Uint8Array {
  if (encrypted.length < 12) throw new Error('Beschädigter verschlüsselter IO-ZIP-Eintrag.');
  let key0 = 0x12345678, key1 = 0x23456789, key2 = 0x34567890;
  function updateKeys(byte: number) {
    key0 = crcStep(key0, byte);
    key1 = (Math.imul((key1 + (key0 & 255)) >>> 0, 134775813) + 1) >>> 0;
    key2 = crcStep(key2, key1 >>> 24);
  }
  for (const byte of new TextEncoder().encode(STUDIO_FORMAT_KEY)) updateKeys(byte);
  const output = new Uint8Array(encrypted.length - 12);
  for (let index = 0; index < encrypted.length; index++) {
    const temp = (key2 & 0xffff) | 2;
    const byte = encrypted[index] ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 255);
    updateKeys(byte);
    if (index === 11 && byte !== checkByte) {
      throw new Error('IO-Verschlüsselung nicht unterstützt oder Datei beschädigt. Unterstützt wird der dokumentierte Studio-Standardschlüssel.');
    }
    if (index >= 12) output[index - 12] = byte;
  }
  return output;
}
