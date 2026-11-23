/**
 * LughatDad — web showcase server.
 *
 * Zero dependencies: node web/server.js  (or: npm start)
 *
 *   GET  /            -> the editor page
 *   POST /api/run     -> {code} -> runs the real JavaCC parser, returns JSON
 *   GET  /api/status  -> build + environment info
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ensureBuild, ROOT, CLASSES, RUNNER_OUT } = require("./build");

const PORT = Number(process.env.PORT || 3030);
const PUBLIC = path.join(__dirname, "public");
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 6000);
const MAX_CODE = 20000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * One shape for every error the page shows. The text is already Arabic:
 * semantic errors are written in LughatDad.jj, and ArabicRunner rewrites the
 * parser/lexer messages that JavaCC generates in English.
 */
function jsonError(kind, raw, extra) {
  return { kind, raw: String(raw || ""), hint: "", approx: false, ...extra };
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

const CLASSPATH = [CLASSES, RUNNER_OUT].join(path.delimiter);

function runProgram(code) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      "java",
      [
        "-Dfile.encoding=UTF-8",
        "-Dstdout.encoding=UTF-8",
        "-Dstderr.encoding=UTF-8",
        "-Xss8m",
        "-cp",
        CLASSPATH,
        "ArabicRunner",
      ],
      { cwd: ROOT, windowsHide: true },
    );

    let stdout = "";
    let stderr = "";
    let done = false;
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill("SIGKILL");
      } catch (_) {}
    }, RUN_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });

    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        out: "",
        ms: Date.now() - started,
        error: jsonError("internal", e.message, {
          title: "تعذّر التشغيل",
          message: `لم يتمكّن الخادم من تشغيل Java: ${e.message}`,
          hint: "تأكّد من تثبيت JDK 17+ وأن java موجود في PATH.",
          line: -1,
          column: -1,
        }),
        symbols: [],
        tokens: [],
      });
    });

    child.on("close", () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const ms = Date.now() - started;

      if (killed) {
        return resolve({
          ok: false,
          out: "",
          ms,
          symbols: [],
          tokens: [],
          error: jsonError("timeout", "", {
            title: "انتهى وقت التنفيذ",
            message: `لم ينتهِ البرنامج خلال ${(RUN_TIMEOUT_MS / 1000).toFixed(0)} ثوانٍ وتم إيقافه.`,
            hint: "تأكّد أن شرط الحلقة يتغيّر داخل جسمها (مثال: س = س + 1;) حتى تنتهي.",
            line: -1,
            column: -1,
          }),
        });
      }

      let data = null;
      const trimmed = stdout.trim();
      if (trimmed.startsWith("{")) {
        try {
          data = JSON.parse(trimmed);
        } catch (_) {}
      }
      if (!data) {
        return resolve({
          ok: false,
          out: stdout,
          ms,
          symbols: [],
          tokens: [],
          error: jsonError(
            "internal",
            (stderr || stdout || "no output").slice(0, 1200),
            {
              title: "خطأ في الخادم",
              message: "لم يُرجع المُفسِّر نتيجة صالحة.",
              hint: "راجع سجلّ الخادم في الطرفية.",
              line: -1,
              column: -1,
            },
          ),
        });
      }

      const symbols = data.symbols || [];
      let error = null;
      if (data.error) {
        const e = data.error;
        error = jsonError(e.kind, e.raw || e.message, {
          title: e.title || "خطأ",
          message: e.message || "",
          hint: e.hint || "",
          approx: !!e.approx,
          line: e.line > 0 ? e.line : -1,
          column: e.column > 0 ? e.column : -1,
        });
      }

      resolve({
        ok: !!data.ok,
        out: data.out || "",
        truncated: !!data.truncated,
        ms: data.ms != null ? data.ms : ms,
        error,
        symbols,
        tokens: data.tokens || [],
      });
    });

    child.stdin.end(code, "utf8");
  });
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function send(res, status, body, type = "application/json; charset=utf-8") {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "not found", "text/plain; charset=utf-8");
    res.writeHead(200, {
      "Content-Type":
        MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": buf.length,
      "Cache-Control": "no-store",
    });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > MAX_CODE * 4) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function main() {
  process.on("uncaughtException", (e) => console.error("[server] uncaught", e));
  process.on("unhandledRejection", (e) =>
    console.error("[server] unhandled", e),
  );

  try {
    await ensureBuild();
  } catch (e) {
    console.error("\n[build] FAILED\n" + e.message + "\n");
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url.split("?")[0];

    if (req.method === "GET" && url === "/api/status") {
      return send(res, 200, {
        ok: true,
        java: process.env.JAVA_VERSION || "java",
        timeoutMs: RUN_TIMEOUT_MS,
        node: process.version,
        parser: "JavaCC 7.0.13",
      });
    }

    if (req.method === "POST" && url === "/api/run") {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch (e) {
        return send(res, 400, {
          ok: false,
          error: { title: "طلب غير صالح", message: "JSON غير صالح." },
        });
      }
      const code = typeof body.code === "string" ? body.code : "";
      if (code.length > MAX_CODE) {
        return send(res, 413, {
          ok: false,
          error: {
            kind: "limit",
            title: "الكود طويل جدًا",
            message: `الحد ${MAX_CODE} حرفًا.`,
            hint: "اختصر البرنامج.",
            line: -1,
            column: -1,
          },
        });
      }
      if (!code.trim()) {
        return send(res, 200, {
          ok: false,
          out: "",
          ms: 0,
          symbols: [],
          tokens: [],
          error: {
            kind: "empty",
            title: "لا يوجد كود",
            message: "المحرّر فارغ.",
            hint: "اكتب برنامجًا أو اختر مثالًا من القائمة.",
            line: -1,
            column: -1,
          },
        });
      }
      let result;
      try {
        result = await runProgram(code);
      } catch (e) {
        result = {
          ok: false,
          out: "",
          ms: 0,
          symbols: [],
          tokens: [],
          error: {
            kind: "internal",
            raw: String(e && e.message ? e.message : e),
            title: "خطأ في الخادم",
            message: String(e && e.message ? e.message : e),
            hint: "راجع سجلّ الخادم في الطرفية.",
            line: -1,
            column: -1,
          },
        };
      }
      return send(res, 200, result);
    }

    if (req.method === "GET") return serveStatic(req, res);
    return send(res, 405, { error: "method not allowed" });
  });

  server.listen(PORT, () => {
    console.log(
      `\n  لغة الضاد — واجهة الويب جاهزة على http://localhost:${PORT}\n`,
    );
  });
}

main();
