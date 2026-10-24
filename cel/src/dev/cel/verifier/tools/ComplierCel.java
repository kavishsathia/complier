// complier's CEL backend: Google's cel-java runtime and formal verifier behind one JSON request per
// stdin line and one JSON reply per stdout line. It lives in the verifier's tools package to reuse
// CelVerifierToolCore and VerificationOptions as the verifier's own CLI does, and its requests are
// the ones the website's CelVerifierWeb facade answers; only the transport differs (stdio, not
// CheerpJ) and Z3 is the native library z3-turnkey ships.
//
// Requests ({"op": ..., ...}):
//   version                                    -> which jars and Z3 are running
//   compile  {expr, vars}                      -> {type}: parse and type-check only
//   sat      {expr, vars, timeoutMs, unroll}   -> {status, reason, counterexample, message}
//   valid    {expr, vars, timeoutMs, unroll}   -> the same, for isAlwaysTrue
//   evaluate {vars, bindings, exprs, values}   -> {inputErrors, results, values}
// Every reply has "ok"; a failure is {"ok": false, "kind": "compile" | "runtime", "error", "rootError"}.
// `vars` is the verifier's own variable syntax: one `name:type` per line.
package dev.cel.verifier.tools;

import com.google.common.collect.ImmutableMap;
import com.google.common.primitives.UnsignedLong;
import dev.cel.common.CelAbstractSyntaxTree;
import dev.cel.common.CelOptions;
import dev.cel.common.CelValidationException;
import dev.cel.common.types.CelType;
import dev.cel.common.types.SimpleType;
import dev.cel.common.values.NullValue;
import dev.cel.compiler.CelCompiler;
import dev.cel.extensions.CelExtensions;
import dev.cel.runtime.CelEvaluationException;
import dev.cel.runtime.CelRuntime;
import dev.cel.runtime.CelRuntimeFactory;
import dev.cel.verifier.CelVerificationResult;
import dev.cel.verifier.CelVerifier;
import java.io.BufferedReader;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

public final class ComplierCel {
  private ComplierCel() {}

  public static void main(String[] args) throws Exception {
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
    // Anything a library prints goes to stderr, so it can't corrupt the replies.
    System.setOut(System.err);
    for (String line = in.readLine(); line != null; line = in.readLine()) {
      if (line.trim().isEmpty()) {
        continue;
      }
      String reply;
      try {
        reply = handle(asMap(Json.parse(line)));
      } catch (Throwable t) {
        reply = fail(t);
      }
      out.println(reply);
    }
  }

  private static String handle(Map<String, Object> request) throws Exception {
    String op = string(request, "op");
    switch (op) {
      case "version":
        return "{\"ok\":true,\"verifier\":\""
            + FormatUtils.escapeJson(jarOf(CelVerifier.class))
            + "\",\"runtime\":\""
            + FormatUtils.escapeJson(jarOf(CelRuntime.class))
            + "\",\"z3\":\""
            + FormatUtils.escapeJson(com.microsoft.z3.Version.getFullVersion())
            + "\",\"java\":\""
            + FormatUtils.escapeJson(System.getProperty("java.version"))
            + "\"}";
      case "compile":
        return compile(string(request, "expr"), string(request, "vars"));
      case "sat":
      case "valid":
        return verify(
            op.equals("sat"),
            string(request, "expr"),
            string(request, "vars"),
            (int) number(request, "timeoutMs"),
            (int) number(request, "unroll"));
      case "evaluate":
        return evaluate(
            string(request, "vars"),
            asList(request.get("bindings")),
            asList(request.get("exprs")),
            request.containsKey("values") ? asList(request.get("values")) : List.of());
      default:
        throw new IllegalArgumentException("unknown op " + op);
    }
  }

  private static String jarOf(Class<?> c) {
    try {
      return Paths.get(c.getProtectionDomain().getCodeSource().getLocation().toURI()).getFileName().toString();
    } catch (Exception e) {
      return "unknown";
    }
  }

  // ---- variables, compilers, runtime -------------------------------------------------------

  /** Variables arrive one per line as {@code name:type}, as on the website. */
  private static ImmutableMap<String, CelType> vars(String varSpecs) {
    List<String> specs = new ArrayList<>();
    for (String line : varSpecs.split("\n")) {
      String s = line.trim();
      if (!s.isEmpty() && !s.startsWith("//") && !s.startsWith("#")) {
        specs.add(s);
      }
    }
    return VerificationOptions.parseVariables(specs);
  }

  private static final Map<String, CelCompiler> COMPILERS = new HashMap<>();

  private static CelCompiler compiler(String varSpecs) {
    return COMPILERS.computeIfAbsent(varSpecs, v -> CelVerifierToolCore.buildCompiler(vars(v)));
  }

  /** The runtime half of the verifier's environment: the same extensions, evaluated. */
  private static final CelRuntime RUNTIME =
      CelRuntimeFactory.plannerRuntimeBuilder()
          .addLibraries(
              CelExtensions.encoders(CelOptions.DEFAULT),
              CelExtensions.lists(),
              CelExtensions.math(),
              CelExtensions.optional(),
              CelExtensions.regex(),
              CelExtensions.sets(CelOptions.DEFAULT),
              CelExtensions.strings(),
              CelExtensions.comprehensions())
          .build();

  /** Compiled unit predicates and values, which repeat on every call; literals aren't kept. */
  private static final Map<String, CelAbstractSyntaxTree> ASTS = new HashMap<>();

  private static final Map<String, CelRuntime.Program> PROGRAMS = new HashMap<>();

  private static CelAbstractSyntaxTree ast(String varSpecs, String expr) throws CelValidationException {
    String key = varSpecs + '\u0000' + expr;
    CelAbstractSyntaxTree ast = ASTS.get(key);
    if (ast == null) {
      ast = compiler(varSpecs).compile(expr).getAst();
      if (ASTS.size() > 4096) {
        ASTS.clear();
        PROGRAMS.clear();
      }
      ASTS.put(key, ast);
    }
    return ast;
  }

  private static CelRuntime.Program program(String varSpecs, String expr, CelAbstractSyntaxTree ast)
      throws CelEvaluationException {
    String key = varSpecs + '\u0000' + expr;
    CelRuntime.Program program = PROGRAMS.get(key);
    if (program == null) {
      program = RUNTIME.createProgram(ast);
      PROGRAMS.put(key, program);
    }
    return program;
  }

  // ---- compile and verify ------------------------------------------------------------------

  /** Parse and type-check only; no solver. */
  private static String compile(String expr, String varSpecs) {
    try {
      CelAbstractSyntaxTree ast = compiler(varSpecs).compile(expr).getAst();
      return "{\"ok\":true,\"type\":\"" + FormatUtils.escapeJson(ast.getResultType().toString()) + "\"}";
    } catch (Throwable t) {
      return fail(t);
    }
  }

  private static String verify(boolean sat, String expr, String varSpecs, int timeoutMs, int unroll) {
    try {
      VerificationOptions options =
          VerificationOptions.builder()
              .setTimeout(Duration.ofMillis(timeoutMs))
              .setComprehensionUnrollLimit(unroll)
              .build();
      CelVerificationResult r =
          sat
              ? CelVerifierToolCore.checkSatisfiable(expr, vars(varSpecs), options)
              : CelVerifierToolCore.checkValid(expr, vars(varSpecs), options);
      return "{\"ok\":true,\"status\":\""
          + r.status()
          + "\",\"reason\":\""
          + FormatUtils.escapeJson(r.reason())
          + "\",\"counterexample\":\""
          + FormatUtils.escapeJson(r.counterexample())
          + "\",\"message\":\""
          + FormatUtils.escapeJson(r.message())
          + "\"}";
    } catch (Throwable t) {
      return fail(t);
    }
  }

  private static String fail(Throwable t) {
    Throwable root = t;
    while (root.getCause() != null && root.getCause() != root) {
      root = root.getCause();
    }
    String kind = t instanceof CelValidationException ? "compile" : "runtime";
    return "{\"ok\":false,\"kind\":\""
        + kind
        + "\",\"error\":\""
        + FormatUtils.escapeJson(t.getMessage() == null ? t.toString() : t.getMessage())
        + "\",\"rootError\":\""
        + FormatUtils.escapeJson(root.toString())
        + "\"}";
  }

  // ---- evaluate ----------------------------------------------------------------------------

  private static final Map<String, CelCompiler> LITERAL_COMPILERS = new HashMap<>();

  /**
   * Evaluates expressions against one concrete input with cel-java's runtime; no solver.
   *
   * <p>{@code bindings} are {@code [name, literal]} pairs; each literal is a CEL expression with no
   * variables, compiled against its field's declared type (so {@code 5} is not a {@code double}).
   * Every declared variable must be bound exactly once and nothing else may be; otherwise nothing
   * is evaluated and the problems come back as {@code inputErrors}. {@code exprs} must be bool and
   * come back as {@code results}; {@code values} (null entries skipped) may be any type that has a
   * JSON form and come back as {@code values}.
   */
  private static String evaluate(String varSpecs, List<Object> bindings, List<Object> exprs, List<Object> values)
      throws Exception {
    ImmutableMap<String, CelType> declared = vars(varSpecs);
    Map<String, Object> activation = new LinkedHashMap<>();
    Set<String> seen = new HashSet<>();
    List<String> inputErrors = new ArrayList<>();
    for (Object b : bindings) {
      List<Object> pair = asList(b);
      String name = (String) pair.get(0);
      String literal = (String) pair.get(1);
      CelType type = declared.get(name);
      if (type == null) {
        inputErrors.add(inputError(name, "not a declared field"));
      } else if (!seen.add(name)) {
        inputErrors.add(inputError(name, "bound more than once"));
      } else if (literal.trim().isEmpty()) {
        inputErrors.add(inputError(name, "missing value"));
      } else {
        try {
          CelCompiler literals =
              LITERAL_COMPILERS.computeIfAbsent(
                  type.toString(),
                  t -> CelVerifierToolCore.buildCompiler(ImmutableMap.of()).toCompilerBuilder().setResultType(type).build());
          CelAbstractSyntaxTree ast = literals.compile(literal).getAst();
          activation.put(name, RUNTIME.createProgram(ast).eval(ImmutableMap.of()));
        } catch (CelValidationException e) {
          inputErrors.add(inputError(name, e.getMessage()));
        } catch (CelEvaluationException e) {
          inputErrors.add(inputError(name, describe(e)));
        }
      }
    }
    for (String name : declared.keySet()) {
      if (!seen.contains(name)) {
        inputErrors.add(inputError(name, "missing value"));
      }
    }

    StringBuilder sb = new StringBuilder("{\"ok\":true,\"inputErrors\":[");
    sb.append(String.join(",", inputErrors)).append("],\"results\":[");
    if (inputErrors.isEmpty()) {
      List<String> parts = new ArrayList<>();
      for (Object e : exprs) {
        parts.add(evaluateOne(varSpecs, (String) e, activation, true));
      }
      sb.append(String.join(",", parts));
    }
    sb.append("],\"values\":[");
    if (inputErrors.isEmpty()) {
      List<String> parts = new ArrayList<>();
      for (Object e : values) {
        parts.add(e == null ? "null" : evaluateOne(varSpecs, (String) e, activation, false));
      }
      sb.append(String.join(",", parts));
    }
    return sb.append("]}").toString();
  }

  private static String inputError(String field, String error) {
    return "{\"field\":\"" + FormatUtils.escapeJson(field) + "\",\"error\":\"" + FormatUtils.escapeJson(error) + "\"}";
  }

  private static String evalFailure(String kind, String error) {
    return "{\"ok\":false,\"kind\":\"" + kind + "\",\"error\":\"" + FormatUtils.escapeJson(error) + "\"}";
  }

  private static String evaluateOne(String varSpecs, String expression, Map<String, Object> activation, boolean bool) {
    CelAbstractSyntaxTree ast;
    try {
      ast = ast(varSpecs, expression);
    } catch (CelValidationException e) {
      return evalFailure("compile", e.getMessage());
    }
    if (bool && !ast.getResultType().equals(SimpleType.BOOL)) {
      return evalFailure("type", "expression has type " + ast.getResultType() + ", not bool");
    }
    Object value;
    try {
      value = program(varSpecs, expression, ast).eval(activation);
    } catch (CelEvaluationException e) {
      return evalFailure("eval", describe(e));
    }
    if (bool) {
      if (!(value instanceof Boolean)) {
        return evalFailure("eval", "evaluated to a non-bool value: " + value);
      }
      return "{\"ok\":true,\"value\":" + value + "}";
    }
    try {
      StringBuilder sb = new StringBuilder("{\"ok\":true,\"value\":");
      toJson(value, sb);
      return sb.append('}').toString();
    } catch (IllegalArgumentException e) {
      return evalFailure("value", e.getMessage());
    }
  }

  /** The runtime's message, plus its cause when the message doesn't already say it. */
  private static String describe(CelEvaluationException e) {
    String message = e.getMessage() == null ? "" : e.getMessage();
    Throwable cause = e.getCause();
    if (cause != null && (cause.getMessage() == null || !message.contains(cause.getMessage()))) {
      message += " (" + cause + ")";
    }
    return message;
  }

  /** A CEL value as JSON: what an event's value can be. Optionals are their value, or null. */
  private static void toJson(Object v, StringBuilder sb) {
    if (v == null || v instanceof NullValue || v instanceof com.google.protobuf.NullValue) {
      sb.append("null");
    } else if (v instanceof Boolean || v instanceof Long || v instanceof UnsignedLong) {
      sb.append(v);
    } else if (v instanceof Double) {
      double d = (Double) v;
      if (Double.isNaN(d) || Double.isInfinite(d)) {
        throw new IllegalArgumentException(d + " has no JSON form");
      }
      sb.append(d);
    } else if (v instanceof String) {
      sb.append('"').append(FormatUtils.escapeJson((String) v)).append('"');
    } else if (v instanceof Optional) {
      toJson(((Optional<?>) v).orElse(null), sb);
    } else if (v instanceof List) {
      sb.append('[');
      boolean first = true;
      for (Object e : (List<?>) v) {
        if (!first) {
          sb.append(',');
        }
        first = false;
        toJson(e, sb);
      }
      sb.append(']');
    } else if (v instanceof Map) {
      sb.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
        if (!(e.getKey() instanceof String)) {
          throw new IllegalArgumentException("a map with " + e.getKey().getClass().getSimpleName() + " keys has no JSON form");
        }
        if (!first) {
          sb.append(',');
        }
        first = false;
        sb.append('"').append(FormatUtils.escapeJson((String) e.getKey())).append("\":");
        toJson(e.getValue(), sb);
      }
      sb.append('}');
    } else {
      throw new IllegalArgumentException("a " + v.getClass().getSimpleName() + " value has no JSON form");
    }
  }

  // ---- requests ----------------------------------------------------------------------------

  @SuppressWarnings("unchecked")
  private static Map<String, Object> asMap(Object o) {
    if (!(o instanceof Map)) {
      throw new IllegalArgumentException("expected a JSON object");
    }
    return (Map<String, Object>) o;
  }

  @SuppressWarnings("unchecked")
  private static List<Object> asList(Object o) {
    if (!(o instanceof List)) {
      throw new IllegalArgumentException("expected a JSON array");
    }
    return (List<Object>) o;
  }

  private static String string(Map<String, Object> m, String key) {
    Object v = m.get(key);
    if (!(v instanceof String)) {
      throw new IllegalArgumentException("expected string field " + key);
    }
    return (String) v;
  }

  private static double number(Map<String, Object> m, String key) {
    Object v = m.get(key);
    if (!(v instanceof Double)) {
      throw new IllegalArgumentException("expected number field " + key);
    }
    return (Double) v;
  }

  /** Just enough JSON to read requests: objects, arrays, strings, numbers (as double), bools, null. */
  static final class Json {
    private final String s;
    private int i;

    private Json(String s) {
      this.s = s;
    }

    static Object parse(String s) {
      Json p = new Json(s);
      Object v = p.value();
      p.space();
      if (p.i != s.length()) {
        throw p.error("trailing characters");
      }
      return v;
    }

    private IllegalArgumentException error(String what) {
      return new IllegalArgumentException("bad JSON request at " + i + ": " + what);
    }

    private void space() {
      while (i < s.length() && Character.isWhitespace(s.charAt(i))) {
        i++;
      }
    }

    private Object value() {
      space();
      if (i >= s.length()) {
        throw error("unexpected end");
      }
      char c = s.charAt(i);
      if (c == '{') {
        i++;
        Map<String, Object> m = new LinkedHashMap<>();
        space();
        if (i < s.length() && s.charAt(i) == '}') {
          i++;
          return m;
        }
        while (true) {
          space();
          String k = str();
          space();
          expect(':');
          m.put(k, value());
          space();
          if (i < s.length() && s.charAt(i) == ',') {
            i++;
            continue;
          }
          expect('}');
          return m;
        }
      }
      if (c == '[') {
        i++;
        List<Object> l = new ArrayList<>();
        space();
        if (i < s.length() && s.charAt(i) == ']') {
          i++;
          return l;
        }
        while (true) {
          l.add(value());
          space();
          if (i < s.length() && s.charAt(i) == ',') {
            i++;
            continue;
          }
          expect(']');
          return l;
        }
      }
      if (c == '"') {
        return str();
      }
      if (s.startsWith("true", i)) {
        i += 4;
        return Boolean.TRUE;
      }
      if (s.startsWith("false", i)) {
        i += 5;
        return Boolean.FALSE;
      }
      if (s.startsWith("null", i)) {
        i += 4;
        return null;
      }
      int start = i;
      while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) {
        i++;
      }
      if (start == i) {
        throw error("unexpected character");
      }
      return Double.parseDouble(s.substring(start, i));
    }

    private void expect(char c) {
      if (i >= s.length() || s.charAt(i) != c) {
        throw error("expected " + c);
      }
      i++;
    }

    private String str() {
      expect('"');
      StringBuilder sb = new StringBuilder();
      while (true) {
        if (i >= s.length()) {
          throw error("unterminated string");
        }
        char c = s.charAt(i++);
        if (c == '"') {
          return sb.toString();
        }
        if (c != '\\') {
          sb.append(c);
          continue;
        }
        if (i >= s.length()) {
          throw error("unterminated escape");
        }
        char e = s.charAt(i++);
        switch (e) {
          case 'n':
            sb.append('\n');
            break;
          case 't':
            sb.append('\t');
            break;
          case 'r':
            sb.append('\r');
            break;
          case 'b':
            sb.append('\b');
            break;
          case 'f':
            sb.append('\f');
            break;
          case 'u':
            if (i + 4 > s.length()) {
              throw error("short \\u escape");
            }
            sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
            i += 4;
            break;
          default:
            sb.append(e);
        }
      }
    }
  }
}
