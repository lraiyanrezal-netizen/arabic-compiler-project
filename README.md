# Arabic Compiler Project (LughatDad)

## How to Build & Run

1. Generate the Java files:
   `javacc LughatDad.jj`

2. Compile the Java files:
   `javac -encoding UTF-8 *.java`

3. Start the program:
   `java -Dfile.encoding=UTF-8 LughatDad`

## How to Exit

- Finish & Exit: Press `Ctrl + D` on a new line.
- Force Quit: Press `Ctrl + C`.

---

## Web showcase (online compiler)

A browser interface that runs the real JavaCC parser: editor on the right, terminal on the left.

```bash
npm start        # builds if needed, then serves http://localhost:3000
```

or double-click `start.bat`. Ports/timeouts: `PORT` (default 3000), `RUN_TIMEOUT_MS` (default 6000).

| Path                            | What it is                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `web/server.js`                 | zero-dependency HTTP server; `POST /api/run` pipes the code into the parser                          |
| `web/build.js`                  | javacc → javac → runner build (auto-downloads `tools/javacc.jar` if missing)                         |
| `web/runtime/ArabicRunner.java` | runs a program non-interactively and returns JSON: output, error (+line), token stream, symbol table |
| `web/public/`                   | the interface: Arabic UI, syntax highlighting, terminal, tokens, variables, Arabic error messages    |

Deep links for demos: `/?ex=3` loads example #3, `/?ex=5&pane=tokens` opens the tokens tab.
