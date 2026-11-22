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
/* Arabic error translation                                            */
/* ------------------------------------------------------------------ */

const unescape = (s) =>
  String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );

const clean = (s) =>
  unescape(s)
    .replace(/\r/g, "")
    .replace(/[ \t]+$/gm, "")
    .trim();

const EXPECTED_AR = {
  "<EOF>": "نهاية الملف",
  "<ARABIC_IDENTIFIER>": "اسم متغير",
  "<NUMBER>": "رقم",
  "<STRING>": "نص بين علامتي تنصيص",
  ";": "الفاصلة المنقوطة ;",
  "(": "القوس (",
  ")": "القوس )",
  "{": "القوس {",
  "}": "القوس }",
};

function translateToken(tok) {
  const t = tok.trim().replace(/^"|"$/g, "").replace(/^<|>$/g, "");
  if (EXPECTED_AR[t]) return EXPECTED_AR[t];
  if (/^\+$|^-$|^\*$|^\/$|^==$|^!=$|^>$|^<$|^>=$|^<=$|^=$/.test(t))
    return `«${t}»`;
  return `«${t}»`;
}

function splitExpected(raw) {
  const m = raw.match(/Was expecting(?: one of)?:\s*([\s\S]*)$/i);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) =>
      l
        .trim()
        .replace(/\.\.\.$/, "")
        .trim(),
    )
    .filter((l) => l && !/^Encountered|^Was expecting/i.test(l))
    .map(translateToken)
    .slice(0, 6);
}

function translateParseError(raw) {
  const txt = clean(raw);
  const line = Number((txt.match(/at line (\d+)/) || [])[1] || -1);
  const column = Number((txt.match(/column (\d+)/) || [])[1] || -1);
  const encMatch = txt.match(
    /Encountered:\s*(?:<([^>]+)>|"([^"]*)"|(.+?))\s+at line/i,
  );
  const encounteredRaw = encMatch
    ? (encMatch[1] || encMatch[2] || encMatch[3] || "").trim()
    : "";
  const eof =
    /^<EOF>$|^<EOF>\s*$/i.test(encounteredRaw) ||
    /Encountered "?\s*<EOF>/.test(txt);
  const expected = splitExpected(txt);

  let message;
  if (eof) {
    message = `انتهى الكود قبل أن تكتمل الجملة${line > 0 ? ` (السطر ${line}, العمود ${column})` : ""}.`;
  } else {
    const enc = encounteredRaw.startsWith("<")
      ? translateToken(encounteredRaw)
      : `«${encounteredRaw.replace(/^"|"$/g, "")}»`;
    message =
      `وجد المُحلِّل ${enc} في موضع غير متوقّع` +
      (line > 0 ? ` عند السطر ${line}, العمود ${column}` : "") +
      ".";
  }
  if (expected.length) message += ` كان المتوقَّع: ${expected.join(" / ")}.`;

  let hint =
    "راجع السطر: تأكّد من الفاصلة المنقوطة ; بعد كل جملة، ومن إغلاق الأقواس والكلمات المفتاحية.";
  if (eof) {
    hint =
      "غالبًا نسيت الفاصلة المنقوطة ; في آخر جملة، أو أغلق القوس { } للحلقة/الشرط.";
  } else if (expected.some((e) => e.includes(";"))) {
    hint =
      "الفاصلة المنقوطة ; ناقصة قبل هذا الموضع — كل جملة في «لغة الضاد» تنتهي بـ ;";
  } else if (expected.some((e) => e.includes(")") || e.includes("}"))) {
    hint = "أغلق القوس المفتوح قبل هذا الموضع.";
  }
  return { title: "خطأ نحوي", message, hint, line, column };
}

function translateLexicalError(raw) {
  const txt = clean(raw);
  const line = Number((txt.match(/line (\d+)/) || [])[1] || -1);
  const column = Number((txt.match(/column (\d+)/) || [])[1] || -1);
  const after = txt.match(/after prefix "([\s\S]*)"/);
  const bad = txt.match(
    /Encountered:\s*(?:<([^>]+)>|'([^']*)'|([\s\S]*?)(?:\(|$))/,
  );

  if (after) {
    return {
      title: "خطأ معجمي",
      message: `نص غير مغلق: بدأت السلسلة النصية ولم تُغلق بعلامة " (السطر ${line}).`,
      hint: 'أغلق النص بعلامة تنصيص مزدوجة " في نهايته.',
      line,
      column,
    };
  }
  const ch = bad ? bad[1] || bad[2] || (bad[3] || "").trim() : "";
  return {
    title: "خطأ معجمي",
    message: ch
      ? `رمز لا يمكن قراءته: «${ch}»${line > 0 ? ` في السطر ${line}, العمود ${column}` : ""}.`
      : `رمز غير معروف${line > 0 ? ` في السطر ${line}` : ""}.`,
    hint: "المسموح: الحروف العربية للأسماء، الأرقام، + - * / = == != > < >= <= ، الأقواس ( ) { } ، والفاصلة المنقوطة ; .",
    line,
    column,
  };
}

function translateRuntimeError(raw, symbols) {
  const msg = clean(raw);
  let hit;

  if ((hit = msg.match(/^Undefined variable:\s*(.+)$/))) {
    const name = hit[1].trim();
    return {
      title: "متغيّر غير معرَّف",
      message: `تم استخدام «${name}» قبل تعريفه.`,
      hint: `أضف قبل استخدامه: متغير ${name} = 0;`,
      name,
    };
  }
  if ((hit = msg.match(/^This variable '?(.+?)'? has been declared before/))) {
    const name = hit[1].trim();
    return {
      title: "تعريف مكرَّر",
      message: `المتغيّر «${name}» معرَّف مسبقًا في نفس البرنامج.`,
      hint: `لتغيير قيمته استخدم الإسناد فقط: ${name} = قيمة;`,
      name,
    };
  }
  if ((hit = msg.match(/^Variable (.+?) must be declared first/))) {
    const name = hit[1].trim();
    return {
      title: "إسناد قبل التعريف",
      message: `لا يمكن إسناد قيمة لـ «${name}» لأنه غير معرَّف.`,
      hint: `عرّفه أولًا: متغير ${name} = 0;`,
      name,
    };
  }
  if (/^Division by zero/i.test(msg)) {
    return {
      title: "قسمة على صفر",
      message: "لا يمكن القسمة على صفر.",
      hint: "تأكّد أن المقسوم عليه لا يساوي صفرًا قبل عملية القسمة.",
    };
  }
  if (/^Operators require numbers/i.test(msg)) {
    return {
      title: "أنواع غير متوافقة",
      message:
        "العملية الحسابية تحتاج أرقامًا، وواحد من الطرفين نص أو قيمة منطقية.",
      hint: 'الجمع + يسمح بضم النصوص فقط عندما يكون أحد الطرفين نصًا، مثل: "النتيجة: " + س',
    };
  }
  if (/^Stack overflow/i.test(msg)) {
    return {
      title: "تجاوز العمق",
      message: "البرنامج تجاوز حدود التنفيذ.",
      hint: "قلّل التكرار أو العمق.",
    };
  }
  return {
    title: "خطأ أثناء التنفيذ",
    message: msg || "خطأ غير معروف.",
    hint:
      symbols && symbols.length
        ? "الحالة الحالية للمتغيّرات معروضة في تبويب «المتغيّرات»."
        : "راجع الكود؛ فقد يكون هناك استخدام خاطئ لقيمة أو نوع.",
  };
}

function jsonError(kind, raw, extra) {
  return { kind, raw: clean(raw), ...extra };
}

/**
 * Runtime errors carry no position (the grammar only tracks tokens for the
 * parser). Find the most likely line from the identifier in the message so the
 * editor can still point at it — flagged as approximate in the UI.
 */
function guessLine(code, name, mode) {
  if (!name) return -1;
  const lines = code.split(/\r?\n/);
  const word = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(^|[^\\u0600-\\u06FF0-9])${word}([^\\u0600-\\u06FF0-9]|$)`,
  );

  if (mode === "decl") {
    const decls = [];
    lines.forEach((l, i) => {
      if (/^\s*متغير\s/.test(l) && re.test(l)) decls.push(i + 1);
    });
    return decls.length > 1 ? decls[decls.length - 1] : -1;
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^\s*متغير\s/.test(line)) continue;
    if (re.test(line)) return i + 1;
  }
  return -1;
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
        const raw = data.error.message || "";
        let t;
        if (data.error.kind === "syntax") t = translateParseError(raw);
        else if (data.error.kind === "lexical") t = translateLexicalError(raw);
        else if (data.error.kind === "runtime")
          t = translateRuntimeError(raw, symbols);
        else {
          t = {
            title: "خطأ داخلي",
            message: clean(raw) || "خطأ غير معروف.",
            hint: "راجع سجلّ الخادم.",
            line: -1,
            column: -1,
          };
        }
        error = jsonError(data.error.kind, raw, {
          ...t,
          line:
            Number.isFinite(t.line) && t.line > 0
              ? t.line
              : data.error.line > 0
                ? data.error.line
                : -1,
          column:
            Number.isFinite(t.column) && t.column > 0
              ? t.column
              : data.error.column > 0
                ? data.error.column
                : -1,
        });

        if (data.error.kind === "runtime" && !(error.line > 0) && t.name) {
          const guessed = guessLine(
            code,
            t.name,
            /مكرَّر/.test(t.title) ? "decl" : "use",
          );
          if (guessed > 0) {
            error.line = guessed;
            error.approx = true;
          }
        }
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
