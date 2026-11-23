import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * ArabicRunner: non-interactive wrapper around the LughatDad parser.
 *
 * Reads the program from stdin (UTF-8), executes it, and prints ONE JSON object
 * on stdout. Error text is produced here, in Arabic: the semantic errors come
 * straight from the grammar (they are Arabic there), and the parser/lexer
 * messages that JavaCC generates in English are rewritten before they leave.
 *
 *   {"ok":true,"out":"...","truncated":false,"ms":12,
 *    "error":{"kind":"runtime","title":"...","message":"...","hint":"...",
 *             "line":4,"column":-1,"approx":true,"raw":"..."},
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

  /* ------------------------- Arabic error text ------------------------- */

  static final Map<String, String> TOKEN_AR = new HashMap<>();
  static {
    TOKEN_AR.put("<EOF>", "نهاية الملف");
    TOKEN_AR.put("<ARABIC_IDENTIFIER>", "اسم متغيّر");
    TOKEN_AR.put("<NUMBER>", "رقم");
    TOKEN_AR.put("<STRING>", "نص بين علامتي تنصيص");
    TOKEN_AR.put(";", "الفاصلة المنقوطة ;");
    TOKEN_AR.put("(", "القوس (");
    TOKEN_AR.put(")", "القوس )");
    TOKEN_AR.put("{", "القوس {");
    TOKEN_AR.put("}", "القوس }");
  }

  /** Arabic name of a token kind, taken from the generated tokenImage table. */
  static String tokenName(int kind) {
    String raw;
    try {
      raw = LughatDadConstants.tokenImage[kind];
    } catch (ArrayIndexOutOfBoundsException e) {
      return "رمز";
    }
    String t = unescape(raw).replace("\"", "").replace("<", "").replace(">", "").trim();
    String ar = TOKEN_AR.get(t);
    return ar != null ? ar : "«" + t + "»";
  }

  /** The text the user sees for syntax errors, plus a hint. */
  static String[] syntaxText(ParseException pe) {
    Token lastGood = pe.currentToken;
    Token bad = lastGood != null ? lastGood.next : null;
    boolean eof = bad == null || bad.kind == LughatDadConstants.EOF;
    int line = bad != null ? bad.beginLine : -1;
    int column = bad != null ? bad.beginColumn : -1;
    String at = line > 0 ? " — السطر " + line + "، العمود " + column : "";

    List<String> expected = new ArrayList<>();
    if (pe.expectedTokenSequences != null) {
      LinkedHashSet<Integer> kinds = new LinkedHashSet<>();
      for (int[] seq : pe.expectedTokenSequences) {
        if (seq.length > 0) kinds.add(seq[0]);
        if (kinds.size() >= 5) break;
      }
      for (int k : kinds) expected.add(tokenName(k));
    }

    String message = eof
        ? "انتهى الكود قبل أن تكتمل الجملة" + at + "."
        : "وجد المُحلِّل «" + bad.image + "» في موضع غير متوقَّع" + at + ".";
    if (!expected.isEmpty()) message += " المتوقَّع: " + String.join(" / ", expected) + ".";

    String hint;
    if (eof) {
      hint = "غالبًا نسيت الفاصلة المنقوطة ; في آخر جملة، أو لم تُغلق القوس { للحلقة أو الشرط.";
    } else if (expected.contains("الفاصلة المنقوطة ;")) {
      hint = "الفاصلة المنقوطة ; ناقصة قبل هذا الموضع — كل جملة في لغة الضاد تنتهي بـ ;";
    } else if (expected.contains("القوس )") || expected.contains("القوس }")) {
      hint = "أغلق القوس المفتوح قبل هذا الموضع.";
    } else {
      hint = "راجع السطر: ترتيب الكلمات المفتاحية، والفاصلة المنقوطة ; بعد كل جملة، وإغلاق الأقواس.";
    }
    return new String[]{message, hint};
  }

  /** The text the user sees for lexical errors, plus a hint. */
  static String[] lexicalText(String raw) {
    int[] at = where(raw);
    String where = at != null ? " — السطر " + at[0] + "، العمود " + at[1] : "";

    if (raw != null && raw.contains("after prefix")) {
      return new String[]{
        "نص غير مغلق: بدأت السلسلة النصية ولم تُغلق بعلامة تنصيص مزدوجة" + where + ".",
        "أغلق النص بعلامة \" في نهايته."
      };
    }

    String ch = lexicalChar(raw);
    String message = ch == null
        ? "رمز لا يمكن قراءته" + where + "."
        : "رمز لا يمكن قراءته: «" + ch + "»" + where + ".";
    return new String[]{
      message,
      "المسموح: حروف عربية للأسماء، أرقام، + - * / = == != > < >= <= ، الأقواس ( ) { } ، والفاصلة المنقوطة ;"
    };
  }

  static String lexicalChar(String raw) {
    if (raw == null) return null;
    int i = raw.indexOf("Encountered:");
    if (i < 0) return null;
    String rest = raw.substring(i + "Encountered:".length()).trim();
    if (rest.startsWith("<EOF>")) return "نهاية الملف";
    if (rest.startsWith("'")) {
      int j = rest.indexOf('\'', 1);
      return j > 1 ? rest.substring(1, j) : rest;
    }
    int cut = rest.length();
    for (char c : new char[]{'(', ',', '\n'}) {
      int k = rest.indexOf(c);
      if (k > 0 && k < cut) cut = k;
    }
    String out = rest.substring(0, cut).trim();
    return out.isEmpty() ? null : out;
  }

  /** «س» -> س, for errors that name a variable. */
  static String quotedName(String msg) {
    if (msg == null) return null;
    int a = msg.indexOf('«');
    int b = msg.indexOf('»', a + 1);
    return (a >= 0 && b > a) ? msg.substring(a + 1, b) : null;
  }

  /**
   * Runtime errors carry no position (the grammar only tracks tokens for the
   * parser), so point at the most likely line and flag it as approximate.
   */
  static int guessLine(String code, String name, boolean declaration) {
    if (name == null) return -1;
    String[] lines = code.split("\r?\n");
    String word = java.util.regex.Pattern.quote(name);
    String rx = "(^|[^\\u0600-\\u06FF0-9])" + word + "([^\\u0600-\\u06FF0-9]|$)";
    java.util.regex.Pattern p = java.util.regex.Pattern.compile(rx);
    java.util.regex.Pattern decl = java.util.regex.Pattern.compile("^\\s*متغير\\s");

    if (declaration) {
      int found = -1, count = 0;
      for (int i = 0; i < lines.length; i++) {
        if (decl.matcher(lines[i]).find() && p.matcher(lines[i]).find()) {
          found = i + 1;
          count++;
        }
      }
      return count > 1 ? found : -1;
    }
    for (int i = lines.length - 1; i >= 0; i--) {
      if (decl.matcher(lines[i]).find()) continue;
      if (p.matcher(lines[i]).find()) return i + 1;
    }
    return -1;
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

    String kind = null, title = null, message = null, hint = null, raw = null;
    int line = -1, column = -1;
    boolean approx = false;

    long t0 = System.nanoTime();
    try {
      LughatDad parser = new LughatDad(tm);
      List stmts = parser.Start();
      for (Object s : stmts) ((LughatDad.Stmt) s).exec();
    } catch (ParseException pe) {
      kind = "syntax";
      title = "خطأ نحوي";
      raw = pe.getMessage();
      String[] text = syntaxText(pe);
      message = text[0];
      hint = text[1];
      Token bad = (pe.currentToken != null && pe.currentToken.next != null)
          ? pe.currentToken.next : pe.currentToken;
      if (bad != null) { line = bad.beginLine; column = bad.beginColumn; }
    } catch (TokenMgrError te) {
      kind = "lexical";
      title = "خطأ معجمي";
      raw = te.getMessage();
      String[] text = lexicalText(raw);
      message = text[0];
      hint = text[1];
      int[] w = where(raw);
      if (w != null) { line = w[0]; column = w[1]; }
    } catch (StackOverflowError so) {
      kind = "runtime";
      title = "خطأ أثناء التنفيذ";
      message = "تجاوز البرنامج حدود التنفيذ — قلّل التكرار أو العمق.";
    } catch (RuntimeException re) {
      kind = "runtime";
      title = "خطأ أثناء التنفيذ";
      message = String.valueOf(re.getMessage());
      raw = re.getClass().getSimpleName() + ": " + message;
      String name = quotedName(message);
      int guessed = guessLine(code, name, message.contains("معرَّف مسبقًا"));
      if (guessed > 0) { line = guessed; approx = true; }
    } catch (Throwable t) {
      kind = "internal";
      title = "خطأ داخلي";
      message = t.getClass().getSimpleName() + ": " + t.getMessage();
      raw = message;
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
        + ",\"title\":" + json(title)
        + ",\"message\":" + json(message)
        + ",\"hint\":" + json(hint)
        + ",\"line\":" + line
        + ",\"column\":" + column
        + ",\"approx\":" + approx
        + ",\"raw\":" + json(raw) + "}");
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
