import com.sun.source.util.JavacTask;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaFileObject;
import javax.tools.ToolProvider;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/** Parse-only smoke check. Does NOT resolve Android APIs or replace Gradle compilation. */
public final class JavaSyntaxCheck {
    public static void main(String[] args) throws Exception {
        var compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("Run with a JDK, not a JRE");
        var diagnostics = new DiagnosticCollector<JavaFileObject>();
        try (var manager = compiler.getStandardFileManager(diagnostics, null, java.nio.charset.StandardCharsets.UTF_8);
             var paths = Files.walk(Path.of(args.length == 0 ? "apps/mobile/app/src" : args[0]))) {
            var sources = paths.filter(p -> p.toString().endsWith(".java")).toList();
            var files = manager.getJavaFileObjectsFromPaths(sources);
            var task = (JavacTask) compiler.getTask(null, manager, diagnostics, List.of("--release", "17", "-proc:none"), null, files);
            task.parse();
            for (var diagnostic : diagnostics.getDiagnostics())
                if (diagnostic.getKind() == Diagnostic.Kind.ERROR) throw new AssertionError(diagnostic.toString());
            System.out.println("Java parse-only: " + sources.size() + " sources PASS; no Android typecheck performed");
        }
    }
}