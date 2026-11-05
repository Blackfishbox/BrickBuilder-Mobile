import { it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

// Isolate the exploit: the vulnerable version exits on an asynchronous decoder
// error even after returning a successful response.
it("survives compressed request bodies with trailing garbage and still serves health requests", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import express from "express";
    import http from "node:http";
    import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
    import assert from "node:assert/strict";
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.post("/", (req, res) => res.json(req.body));
    app.get("/health", (req, res) => res.send("ok"));
    // Decoder errors may reject the request; neither a 400 nor a 200 may crash
    // the process. Do not depend on Express's HTML error response.
    app.use((err, req, res, next) => res.status(err.status || 500).end());
    const server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const port = server.address().port;
    function send(path, body, headers = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path,
          method: body ? "POST" : "GET", headers }, res => {
          let text = ""; res.on("data", c => text += c);
          res.on("end", () => resolve({ status: res.statusCode, text }));
        });
        req.on("error", reject); req.end(body);
      });
    }
    try {
      for (const [encoding, compress] of [["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync]]) {
        for (const [type, text] of [["application/json", '{"ok":true}'], ["application/x-www-form-urlencoded", "ok=true"]]) {
          const body = Buffer.concat([compress(Buffer.from(text)), Buffer.from("trailing garbage")]);
          const result = await send("/", body, { "Content-Type": type,
            "Content-Encoding": encoding, "Content-Length": body.length });
          assert.ok([200, 400].includes(result.status));
          await new Promise(resolve => setTimeout(resolve, 40));
          assert.equal((await send("/health")).text, "ok");
        }
      }
      const result = await send("/", Buffer.from('{"ok":true}'), { "Content-Type": "application/json" });
      assert.deepEqual(JSON.parse(result.text), { ok: true });
    } finally { await new Promise(resolve => server.close(resolve)); }
  `], { cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 15000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});
