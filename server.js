const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const CASES_FILE = path.join(DATA_DIR, "cases.json");
const NLP_PORT = 8001;
const PORT = 5000;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CASES_FILE)) fs.writeFileSync(CASES_FILE, "[]", "utf8");

let nlpProcess = null;

function startNlpService() {
  const script = path.join(ROOT, "nlp-service", "main.py");
  nlpProcess = spawn("python", [script, String(NLP_PORT)], { cwd: ROOT, windowsHide: true });
  nlpProcess.stdout.on("data", d => console.log("[NLP]", d.toString().trim()));
  nlpProcess.stderr.on("data", d => console.error("[NLP]", d.toString().trim()));
  nlpProcess.on("error", e => console.error("Could not start Python NLP service:", e.message));
}
startNlpService();

function readCases() {
  try { return JSON.parse(fs.readFileSync(CASES_FILE, "utf8")); }
  catch { return []; }
}
function writeCases(cases) {
  fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2), "utf8");
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

async function callNlp(payload) {
  const response = await fetch(`http://127.0.0.1:${NLP_PORT}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("NLP service returned " + response.status);
  return response.json();
}

function makeId() {
  return "NHAA-" + new Date().toISOString().slice(0,10).replaceAll("-","") + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true, node: true, nlpService: true });
  }

  if (req.method === "GET" && url.pathname === "/api/cases") {
    return json(res, 200, readCases().map(c => ({
      caseId: c.caseId, createdAt: c.createdAt, updatedAt: c.updatedAt,
      language: c.language, inputMode: c.inputMode, svi: c.assessment?.svi ?? 0,
      risk: c.assessment?.risk ?? "LOW", reviewStatus: c.reviewStatus
    })));
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/cases/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const found = readCases().find(c => c.caseId === id);
    return found ? json(res, 200, found) : json(res, 404, { error: "Case not found" });
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    const body = await parseBody(req);
    const result = await callNlp(body);
    return json(res, 200, result);
  }

  if (req.method === "POST" && url.pathname === "/api/cases") {
    const body = await parseBody(req);
    const result = await callNlp(body);
    const now = new Date().toISOString();
    const caseRecord = {
      caseId: makeId(),
      createdAt: now,
      updatedAt: now,
      consent: !!body.consent,
      language: body.language || "English",
      inputMode: body.inputMode || "text",
      narrative: body.narrative || "",
      voice: body.voice || null,
      additions: [],
      assessment: result,
      reviewStatus: "PENDING_HUMAN_REVIEW",
      audit: [{ at: now, action: "CASE_CREATED" }]
    };
    const cases = readCases();
    cases.unshift(caseRecord);
    writeCases(cases);
    return json(res, 201, caseRecord);
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/add")) {
    const parts = url.pathname.split("/");
    const id = decodeURIComponent(parts[3]);
    const body = await parseBody(req);
    const cases = readCases();
    const index = cases.findIndex(c => c.caseId === id);
    if (index < 0) return json(res, 404, { error: "Case not found" });

    const c = cases[index];
    const addition = (body.addition || "").trim();
    if (!addition) return json(res, 400, { error: "Addition is empty" });

    c.narrative = [c.narrative, addition].filter(Boolean).join("\n\n");
    c.additions.push({ at: new Date().toISOString(), text: addition, source: body.source || "text" });

    const mergedVoice = body.voiceUpdate || c.voice || null;
    const result = await callNlp({
      narrative: c.narrative,
      language: body.language || c.language,
      inputMode: "text+voice",
      voice: mergedVoice
    });
    c.voice = mergedVoice;
    c.assessment = result;
    c.updatedAt = new Date().toISOString();
    c.audit.push({ at: c.updatedAt, action: "CASE_UPDATED_WITH_ADDITIONAL_INFORMATION" });
    writeCases(cases);
    return json(res, 200, c);
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/cases/") && url.pathname.endsWith("/review")) {
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const body = await parseBody(req);
    const cases = readCases();
    const index = cases.findIndex(c => c.caseId === id);
    if (index < 0) return json(res, 404, { error: "Case not found" });
    cases[index].reviewStatus = body.status || "REVIEWED";
    cases[index].humanReviewNote = body.note || "";
    cases[index].updatedAt = new Date().toISOString();
    cases[index].audit.push({ at: cases[index].updatedAt, action: "HUMAN_REVIEW_UPDATED" });
    writeCases(cases);
    return json(res, 200, cases[index]);
  }

  return json(res, 404, { error: "API route not found" });
}

function serveStatic(req, res, url) {
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) return json(res, 403, { error: "Forbidden" });

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return json(res, 404, { error: "Page not found" });
    const ext = path.extname(full);
    const types = { ".html":"text/html", ".css":"text/css", ".js":"application/javascript", ".json":"application/json" };
    res.writeHead(200, { "Content-Type": (types[ext] || "application/octet-stream") + "; charset=utf-8" });
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`NHAA Sahayak running at http://localhost:${PORT}`);
  console.log(`NLP service expected at http://127.0.0.1:${NLP_PORT}`);
});

process.on("SIGINT", () => {
  if (nlpProcess) nlpProcess.kill();
  server.close(() => process.exit(0));
});
