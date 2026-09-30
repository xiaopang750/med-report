import assert from "node:assert/strict";
import { extractCloud } from "../server/file-parser";
const data = new TextEncoder().encode("%PDF-fictional");
let calls = 0;
const response = (content: unknown, finish_reason = "stop") =>
  Response.json({
    choices: [{ finish_reason, message: { content: JSON.stringify(content) } }],
  });
const mock = (fn: (init: RequestInit) => Response | Promise<Response>) =>
  (async (_url: unknown, init: RequestInit) => {
    calls++;
    assert.equal(init.redirect, "error");
    return fn(init);
  }) as typeof fetch;
const valid = await extractCloud(
  data,
  "pdf",
  "application/pdf",
  mock((init) => {
    const p = JSON.parse(String(init.body));
    assert.equal(p.model, "glm-5.3-flash");
    assert.equal(
      p.messages[1].content[0].file.file_data,
      "data:application/pdf;base64," + Buffer.from(data).toString("base64"),
    );
    return response({ lines: ["Glucose 6.2 mmol/L 3.9-6.1"] });
  }),
);
assert.equal(valid.anchors[0]?.method, "model");
for (const r of [
  Response.json({ error: "secret report body" }, { status: 429 }),
  response({ lines: [3] }),
  response({ lines: ["x"] }, "length"),
  new Response("not JSON"),
]) {
  await assert.rejects(
    () =>
      extractCloud(
        data,
        "pdf",
        "application/pdf",
        mock(() => r),
      ),
    (e) => !String(e).includes("secret report body"),
  );
}
await assert.rejects(
  () =>
    extractCloud(
      data,
      "pdf",
      "application/pdf",
      mock(
        (init) =>
          new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () =>
              reject(new Error("timeout secret")),
            );
          }),
      ),
    ),
  /超时/,
);
assert.equal(calls, 6); // no retry
console.log(
  "protocol, bad JSON, truncation, provider error, timeout and no retries passed",
);
