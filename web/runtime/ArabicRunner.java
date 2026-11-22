import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * ArabicRunner: non-interactive wrapper around the LughatDad parser.
 * Reads the program from stdin (UTF-8), executes it, and prints ONE JSON object
 * on stdout so the web front-end can render everything:
 *
 *   {"ok":true,"out":"...","truncated":false,"ms":12,
 *    "error":{"kind":"syntax","message":"...","line":1,"column":12,"raw":"..."},
 *    "symbols":[["س","Double","5.0"]],
 *    "tokens":[["ARABIC_IDENTIFIER","س",1,1]]}
 *
 * Must live in the default package: LughatDad's nested Stmt interface and
 * symbolTable are package-private.
 */
public class ArabicRunner {

  static final int MAX_OUTPUT = 200_000;

  /** OutputStream that keeps only the first MAX_OUTPUT characters. */
  static class Capped extends OutputStream {
    final ByteArrayOutputStream buf = new ByteArrayOutputStream();
    boolean truncated = false;
    int written = 0;
    public void write(int b) {
      if (written < MAX_OUTPUT) { buf.write(b); written++; }
      else truncated = true;
    }
    public void write(byte[] b, int off, int len) {
      for (int i = 0; i < len; i++) write(b[off + i]);
    }
  }

  /** JavaCC stores non-ASCII literals escaped: turn "\u0645\u062a" back into Arabic. */
  static String unescape(String s) {
    if (s == null || s.indexOf("\\u") < 0) return s;
    StringBuilder b = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      if (s.charAt(i) == '\\' && i + 5 < s.length() && s.charAt(i + 1) == 'u') {
        b.append((char) Integer.parseInt(s.substring(i + 2, i + 6), 16));
        i += 5;
      } else b.append(s.charAt(i));
    }
    return b.toString();
  }

  static String json(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder(s.length() + 16);
    b.append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"':  b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\n': b.append("\\n"); break;
        case '\r': b.append("\\r"); break;
        case '\t': b.append("\\t"); break;
        default:
          if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
      }
    }
    return b.append('"').toString();
  }

  /** "at line 3, column 5" / "line 3, column 5" */
  static int[] where(String msg) {
    if (msg == null) return null;
    java.util.regex.Matcher m =
        java.util.regex.Pattern.compile("line (\\d+),\\s*column (\\d+)").matcher(msg);
    if (m.find()) return new int[]{Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2))};
    return null;
  }

  public static void main(String[] args) {
    String code;
    try {
      code = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
    } catch (IOException e) {
      code = "";
    }

    // --- token stream (before parsing, so a syntax error still shows tokens) ---
    // STATIC=true means only ONE SimpleCharStream / lexer may be built per JVM,
    // so we build it once, dump the tokens, then ReInit the same stream for the parser.
    SimpleCharStream scs = new SimpleCharStream(new StringReader(code), 1, 1);
    LughatDadTokenManager tm = new LughatDadTokenManager(scs);
    StringBuilder tokens = new StringBuilder();
    try {
      int n = 0;
      while (true) {
        Token t = tm.getNextToken();
        if (t.kind == LughatDadConstants.EOF) break;
        if (n++ > 0) tokens.append(',');
        String label = unescape(LughatDadConstants.tokenImage[t.kind]
            .replace("\"", "").replace("<", "").replace(">", ""));
        tokens.append('[').append(json(label)).append(',')
              .append(json(t.image)).append(',')
              .append(t.beginLine).append(',').append(t.beginColumn).append(']');
        if (n > 5000) break;
      }
    } catch (Throwable ignore) {
      // a lexical error simply ends the token list; the parser reports it properly
    }
    scs.ReInit(new StringReader(code), 1, 1);
    LughatDadTokenManager.ReInit(scs);

    PrintStream realOut = System.out;
    Capped cap = new Capped();
    PrintStream capture = new PrintStream(cap, true, StandardCharsets.UTF_8);
    System.setOut(capture);

    String kind = null, message = null;
    int line = -1, column = -1;

    long t0 = System.nanoTime();
    try {
      LughatDad parser = new LughatDad(tm);
      List stmts = parser.Start();
      for (Object s : stmts) ((LughatDad.Stmt) s).exec();
    } catch (ParseException pe) {
      kind = "syntax";
      message = pe.getMessage();
      Token bad = (pe.currentToken != null && pe.currentToken.next != null)
          ? pe.currentToken.next : pe.currentToken;
      if (bad != null) { line = bad.beginLine; column = bad.beginColumn; }
    } catch (TokenMgrError te) {
      kind = "lexical";
      message = te.getMessage();
      int[] w = where(message);
      if (w != null) { line = w[0]; column = w[1]; }
    } catch (StackOverflowError so) {
      kind = "runtime";
      message = "Stack overflow: recursion is too deep.";
    } catch (RuntimeException re) {
      kind = "runtime";
      message = String.valueOf(re.getMessage());
    } catch (Throwable t) {
      kind = "internal";
      message = t.getClass().getSimpleName() + ": " + t.getMessage();
    }
    long ms = (System.nanoTime() - t0) / 1_000_000;

    capture.flush();
    System.setOut(realOut);

    // --- symbol table ---
    StringBuilder symbols = new StringBuilder();
    List<String> names = new ArrayList<>(LughatDad.symbolTable.keySet());
    Collections.sort(names);
    for (int i = 0; i < names.size(); i++) {
      String name = names.get(i);
      Object v = LughatDad.symbolTable.get(name);
      if (i > 0) symbols.append(',');
      symbols.append('[').append(json(name)).append(',')
             .append(json(v == null ? "null" : v.getClass().getSimpleName())).append(',')
             .append(json(String.valueOf(v))).append(']');
    }

    StringBuilder out = new StringBuilder(1024);
    out.append('{').append("\"ok\":").append(kind == null);
    out.append(",\"out\":").append(json(new String(cap.buf.toByteArray(), StandardCharsets.UTF_8)));
    out.append(",\"truncated\":").append(cap.truncated);
    out.append(",\"ms\":").append(ms);
    out.append(",\"error\":").append(kind == null ? "null" : "{"
        + "\"kind\":" + json(kind)
        + ",\"message\":" + json(message)
        + ",\"line\":" + line
        + ",\"column\":" + column + "}");
    out.append(",\"symbols\":[").append(symbols).append(']');
    out.append(",\"tokens\":[").append(tokens).append(']');
    out.append('}');

    try {
      PrintStream utf8 = new PrintStream(
          new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
      utf8.print(out);
      utf8.flush();
    } catch (Exception e) {
      realOut.println(out);
    }
    System.exit(0);
  }
}
