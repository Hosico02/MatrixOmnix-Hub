# Declarative archetype registration

Adding support for a new project archetype no longer requires editing
TypeScript source. Drop a JSON file into one of two directories and the
detector picks it up at runtime:

| Location | Scope | When to use |
|---|---|---|
| `config/archetypes/*.json` | ships with the tool, applies to every project | new generally-useful archetype (a new web framework, language, etc.) |
| `<project>/.demo2project/archetypes/*.json` | per-project, overrides repo-shipped ids | one project that needs a custom detector |

## Schema

```json
{
  "id": "rust-axum",
  "name": "Rust axum web server",
  "description": "Rust HTTP server using axum or warp",
  "recommended_standard": "generic-project",
  "applicable_qa_patterns": ["verification_failure/build_failed"],
  "risk_profile": "high",
  "threshold": 0.35,
  "signals": [
    { "type": "file_exists", "path": "Cargo.toml",     "weight": 3, "label": "Cargo.toml" },
    { "type": "cargo_dep",   "dep": "axum",            "weight": 4, "label": "dep:axum" },
    { "type": "lang_equals", "value": "rust",          "weight": 2, "label": "lang:rust" }
  ]
}
```

| Field | Required | What it is |
|---|---|---|
| `id` | yes | Unique slug. If it matches a built-in id (e.g. `flask-web-app`), the JSON wins. |
| `name` | yes | Human-readable label. |
| `recommended_standard` | yes | Name of the standard the executor should apply. Falls back to `generic-project`. |
| `applicable_qa_patterns` | yes | QA case categories that apply to this archetype. May be `[]`. |
| `risk_profile` | yes | `low` / `medium` / `high`. |
| `threshold` | optional | Confidence threshold below which the project is classified as `unknown`. Default `0.35`. |
| `signals` | yes | List of signal entries (see below). Detector sums weights of hits and divides by total possible weight to compute confidence. |

## Signal types

| Type | Args | Hits when |
|---|---|---|
| `file_exists` | `path` | exact relative path present |
| `dir_exists` | `path` | exact path is a directory OR any file under it |
| `file_glob` | `pattern` | any file matches simple glob (`*`, `**`) |
| `pkg_dep` | `dep` | dep name in `package.json` deps OR devDeps |
| `pkg_field` | `field`, `equals?` | `pkg.<field>` non-empty (or equals value) |
| `pkg_script_matches` | `pattern` (regex) | any script body matches |
| `pyproject_contains` | `pattern` (regex) | regex matches in `pyproject.toml` |
| `cargo_dep` | `dep` | dep listed in `Cargo.toml` `[dependencies]` |
| `go_mod_contains` | `pattern` (regex) | regex matches in `go.mod` |
| `gemfile_contains` | `pattern` (regex) | regex matches in `Gemfile` |
| `lang_equals` | `value` | `snapshot.detected_language === value` |
| `framework_detected` | `name` | `snapshot.detected_frameworks` includes name |
| `start_command_matches` | `pattern` (regex) | any start command matches |

Every signal also accepts `"negate": true` to invert the result — useful
for "no react dep" style penalties.

## How scoring works

Each signal contributes its `weight` if `hit === true`. Total possible
weight is the sum of `max(0, weight)` across all signals. Confidence is
`raw / max`. The archetype with the highest confidence wins; if no
archetype exceeds its threshold, the project is classified as
`unknown` and falls back to `generic-project`.

## Shipped archetypes (built-in JSON)

| Id | Detects | File |
|---|---|---|
| `rust-axum` | Rust HTTP server (axum / warp / actix-web) | `config/archetypes/rust-axum.json` |
| `go-web` | Go HTTP server (gin / echo / fiber / chi) | `config/archetypes/go-web.json` |
| `rails-app` | Ruby on Rails web app | `config/archetypes/rails-app.json` |
| `spring-boot` | Java/Kotlin Spring Boot app | `config/archetypes/spring-boot.json` |

Plus 13 built-in TypeScript probes (React, Vue, Next, Flask, FastAPI,
Node CLI, Python CLI/package, TypeScript library, monorepo,
docs-only, agent framework) defined in
`src/core/projectArchetypeDetector.ts` for backwards compatibility.

## Per-project override example

To override the built-in `flask-web-app` detector for one repo:

```bash
mkdir -p .demo2project/archetypes
cat > .demo2project/archetypes/flask-web-app.json <<'EOF'
{
  "id": "flask-web-app",
  "name": "Custom Flask app",
  "recommended_standard": "my-flask-standard",
  "applicable_qa_patterns": [],
  "risk_profile": "low",
  "threshold": 0.5,
  "signals": [
    { "type": "framework_detected", "name": "flask", "weight": 4, "label": "flask" },
    { "type": "file_exists", "path": "my_marker.txt", "weight": 6, "label": "internal marker" }
  ]
}
EOF
```

The per-project file overrides the built-in TS probe for `flask-web-app`
in this repo only — every other project still uses the built-in.

## Limitations

- `file_content_matches` is currently a no-op (cheap by design — the
  detector doesn't read file contents on demand). Use
  `pyproject_contains` / `cargo_dep` / `go_mod_contains` /
  `gemfile_contains` instead for content-based signals.
- The detector does not (yet) merge weights across multiple JSON files
  for the same id — last-loaded wins. Don't ship overlapping repo-level
  and project-level definitions unless you mean the project one to fully
  replace the repo one.
- The archetype detector is invoked separately from `analyze` and `gap`
  CLI output today (those commands don't include archetype info in
  their JSON). Use `detectArchetype(projectPath)` from the SDK if you
  need the archetype programmatically.
