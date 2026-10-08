import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const engine = process.argv[2];
assert.ok(engine, "Pass the path to an installed OpenCode CLI");
assert.ok(
  process.argv.length <= 4 &&
    (!process.argv[3] || process.argv[3] === "--live"),
  "Usage: node scripts/check-opencode-gateway-poc.mjs ENGINE [--live]",
);
const live = process.argv[3] === "--live";
const native = fileURLToPath(
  new URL("../target/debug/examples/gateway-check", import.meta.url),
);
await access(native).catch(() => {
  throw new Error(
    "Build the native check first: cargo build -p luxecode --example gateway-check",
  );
});
if (live) {
  assert.ok(
    process.env.LUXECODE_GATEWAY_PROFILE,
    "Set LUXECODE_GATEWAY_PROFILE for live acceptance",
  );
  assert.ok(
    process.env.LUXECODE_9ROUTER_API_KEY,
    "Set LUXECODE_9ROUTER_API_KEY for live acceptance; never pass a key as an argument",
  );
}
const externalPaths = [
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode"),
  join(homedir(), ".opencode", "opencode.json"),
  join(homedir(), ".opencode", "opencode.jsonc"),
  ...["auth.json", "opencode.db", "opencode.db-wal", "opencode.db-shm"].map(
    (name) =>
      join(
        process.env.XDG_DATA_HOME || join(homedir(), ".local/share"),
        "opencode",
        name,
      ),
  ),
];
async function snapshot(paths) {
  const result = {};
  async function visit(path) {
    const stat = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name));
    } else if (stat.isFile()) {
      result[path] = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    }
  }
  for (const path of paths) await visit(path);
  return result;
}
const externalBefore = await snapshot(externalPaths);
const directory = await realpath(
  await mkdtemp(join(tmpdir(), "luxecode-engine-poc-")),
);
const fixture = join(directory, "result.txt");
await writeFile(fixture, "before\n");
const environment = { ...process.env };
if (!live)
  environment.LUXECODE_9ROUTER_API_KEY =
    "fixture-key-not-a-provider-credential";
const fixtureKey = environment.LUXECODE_9ROUTER_API_KEY;
let modelRequests = 0;
let fault = null;
let unexpectedRequests = 0;
const server = createServer(async (request, response) => {
  let input = "";
  for await (const chunk of request) input += chunk;
  if (request.headers.authorization !== `Bearer ${fixtureKey}`) {
    response.writeHead(401).end();
    return;
  }
  if (request.url === "/v1/models") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ data: [{ id: "coding" }] }));
    return;
  }
  if (request.url !== "/v1/chat/completions") {
    unexpectedRequests += 1;
    response.writeHead(404).end();
    return;
  }
  const body = JSON.parse(input);
  if (!body.model) {
    response
      .writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: { message: "Missing model" } }));
    return;
  }
  modelRequests += 1;
  if (typeof fault === "number") {
    response
      .writeHead(fault, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: { message: "Injected gateway failure" } }));
    return;
  }
  if (fault === "timeout") return;
  if (fault === "partial") {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: "partial", object: "chat.completion.chunk", model: "coding", choices: [{ index: 0, delta: { role: "assistant", content: "Partial response" }, finish_reason: null }] })}\n\n`,
    );
    return;
  }
  const tools = body.tools?.map((tool) => tool.function.name) ?? [];
  const completed = body.messages.filter(
    (message) => message.role === "tool",
  ).length;
  let delta = { role: "assistant", content: "Fixture completed" };
  let finish = "stop";
  if (tools.length && completed < 3) {
    const tool = ["read", "edit", "bash"][completed];
    assert.ok(tools.includes(tool), `Engine must expose ${tool}`);
    const argumentsByTool = {
      read: { filePath: fixture },
      edit: { filePath: fixture, oldString: "before", newString: "after" },
      bash: {
        command: 'test "$(cat result.txt)" = after',
        description: "Verify fixture edit",
      },
    };
    delta = {
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: `fixture-${completed}`,
          type: "function",
          function: {
            name: tool,
            arguments: JSON.stringify(argumentsByTool[tool]),
          },
        },
      ],
    };
    finish = "tool_calls";
  }
  const completion = {
    id: `fixture-request-${modelRequests}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "coding",
    choices: [{ index: 0, message: delta, finish_reason: finish }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
  response.setHeader(
    "Content-Type",
    body.stream ? "text/event-stream" : "application/json",
  );
  if (!body.stream) {
    response.end(JSON.stringify(completion));
    return;
  }
  response.end(
    `data: ${JSON.stringify({ ...completion, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const profile = live
  ? JSON.parse(await readFile(environment.LUXECODE_GATEWAY_PROFILE, "utf8"))
  : { endpoint, model: "coding", contextWindow: 32768, maxOutputTokens: 8192 };
const profilePath = join(directory, "profile.json");
await writeFile(profilePath, JSON.stringify(profile), { mode: 0o600 });
environment.LUXECODE_GATEWAY_PROFILE = profilePath;
const inheritedDatabase = join(directory, "external.db");
await writeFile(inheritedDatabase, "must not become an OpenCode database");
environment.OPENCODE_DB = inheritedDatabase;
environment.OPENCODE_TEST_HOME = directory;
environment.OPENCODE_CONFIG = join(directory, "opencode.json");
environment.OPENCODE_CONFIG_DIR = join(directory, ".opencode");
environment.OPENCODE_AUTH_JSON = "invalid inherited auth must be ignored";
environment.OPENCODE_CONFIG_CONTENT = JSON.stringify({
  model: "openai/direct-must-not-run",
});
await writeFile(
  join(directory, "opencode.json"),
  "invalid project config must be ignored",
);
await mkdir(join(directory, ".opencode"));
await writeFile(
  join(directory, ".opencode", "opencode.json"),
  "invalid project config must be ignored",
);

async function run(
  argumentsList,
  { timeoutMs = 90000, allowFailure = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      native,
      [join(directory, "native-data"), engine, ...argumentsList],
      {
        cwd: directory,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );
    let output = "";
    let error = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (error += chunk));
    child.on("error", (caught) => {
      clearTimeout(timeout);
      reject(caught);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (
        environment.LUXECODE_9ROUTER_API_KEY &&
        (output + error).includes(environment.LUXECODE_9ROUTER_API_KEY)
      ) {
        reject(new Error("Gateway credential leaked in engine output"));
        return;
      }
      if (allowFailure) {
        resolve({ output, code, timedOut });
        return;
      }
      if (timedOut) reject(new Error("OpenCode acceptance timed out"));
      else if (code !== 0)
        reject(new Error(`OpenCode exited ${code}: ${error.slice(-2000)}`));
      else resolve(output);
    });
  });
}

try {
  if (!live) {
    const key = environment.LUXECODE_9ROUTER_API_KEY;
    for (const invalidKey of ["", "invalid-gateway-key"]) {
      environment.LUXECODE_9ROUTER_API_KEY = invalidKey;
      await assert.rejects(
        run(["--version"]),
        /Set LUXECODE_9ROUTER_API_KEY|Enter a valid gateway API key|Gateway authentication failed/,
      );
    }
    environment.LUXECODE_9ROUTER_API_KEY = key;
    delete environment.LUXECODE_GATEWAY_PROFILE;
    await assert.rejects(
      run(["--version"]),
      /requires LUXECODE_GATEWAY_PROFILE; no direct fallback/,
    );
    environment.LUXECODE_GATEWAY_PROFILE = profilePath;
    assert.equal(modelRequests, 0, "Preflight failures must not call a model");
    console.log(
      "PASS: empty/wrong key and missing profile fail before engine launch",
    );
  }
  const catalog = await run(["models", "--verbose"]);
  const models = catalog.split("\n").filter((line) => /^\S+\/\S+$/.test(line));
  assert.deepEqual(models, [`luxecode/${profile.model}`]);
  const output = await run([
    "run",
    "--auto",
    "--format",
    "json",
    "Read result.txt, replace before with after, verify with a shell check, then finish.",
  ]);
  for (const tool of ["read", "edit", "bash"])
    assert.match(output, new RegExp(`"tool"\\s*:\\s*"${tool}"`));
  assert.equal((await readFile(fixture, "utf8")).trim(), "after");
  assert.ok(!output.includes(environment.LUXECODE_9ROUTER_API_KEY));
  const events = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const tool of ["read", "edit", "bash"]) {
    assert.equal(
      events.find((event) => event.part?.tool === tool)?.part.state.status,
      "completed",
    );
  }
  const session = events.find((event) => event.sessionID)?.sessionID;
  assert.ok(session, "Engine must return a resumable session ID");
  const resumed = await run([
    "run",
    "--format",
    "json",
    "--session",
    session,
    "Confirm the fixture is complete without changing files.",
  ]);
  assert.ok(resumed.includes(session));
  assert.equal((await readFile(fixture, "utf8")).trim(), "after");
  if (!live) {
    for (const failure of [401, 429, 503, "timeout", "partial"]) {
      fault = failure;
      const before = modelRequests;
      const result = await run(
        ["run", "--format", "json", "Say OK without using tools."],
        { timeoutMs: 12000, allowFailure: true },
      );
      assert.ok(
        modelRequests > before,
        `Fault ${failure} must reach the gateway`,
      );
      assert.ok(
        result.timedOut ||
          result.code !== 0 ||
          result.output.includes('"type":"error"'),
        `Fault ${failure} must not succeed`,
      );
      assert.ok(
        !result.output.includes('"type":"step_finish"'),
        `Fault ${failure} must not complete via another provider`,
      );
      console.log(
        `PASS: gateway ${failure}; ${result.timedOut ? "cancelled pending retry/stream" : "error surfaced"}; no successful fallback`,
      );
    }
  }
  assert.equal(unexpectedRequests, 0);
  assert.equal(
    await readFile(inheritedDatabase, "utf8"),
    "must not become an OpenCode database",
  );
  assert.equal(
    await readFile(join(directory, "opencode.json"), "utf8"),
    "invalid project config must be ignored",
  );
  assert.deepEqual(
    await snapshot(externalPaths),
    externalBefore,
    "External OpenCode config/session files changed",
  );
  console.log(
    `PASS: ${live ? "LIVE gateway" : "fixture"} through native gateway::apply; isolated catalog, read/edit/shell, follow-up, restart/resume, unchanged external CLI files; ${live ? "real provider requests" : `${modelRequests} fixture inference requests, no real provider calls`}`,
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
