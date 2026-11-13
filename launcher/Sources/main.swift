// complier's workflow launcher: a Spotlight-style panel for the workflows saved on this computer.
//
// ⌃⌥Space (or opening the app) shows a floating search bar over whatever you're doing. Type to find
// a workflow in ~/.complier/workflows, move with ↑/↓, and copy what you need to use it: ↩ copies
// the whole setup, ⌘1–⌘9 copy one command each. Esc or clicking elsewhere hides it. It only reads:
// applying a workflow stays in Claude Code, which asks you first.

import AppKit
import Carbon.HIToolbox
import SwiftUI

// MARK: - Workflows on disk

struct Snippet: Identifiable {
    let id = UUID()
    let title: String
    let text: String
}

struct Workflow: Identifiable {
    var id: String { name }
    let name: String
    let description: String
    let noticed: String
    let created: String
    let steps: [String]
    let sessions: Int
    let spec: String

    // What to copy to use it, in order. Applying happens inside Claude Code, which asks first.
    var setup: [Snippet] {
        [
            Snippet(title: "Start Claude Code with complier", text: "claude --plugin-dir ~/.complier/plugin"),
            Snippet(title: "Ask Claude to apply it", text: "Apply the complier workflow \(name) to this session."),
            Snippet(title: "Release it early, from your own terminal", text: "complier workflow release \(name)"),
        ]
    }
}

enum Store {
    static let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".complier")

    static func load() -> [Workflow] {
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
                        Text(w.name).font(.system(size: 14, weight: .semibold))
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
                    Text(w.sessions > 0 ? "applied to \(w.sessions) session\(w.sessions == 1 ? "" : "s")" : "not applied")
                        .font(.system(size: 11)).foregroundStyle(w.sessions > 0 ? .green : .secondary)
                }
                ForEach(Array(w.setup.enumerated()), id: \.element.id) { i, s in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(s.title).font(.system(size: 12, weight: .semibold))
                            Spacer()
                            Text("⌘\(i + 1)").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
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
                Text("↩ copy setup").foregroundStyle(.secondary)
                Text("⌘1–⌘3 copy one").foregroundStyle(.secondary)
                Text("↑↓ choose").foregroundStyle(.secondary)
                Text("esc close").foregroundStyle(.secondary)
            }
            Spacer()
            Text("complier").foregroundStyle(.tertiary)
        }
        .font(.system(size: 11.5))
        .padding(.horizontal, 16)
        .frame(height: 32)
    }
}

// MARK: - The floating panel

final class Panel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    static let size = NSSize(width: 760, height: 432)
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

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
