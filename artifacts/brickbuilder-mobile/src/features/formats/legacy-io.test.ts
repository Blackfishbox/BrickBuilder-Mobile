import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builderDatabase } from '@/storage/database';
import { importIO } from './io/import';
import { crc32, readZip, writeZip } from './zip';
import { getImportPartFailures } from './import-failures';
import manifest from './geometry-manifest.json';

// Self-authored text fixtures encrypted by the independent Info-ZIP CLI.
// No private Studio resources or uploaded models are included here.
const DEFLATED = 'UEsDBBQACwAIAGsaYV2TJiHdSwAAAHIBAAAJABwAbW9kZWwubGRyVVQJAAO6r+Zquq/manV4CwABBOgDAAAE6AMAAAXo0/qcZk3e9wZpD0kA7DIvQT8xXyuRvWqUa+Nn4Neps2NcH7mhvHrdpAIYJ8Oe4Y8VWlXjrrb9w+8fqmWD/NmP4YpmzofH0JEY/FBLBwiTJiHdSwAAAHIBAABQSwECHgMUAAsACABrGmFdkyYh3UsAAAByAQAACQAYAAAAAAABAAAApIEAAAAAbW9kZWwubGRyVVQFAAO6r+ZqdXgLAAEE6AMAAAToAwAAUEsFBgAAAAABAAEATwAAAJ4AAAAAAA==';
const STORED = 'UEsDBAoACQAAAGsaYV2TJiHdfgEAAHIBAAAJABwAbW9kZWwubGRyVVQJAAO6r+Zquq/manV4CwABBOgDAAAE6AMAAHiQHqgx5ape9UYKwIdcQ3eIrvun6El3ebPAki/PGqIYdvdth5qtg8TOdR00tPOx7LsOrYggyyOJJGvpNAkm9fT0ePxMUCsr4Dkz01yc2EAj3tm9n2YT7NSFJN8Wiet6m4NUfdupM1e0PRKCcYXQd1rWsq8sOc0O8hhx2iDoAGrm/xoqSt7+8ooXmOVBnaFZ9e++9JO4RxxULslcIuu7ZmR7uL+fr86kEcbK2Ktuu053COvJHUL+bqhbGH+CzLML/+jQ1K4Ww5MvYEXt0qtkg7/lk+2W5H+Vmvn8FgWK0IfIh2m/J1qmHcZmhoMfxiaAL2TboGXsjvKC8EFriYq6s8D8Dz6apR14mU+43r9bOmef7RvCilLBh7yWsd41nrQBfGX57i0S7xVa5mY8BVTtrPv/6ywfjqJS9xnRCfZllYpKzF3jAd/ytLAk8GzhyYeuhtA3fLfKyunDg0UNGY83UPjWiEfXyUoltTrDf18C6SsVRksteYwZ/AHjMkSs6YxQSwcIkyYh3X4BAAByAQAAUEsBAh4DCgAJAAAAaxphXZMmId1+AQAAcgEAAAkAGAAAAAAAAAAAAKSBAAAAAG1vZGVsLmxkclVUBQADuq/manV4CwABBOgDAAAE6AMAAFBLBQYAAAAAAQABAE8AAADRAQAAAAA=';
const OTHER_KEY = 'UEsDBBQACwAIAGsaYV2TJiHdSwAAAHIBAAAJABwAbW9kZWwubGRyVVQJAAO6r+Zquq/manV4CwABBOgDAAAE6AMAACI4HNdhf4y99Fufd6E41fwHkpfsxUbNj+oWP2M64gh779LZrjuWJPG+7uFF4oyumoWWGeW/r0/fu3XleCXRoOOvGE/BU4jcGhg6vFBLBwiTJiHdSwAAAHIBAABQSwECHgMUAAsACABrGmFdkyYh3UsAAAByAQAACQAYAAAAAAABAAAApIEAAAAAbW9kZWwubGRyVVQFAAO6r+ZqdXgLAAEE6AMAAAToAwAAUEsFBgAAAAABAAEATwAAAJ4AAAAAAA==';
const encode = (text: string) => new TextEncoder().encode(text);
const fixtureText = '0 Synthetic encrypted import fixture\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat\n'.repeat(5);
const decode = (base64: string) => new Uint8Array(Buffer.from(base64, 'base64'));
const options = { names: ['model.ldr'], studioEncryption: true };

describe('legacy Studio ZIP compatibility and bounds', () => {
  it.each([DEFLATED, STORED])('decrypts independently generated compressed and stored fixtures', fixture => {
    const bytes = decode(fixture);
    expect(() => readZip(bytes)).toThrow();
    const entries = readZip(bytes, options);
    expect(Object.keys(entries)).toEqual(['model.ldr']);
    expect(new TextDecoder().decode(entries['model.ldr'])).toBe(fixtureText);
  });
  it('keeps the standard CRC-32 algorithm and rejects unsupported keys or corrupt payloads', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926);
    expect(() => readZip(decode(OTHER_KEY), options)).toThrow(/Verschlüsselung/);
    const bytes = decode(DEFLATED);
    const view = new DataView(bytes.buffer);
    const data = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    bytes[data + 15] ^= 0x80;
    expect(() => readZip(bytes, options)).toThrow();
  });
  it('skips large unused Studio resources without raising selected-entry allocation limits', () => {
    const bytes = writeZip({
      'model.ldr': encode(fixtureText),
      'model2.ldr': new Uint8Array(17 * 1024 * 1024),
    });
    expect(() => readZip(bytes)).toThrow(/16 MiB/);
    expect(Object.keys(readZip(bytes, options))).toEqual(['model.ldr']);
    expect(() => readZip(bytes, { names: ['model2.ldr'] })).toThrow(/16 MiB/);
    expect(() => readZip(writeZip({ '../unsafe': encode('x'), 'model.ldr': encode(fixtureText) }), options)).toThrow(/Pfad/);
  });
  it('rejects a DEFLATE stream whose actual output exceeds its declared size', () => {
    const bytes = writeZip({ 'model.ldr': encode(fixtureText) });
    const view = new DataView(bytes.buffer);
    view.setUint32(22, 1, true);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 1, true); break; }
    }
    expect(() => readZip(bytes, options)).toThrow(/Größe/);
  });
});

const reference = new URL('../../../../../attached_assets/40649-size_1793502923137.io', import.meta.url);
describe.skipIf(!existsSync(reference))('private encrypted Studio regression (local fixture only)', () => {
  beforeEach(async () => {
    await builderDatabase.open();
    const bytes = await readFile(new URL(`../../../public/${manifest.url}`, import.meta.url));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(bytes))));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await builderDatabase.delete();
  });
  it('opens the uploaded 122-entry archive and reports unavailable parts without discarding original data', async () => {
    const bytes = new Uint8Array(await readFile(reference));
    const doc = await importIO(bytes, '40649-size.io');
    const model = doc.imported!;
    expect(model.instances).toHaveLength(8590);
    expect(new Set(model.instances.map(instance => instance.reference.toLowerCase())).size).toBe(517);
    expect(model.instances.some(instance => instance.part.status === 'resolved')).toBe(true);
    const failures = getImportPartFailures(model);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every(part => part.ldrawId.length > 0 && part.count > 0)).toBe(true);
    const digest = (input: Uint8Array) => createHash('sha256').update(input).digest('hex');
    expect(digest(Uint8Array.from(model.originalBytes))).toBe(digest(bytes));
  }, 20000);
});
