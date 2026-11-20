// complier's workflow launcher: a Spotlight-style panel for the workflows saved on this computer.
//
// ⌃⌥Space (or opening the app) shows a floating search bar over whatever you're doing. Type to find
// a workflow in ~/.complier/workflows, or a demo in ~/.complier/examples, move with ↑/↓, and copy
// what you need to use it: ↩ copies the whole setup, ⌘1–⌘9 copy one command each. A demo with a
// launch.json also launches: ⌘↩ copies it to a fresh folder, runs its prepare commands (starting
// its machine) and opens one Terminal window per entry in `windows`. Esc or clicking elsewhere hides
// it. Saved workflows are never applied from here: that stays in Claude Code, which asks you first.

import AppKit
import Carbon.HIToolbox
import SwiftUI

// MARK: - Workflows on disk

struct Snippet: Identifiable {
    let id = UUID()
    let title: String
    let text: String
}

// A demo's launch.json.
struct Launch: Decodable {
    struct Window: Decodable { let title: String; let dir: String; let run: String }
    struct Step: Decodable { let title: String; let text: String }
    let description: String
    let workspace: String
    let prepare: [String]
    let windows: [Window]
    let setup: [Step]
    // Open the windows as panes of one tmux window, laid out by the spec's topology, if tmux is
    // installed (else as Terminal windows).
    var tmux: Bool? = nil
}

struct Workflow: Identifiable {
    var id: String { (launch == nil ? "workflow:" : "demo:") + name }
    let name: String
    let description: String
    let noticed: String
    let created: String
    let steps: [String]
    let sessions: Int
    let spec: String
    var launch: Launch? = nil
    var source: URL? = nil

    // What to copy to use it, in order. Applying happens inside Claude Code, which asks first.
    var setup: [Snippet] {
        if let launch { return launch.setup.map { Snippet(title: $0.title, text: $0.text) } }
        return [
            Snippet(title: "Start Claude Code with complier", text: "claude --plugin-dir ~/.complier/plugin"),
            Snippet(title: "Ask Claude to apply it", text: "Apply the complier workflow \(name) to this session."),
            Snippet(title: "Release it early, from your own terminal", text: "complier workflow release \(name)"),
        ]
    }
}

enum Store {
    static let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".complier")

    static func load() -> [Workflow] {
        saved() + demos()
    }

    // ~/.complier/examples/<name>/launch.json: demos that come with complier.
    static func demos() -> [Workflow] {
        let dir = home.appendingPathComponent("examples")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return names.sorted().compactMap { name in
            let folder = dir.appendingPathComponent(name)
            guard let data = try? Data(contentsOf: folder.appendingPathComponent("launch.json")),
                  let launch = try? JSONDecoder().decode(Launch.self, from: data) else { return nil }
            let spec = specText(folder)
            return Workflow(name: name, description: launch.description, noticed: "", created: "",
                            steps: actions(spec), sessions: 0, spec: spec, launch: launch, source: folder)
        }
    }

    static func saved() -> [Workflow] {
        let dir = home.appendingPathComponent("workflows")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        let bound = boundSessions()
        return names.sorted().compactMap { name in
            let folder = dir.appendingPathComponent(name)
            guard let toml = try? String(contentsOf: folder.appendingPathComponent("workflow.toml"), encoding: .utf8) else { return nil }
            let about = parseToml(toml)
            let spec = specText(folder)
            return Workflow(
                name: name,
                description: about["description"] ?? "",
                noticed: about["noticed"] ?? "",
                created: about["created"] ?? "",
                steps: actions(spec),
                sessions: bound[name, default: 0],
                spec: spec
            )
        }
    }

    // workflow.toml is flat `key = "value"` lines.
    static func parseToml(_ text: String) -> [String: String] {
        var out: [String: String] = [:]
        for line in text.split(separator: "\n") {
            guard let eq = line.firstIndex(of: "=") else { continue }
            let key = line[..<eq].trimmingCharacters(in: .whitespaces)
            var value = line[line.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 {
                value = String(value.dropFirst().dropLast())
                    .replacingOccurrences(of: "\\\"", with: "\"")
                    .replacingOccurrences(of: "\\\\", with: "\\")
            }
            out[key] = value
        }
        return out
    }

    static func specText(_ folder: URL) -> String {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        guard let csp = files.first(where: { $0.hasSuffix(".csp") }) else { return "" }
        return (try? String(contentsOf: folder.appendingPathComponent(csp), encoding: .utf8)) ?? ""
    }

    // The steps are the spec's actions: `datatype Act = edit | test | commit | other`.
    static func actions(_ spec: String) -> [String] {
        for line in spec.split(separator: "\n") {
            let t = line.trimmingCharacters(in: .whitespaces)
            guard t.hasPrefix("datatype Act"), let eq = t.firstIndex(of: "=") else { continue }
            return t[t.index(after: eq)...].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
        }
        return []
    }

    // ~/.complier/sessions/<id>.json records which workflow a Claude Code session follows.
    static func boundSessions() -> [String: Int] {
        let dir = home.appendingPathComponent("sessions")
        var out: [String: Int] = [:]
        for file in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] where file.hasSuffix(".json") {
            guard let data = try? Data(contentsOf: dir.appendingPathComponent(file)),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let name = json["workflow"] as? String else { continue }
            out[name, default: 0] += 1
        }
        return out
    }
}

// MARK: - Search

func matches(_ w: Workflow, _ query: String) -> Bool {
    let words = query.lowercased().split(separator: " ")
    let hay = [w.name, w.description, w.noticed, w.steps.joined(separator: " ")].joined(separator: " ").lowercased()
    return words.allSatisfy { hay.contains($0) }
}

// MARK: - A spec's topology

// Which roles lead and which form the team, read from the pattern library process a spec's policy is
// built with: the lead gets the big pane. Patterns with a lead put it in one argument and its team in
// another; following the spec's own definitions from those arguments says which roles each holds.
// Patterns that only sequence work (Pipeline, GeneratorCritic, Refinement) have no lead, so a policy
// built from them alone gives every agent an equal pane, and one wrapped around a lead pattern (a
// Pipeline whose stage is a FanOut) leaves the lead pattern to decide.
struct Topology: Equatable {
    var pattern: String?
    var lead: [String]
    var team: [String]

    static let leading = ["FanOut", "Dispatcher", "Delegate", "Hold", "Consult", "Guard"]

    static func of(_ spec: String) -> Topology {
        let roles = roleNames(spec)
        let defs = definitions(spec)
        // The definitions the policy reaches, nearest first.
        var reached: [String] = []
        var queue = ["Policy"]
        while !queue.isEmpty {
            let name = queue.removeFirst()
            guard !reached.contains(name), let body = defs[name] else { continue }
            reached.append(name)
            queue += identifiers(body).filter { defs[$0] != nil }
        }
        let all = rolesIn("Policy", roles, defs)
        for name in reached {
            guard let (pattern, args) = firstCall(in: defs[name]!, of: leading) else { continue }
            let arg = { (i: Int) in args.indices.contains(i) ? rolesIn(args[i], roles, defs) : [] }
            var lead: [String]
            var team: [String]
            switch pattern {
            case "FanOut":
                team = arg(0)
                lead = all.filter { !team.contains($0) }
            case "Dispatcher":
                lead = arg(0)
                team = arg(1)
            case "Consult":
                lead = arg(0)
                team = arg(2)
            default: // Delegate, Hold: (r, x, Sub, K); Guard: (r, x, Judge, K, P)
                lead = arg(0)
                team = arg(2)
            }
            team = team.filter { !lead.contains($0) }
            // Roles the pattern doesn't place are team members too.
            team += roles.filter { !lead.contains($0) && !team.contains($0) }
            return Topology(pattern: pattern, lead: roles.filter(lead.contains), team: roles.filter(team.contains))
        }
        return Topology(pattern: nil, lead: [], team: roles)
    }

    // `datatype Role = writer | reviewer`.
    static func roleNames(_ spec: String) -> [String] {
        for line in spec.split(separator: "\n") {
            let t = line.trimmingCharacters(in: .whitespaces)
            guard t.hasPrefix("datatype Role"), let eq = t.firstIndex(of: "=") else { continue }
            return t[t.index(after: eq)...].split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }
        }
        return []
    }

    // Each process the spec defines, by name, with every clause of it (`Specialist(a) = ...` and
    // `Specialist(b) = ...` are one), comments left out. A definition runs on over indented lines.
    static func definitions(_ spec: String) -> [String: String] {
        let head = try! NSRegularExpression(pattern: #"^([A-Za-z_][A-Za-z0-9_']*)\s*(\([^=]*\))?\s*=(?!=)(.*)$"#)
        let keywords = ["datatype", "channel", "assert", "include", "nametype", "subtype", "transparent", "external"]
        var defs: [String: String] = [:]
        var current: String?
        for raw in spec.split(separator: "\n", omittingEmptySubsequences: false) {
            var line = String(raw)
            if let c = line.range(of: "--") { line = String(line[..<c.lowerBound]) }
            if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
            if line.first!.isWhitespace {
                if let c = current { defs[c, default: ""] += " " + line }
                continue
            }
            current = nil
            if keywords.contains(where: { line.hasPrefix($0 + " ") }) { continue }
            let ns = line as NSString
            guard let m = head.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { continue }
            let name = ns.substring(with: m.range(at: 1))
            defs[name, default: ""] += " " + ns.substring(with: m.range(at: 3))
            current = name
        }
        return defs
    }

    static func identifiers(_ text: String) -> [String] {
        let re = try! NSRegularExpression(pattern: #"[A-Za-z_][A-Za-z0-9_']*"#)
        let ns = text as NSString
        return re.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
    }

    // The roles an expression mentions, directly or through the processes it uses, in order.
    static func rolesIn(_ expr: String, _ roles: [String], _ defs: [String: String]) -> [String] {
        var found: [String] = []
        var seen: Set<String> = []
        func walk(_ text: String) {
            for id in identifiers(text) {
                if roles.contains(id) { if !found.contains(id) { found.append(id) } }
                else if let body = defs[id], seen.insert(id).inserted { walk(body) }
            }
        }
        walk(expr)
        return found
    }

    // The first call in `text` to one of `names`, with its arguments split at the top level.
    static func firstCall(in text: String, of names: [String]) -> (String, [String])? {
        let chars = Array(text)
        var best: (Int, String)?
        for name in names {
            var from = text.startIndex
            while let r = text.range(of: name + "(", range: from..<text.endIndex) {
                let at = text.distance(from: text.startIndex, to: r.lowerBound)
                let before = at > 0 ? chars[at - 1] : " "
                if !(before.isLetter || before.isNumber || before == "_") {
                    if best == nil || at < best!.0 { best = (at, name) }
                    break
                }
                from = r.upperBound
            }
        }
        guard let (at, name) = best else { return nil }
        var args: [String] = []
        var depth = 0
        var arg = ""
        var i = at + name.count + 1
        while i < chars.count {
            let c = chars[i]
            let next = i + 1 < chars.count ? chars[i + 1] : " "
            if c == "-" && next == ">" { arg += "->"; i += 2; continue }
            if "(<{[".contains(c) { depth += 1 }
            if ")>}]".contains(c) {
                if depth == 0 { args.append(arg); return (name, args.map { $0.trimmingCharacters(in: .whitespaces) }) }
                depth -= 1
            }
            if c == "," && depth == 0 { args.append(arg); arg = "" } else { arg.append(c) }
            i += 1
        }
        return nil
    }
}

// MARK: - Launching a demo

struct LaunchError: Error { let message: String }

enum Launcher {
    static let demos = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("complier-demos")

    static func expand(_ path: String, demo: String) -> String {
        var p = path.replacingOccurrences(of: "$DEMO", with: demo)
        if p.hasPrefix("~/") { p = FileManager.default.homeDirectoryForCurrentUser.path + p.dropFirst(1) }
        return p
    }

    static func quote(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }

    // Copies the demo to a fresh folder, runs its prepare commands, then opens its windows.
    static func run(_ launch: Launch, from source: URL) -> Result<Int, LaunchError> {
        let fm = FileManager.default
        let demo = expand(launch.workspace, demo: "")
        // Only ever replace a folder under ~/complier-demos.
        guard URL(fileURLWithPath: demo).standardized.path.hasPrefix(demos.path + "/") else {
            return .failure(LaunchError(message: "its workspace must be under ~/complier-demos"))
        }
        do {
            try fm.createDirectory(at: demos, withIntermediateDirectories: true)
            if fm.fileExists(atPath: demo) { try fm.removeItem(atPath: demo) }
            try fm.copyItem(at: source, to: URL(fileURLWithPath: demo))
        } catch {
            return .failure(LaunchError(message: error.localizedDescription))
        }
        // In a login shell, so complier and claude are on PATH as in your terminal.
        let script = "set -e\nexport DEMO=\(quote(demo))\n" + launch.prepare.joined(separator: "\n")
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lic", script]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = out
        do { try p.run() } catch { return .failure(LaunchError(message: error.localizedDescription)) }
        p.waitUntilExit()
        if p.terminationStatus != 0 {
            let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
            let last = text.split(separator: "\n").last.map(String.init) ?? "exit \(p.terminationStatus)"
            return .failure(LaunchError(message: last))
        }
        // One .command file per window: Terminal opens each in a new window, in a login shell. All
        // are written before any opens, so a failure never leaves half a demo running.
        let dir = URL(fileURLWithPath: demo).appendingPathComponent(".launch")
        var files: [URL] = []
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            for (i, w) in launch.windows.enumerated() {
                let file = dir.appendingPathComponent("\(i + 1)-\(w.title.replacingOccurrences(of: " ", with: "-")).command")
                let body = """
                #!/bin/zsh -il
                export DEMO=\(quote(demo))
                printf '\\e]0;%s\\a' \(quote(w.title))
                cd \(quote(expand(w.dir, demo: demo)))
                \(w.run)

                """
                try body.write(to: file, atomically: false, encoding: .utf8)
                try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: file.path)
                files.append(file)
            }
        } catch {
            return .failure(LaunchError(message: error.localizedDescription))
        }
        if launch.tmux == true, hasTmux() {
            let panes = zip(launch.windows, files).map { w, file in Pane(title: w.title, file: file.path, role: role(of: w.run)) }
            let name = URL(fileURLWithPath: demo).lastPathComponent
            let script = dir.appendingPathComponent("panes.command")
            do {
                try Panes.script(session: "complier-\(name)", panes: panes, topology: Topology.of(Store.specText(source)), size: terminalSize())
                    .write(to: script, atomically: false, encoding: .utf8)
                try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
            } catch {
                return .failure(LaunchError(message: error.localizedDescription))
            }
            files = [script]
        }
        for file in files {
            let open = Process()
            open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            open.arguments = ["-a", "Terminal", file.path]
            try? open.run()
            open.waitUntilExit()
        }
        return .success(files.count)
    }

    // The role an agent's window runs as: its COMPLIER_ROLE.
    static func role(of run: String) -> String? {
        guard let r = run.range(of: #"COMPLIER_ROLE=([A-Za-z0-9_]+)"#, options: .regularExpression) else { return nil }
        return String(run[r].dropFirst("COMPLIER_ROLE=".count))
    }

    static func hasTmux() -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/zsh")
        p.arguments = ["-lc", "command -v tmux >/dev/null"]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return false }
        p.waitUntilExit()
        return p.terminationStatus == 0
    }

    // Terminal's window, sized to most of the screen, in rows and columns of its default font.
    static func terminalSize() -> (rows: Int, cols: Int) {
        let f = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 860)
        return (rows: max(24, Int((f.height - 60) / 14.5)), cols: max(80, Int((f.width - 20) / 7.2)))
    }
}

// MARK: - Panes in tmux

struct Pane { let title: String; let file: String; let role: String? }

// One tmux window holding a demo's windows as panes. With a lead (the spec's topology says who), the
// lead's pane takes the left side, with the panes that aren't agents (the machine's log) in a strip
// under it, and the team shares the right side in equal panes. Without one, the agents sit side by
// side in equal columns over that strip. The script runs in the Terminal window it lays out, so tmux
// sizes the panes to that window.
enum Panes {
    static func script(session: String, panes: [Pane], topology: Topology, size: (rows: Int, cols: Int)) -> String {
        let q = Launcher.quote
        let lead = topology.lead.compactMap { r in panes.first { $0.role == r } }
        let agents = panes.filter { $0.role != nil && !lead.map(\.file).contains($0.file) }
        let side = panes.filter { $0.role == nil }
        var out = [
            "#!/bin/zsh -il",
            "# The demo's windows as panes of tmux session \(session), laid out by its spec's topology (\(topology.pattern ?? "no lead pattern")).",
            "printf '\\e[3;0;0t\\e[8;\(size.rows);\(size.cols)t'",
            "sleep 0.3",
            "S=\(q(session))",
            "tmux kill-session -t \"$S\" 2>/dev/null",
        ]
        var first = true
        // Splits `target` for `pane`, giving the new pane `percent` of it; the first pane starts the session.
        func open(_ pane: Pane, as id: String, split target: String = "", _ flags: String = "", percent: Int = 50) {
            if first {
                out.append("\(id)=$(tmux new-session -d -s \"$S\" -x \"$(tput cols)\" -y \"$(tput lines)\" -P -F '#{pane_id}' \(q(pane.file)))")
                first = false
            } else {
                out.append("\(id)=$(tmux split-window \(flags) -t \"$\(target)\" -l \(percent)% -P -F '#{pane_id}' \(q(pane.file)))")
            }
            out.append("tmux select-pane -t \"$\(id)\" -T \(q(pane.title))")
        }
        // `column` panes stacked in `target`'s place (already the first of them), equally.
        func stack(_ column: [Pane], from id: String, _ flags: String, prefix: String) {
            var last = id
            for (i, pane) in column.enumerated().dropFirst() {
                let rest = column.count - i
                let name = "\(prefix)\(i)"
                open(pane, as: name, split: last, flags, percent: 100 * rest / (rest + 1))
                last = name
            }
        }
        if let main = lead.first {
            open(main, as: "L0")
            if let t = agents.first { open(t, as: "T0", split: "L0", "-h", percent: 45) }
            stack(agents, from: "T0", "-v", prefix: "T")
            stack(lead, from: "L0", "-v", prefix: "L")
            if let s = side.first { open(s, as: "S0", split: "L\(lead.count - 1)", "-v", percent: 28) }
            stack(side, from: "S0", "-h", prefix: "S")
            out.append("tmux select-pane -t \"$L0\"")
        } else {
            let row = agents.isEmpty ? side : agents
            if let a = row.first { open(a, as: "A0") }
            stack(row, from: "A0", "-h", prefix: "A")
            if !agents.isEmpty, let s = side.first { open(s, as: "S0", split: "A0", "-v -f", percent: 28) }
            if !agents.isEmpty { stack(side, from: "S0", "-h", prefix: "S") }
            out.append("tmux select-pane -t \"$A0\"")
        }
        out += [
            "tmux set -t \"$S\" pane-border-status top",
            "tmux set -t \"$S\" pane-border-format ' #{pane_title} '",
            "tmux set -t \"$S\" -w allow-set-title off",
            "tmux set -t \"$S\" -w remain-on-exit on",
            "tmux set -t \"$S\" mouse on",
            "exec tmux attach -t \"$S\"",
            "",
        ]
        return out.joined(separator: "\n")
    }
}

// MARK: - The panel's view

final class Model: ObservableObject {
    @Published var query = ""
    @Published var all: [Workflow] = []
    @Published var selected = 0
    @Published var copied: String?

    var results: [Workflow] { query.isEmpty ? all : all.filter { matches($0, query) } }
    var current: Workflow? { results.indices.contains(selected) ? results[selected] : nil }

    func reload() {
        all = Store.load()
        selected = 0
    }

    func move(_ by: Int) {
        guard !results.isEmpty else { return }
        selected = (selected + by + results.count) % results.count
    }

    func copy(_ text: String, label: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        copied = label
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
            if self?.copied == label { self?.copied = nil }
        }
    }

    func copyAll() {
        guard let w = current else { return }
        let text = w.setup.map { "# \($0.title)\n\($0.text)" }.joined(separator: "\n\n")
        copy(text, label: "Copied the setup for \(w.name)")
    }

    func launch() {
        guard let w = current, let launch = w.launch, let source = w.source else { return }
        copied = "Starting \(w.name)…"
        DispatchQueue.global().async {
            let result = Launcher.run(launch, from: source)
            DispatchQueue.main.async {
                switch result {
                case .success(let n): self.copied = "Launched \(w.name): \(n) terminal\(n == 1 ? "" : "s")"
                case .failure(let e): self.copied = "Couldn't launch \(w.name): \(e.message)"
                }
                let shown = self.copied
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) { if self.copied == shown { self.copied = nil } }
            }
        }
    }

    func copyOne(_ i: Int) {
        guard let w = current, w.setup.indices.contains(i) else { return }
        copy(w.setup[i].text, label: "Copied: \(w.setup[i].title)")
    }
}

struct LauncherView: View {
    @ObservedObject var model: Model
    var close: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 20, weight: .medium)).foregroundStyle(.secondary)
                TextField("Search workflows", text: $model.query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 22, weight: .regular))
                    .focused($focused)
                    .onKeyPress(keys: [.return], phases: .down) { press in
                        guard press.modifiers.contains(.command) else { return .ignored }
                        model.launch()
                        return .handled
                    }
                    .onSubmit { model.copyAll() }
                    .onChange(of: model.query) { model.selected = 0 }
                    .onKeyPress(.upArrow) { model.move(-1); return .handled }
                    .onKeyPress(.downArrow) { model.move(1); return .handled }
                    .onKeyPress(.escape) { close(); return .handled }
                    .onKeyPress(characters: .decimalDigits, phases: .down) { press in
                        guard press.modifiers.contains(.command), let n = Int(press.characters), n >= 1 else { return .ignored }
                        model.copyOne(n - 1)
                        return .handled
                    }
            }
            .padding(.horizontal, 18)
            .frame(height: 58)

            Divider()

            if model.results.isEmpty {
                Text(model.all.isEmpty ? "No saved workflows yet. Claude Code offers to save one when your work looks repeatable." : "No workflow matches “\(model.query)”.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding()
            } else {
                HStack(alignment: .top, spacing: 0) {
                    list.frame(width: 250)
                    Divider()
                    if let w = model.current { detail(w) }
                }
                .frame(height: 340)
            }

            Divider()
            footer
        }
        .frame(width: AppDelegate.size.width, height: AppDelegate.size.height, alignment: .top)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.12)))
        .onAppear { focused = true }
    }

    var list: some View {
        ScrollView {
            VStack(spacing: 2) {
                ForEach(Array(model.results.enumerated()), id: \.element.id) { i, w in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(w.name).font(.system(size: 14, weight: .semibold))
                            if w.launch != nil {
                                Text("demo").font(.system(size: 10, weight: .semibold)).padding(.horizontal, 5).padding(.vertical, 1)
                                    .background((i == model.selected ? Color.white : Color.accentColor).opacity(0.25), in: Capsule())
                            }
                        }
                        Text(w.description).font(.system(size: 12)).foregroundStyle(i == model.selected ? .white.opacity(0.85) : .secondary).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .foregroundStyle(i == model.selected ? .white : .primary)
                    .background(i == model.selected ? Color.accentColor : .clear, in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                    .onTapGesture { model.selected = i }
                }
            }
            .padding(8)
        }
    }

    func detail(_ w: Workflow) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(w.name).font(.system(size: 18, weight: .bold))
                    Text(w.description).foregroundStyle(.secondary)
                    if !w.noticed.isEmpty {
                        Text("Saved from: “\(w.noticed)”").font(.system(size: 11)).foregroundStyle(.tertiary)
                    }
                }
                HStack(spacing: 6) {
                    ForEach(w.steps, id: \.self) { s in
                        Text(s).font(.system(size: 11, weight: .medium, design: .monospaced))
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(.quaternary, in: Capsule())
                    }
                    Spacer()
                    if w.launch == nil {
                        Text(w.sessions > 0 ? "applied to \(w.sessions) session\(w.sessions == 1 ? "" : "s")" : "not applied")
                            .font(.system(size: 11)).foregroundStyle(w.sessions > 0 ? .green : .secondary)
                    }
                }
                if let launch = w.launch {
                    Button(action: { model.launch() }) {
                        HStack {
                            Image(systemName: "play.fill")
                            Text("Launch: opens \(launch.windows.map(\.title).joined(separator: ", "))")
                            Spacer()
                            Keys(caps: [.symbol("command"), .symbol("return")], onAccent: true)
                        }
                        .font(.system(size: 12.5, weight: .semibold))
                        .padding(10)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(.white)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
                ForEach(Array(w.setup.enumerated()), id: \.element.id) { i, s in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(s.title).font(.system(size: 12, weight: .semibold))
                            Spacer()
                            Keys(caps: [.symbol("command"), .text("\(i + 1)")])
                        }
                        Text(s.text)
                            .font(.system(size: 12.5, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(9)
                            .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 7))
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { model.copyOne(i) }
                }
            }
            .padding(16)
        }
    }

    var footer: some View {
        HStack(spacing: 14) {
            if let c = model.copied {
                Label(c, systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            } else {
                if model.current?.launch != nil { Hint(caps: [.symbol("command"), .symbol("return")], label: "launch") }
                Hint(caps: [.symbol("return")], label: "copy setup")
                Hint(caps: [.symbol("command"), .text("1–\(max(1, model.current?.setup.count ?? 3))")], label: "copy one")
                Hint(caps: [.symbol("arrow.up"), .symbol("arrow.down")], label: "choose")
                Hint(caps: [.text("esc")], label: "close")
            }
            Spacer()
            Text("complier").foregroundStyle(.tertiary)
        }
        .font(.system(size: 11.5))
        .padding(.horizontal, 16)
        .frame(height: 36)
    }
}

// MARK: - Keycaps

enum Cap: Hashable {
    case symbol(String)
    case text(String)
}

// Keys drawn as small rounded keycaps, with SF Symbols for ⌘, return, the arrows and escape.
struct Keys: View {
    let caps: [Cap]
    var onAccent = false

    var body: some View {
        HStack(spacing: 3) {
            ForEach(caps, id: \.self) { cap in
                Group {
                    switch cap {
                    case .symbol(let name): Image(systemName: name).font(.system(size: 9.5, weight: .semibold))
                    case .text(let t): Text(t).font(.system(size: 10.5, weight: .semibold, design: .rounded))
                    }
                }
                .frame(minWidth: 18, minHeight: 18)
                .padding(.horizontal, 3)
                .foregroundStyle(onAccent ? Color.white : Color.primary.opacity(0.75))
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(onAccent ? Color.white.opacity(0.22) : Color.primary.opacity(0.08))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(onAccent ? Color.white.opacity(0.3) : Color.primary.opacity(0.14), lineWidth: 0.5)
                )
            }
        }
    }
}

struct Hint: View {
    let caps: [Cap]
    let label: String

    var body: some View {
        HStack(spacing: 5) {
            Keys(caps: caps)
            Text(label).foregroundStyle(.secondary)
        }
    }
}

// MARK: - The floating panel

final class Panel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    static let size = NSSize(width: 760, height: 436)
    let model = Model()
    var panel: Panel!
    var status: NSStatusItem!
    var hotKey: EventHotKeyRef?

    func applicationDidFinishLaunching(_ note: Notification) {
        panel = Panel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.delegate = self
        let host = NSHostingView(rootView: LauncherView(model: model, close: { [weak self] in self?.hide() }))
        panel.contentView = host
        panel.setContentSize(AppDelegate.size)

        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.image = NSImage(systemSymbolName: "checklist", accessibilityDescription: "complier workflows")
        let menu = NSMenu()
        menu.addItem(withTitle: "Show workflows  ⌃⌥Space", action: #selector(show), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        status.menu = menu

        registerHotKey()
        show()
    }

    // Opening the app again (from Finder or `open`) shows the panel.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        show()
        return false
    }

    @objc func show() {
        model.reload()
        model.query = ""
        if let screen = NSScreen.main {
            let f = screen.visibleFrame
            let size = panel.frame.size
            panel.setFrameOrigin(NSPoint(x: f.midX - size.width / 2, y: f.maxY - size.height - f.height * 0.18))
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func hide() {
        panel.orderOut(nil)
    }

    func toggle() {
        panel.isVisible ? hide() : show()
    }

    // Clicking anywhere else hides it, as Spotlight does.
    func windowDidResignKey(_ notification: Notification) {
        hide()
    }

    func registerHotKey() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, data in
            let me = Unmanaged<AppDelegate>.fromOpaque(data!).takeUnretainedValue()
            DispatchQueue.main.async { me.toggle() }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
        let id = EventHotKeyID(signature: OSType(0x636D706C), id: 1) // 'cmpl'
        RegisterEventHotKey(UInt32(kVK_Space), UInt32(controlKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKey)
    }
}

// `ComplierWorkflows --topology <spec.csp>` prints who leads in a spec, for checking the layout.
if let i = CommandLine.arguments.firstIndex(of: "--topology"), CommandLine.arguments.count > i + 1 {
    let spec = (try? String(contentsOfFile: CommandLine.arguments[i + 1], encoding: .utf8)) ?? ""
    let t = Topology.of(spec)
    print("\(t.pattern ?? "-")\tlead: \(t.lead.joined(separator: " "))\tteam: \(t.team.joined(separator: " "))")
    exit(0)
}

// `ComplierWorkflows --panes <demo> <dir>` prints the tmux script a launch would write, its panes
// running <dir>/<n>-<title>.command, for checking the layout.
if let i = CommandLine.arguments.firstIndex(of: "--panes"), CommandLine.arguments.count > i + 2 {
    let name = CommandLine.arguments[i + 1]
    let dir = CommandLine.arguments[i + 2]
    guard let demo = Store.demos().first(where: { $0.name == name }), let launch = demo.launch, let source = demo.source else { exit(1) }
    let panes = launch.windows.enumerated().map { n, w in
        Pane(title: w.title, file: "\(dir)/\(n + 1)-\(w.title.replacingOccurrences(of: " ", with: "-")).command", role: Launcher.role(of: w.run))
    }
    print(Panes.script(session: "complier-\(name)", panes: panes, topology: Topology.of(Store.specText(source)), size: Launcher.terminalSize()))
    exit(0)
}

// `ComplierWorkflows --launch <demo>` launches a demo without the panel, for testing and scripts.
if let i = CommandLine.arguments.firstIndex(of: "--launch"), CommandLine.arguments.count > i + 1 {
    let name = CommandLine.arguments[i + 1]
    guard let demo = Store.demos().first(where: { $0.name == name }), let launch = demo.launch, let source = demo.source else {
        FileHandle.standardError.write("no demo named \(name) in ~/.complier/examples\n".data(using: .utf8)!)
        exit(1)
    }
    switch Launcher.run(launch, from: source) {
    case .success(let n): print("launched \(name): \(n) terminal(s)"); exit(0)
    case .failure(let e): FileHandle.standardError.write("couldn't launch \(name): \(e.message)\n".data(using: .utf8)!); exit(1)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
