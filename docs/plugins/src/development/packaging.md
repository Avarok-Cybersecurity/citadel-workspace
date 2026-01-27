# Plugin Packaging Formats

Citadel supports two plugin packaging formats to accommodate different development and distribution models.

## TypeScript Package (Open Source)

TypeScript packages allow community inspection, contribution, and trust through transparency.

```
my-plugin/
├── package.json              # npm package metadata
├── citadel.manifest.json     # Citadel-specific metadata & capabilities
├── dist/
│   ├── index.js              # Bundled plugin code (ES modules)
│   ├── index.js.map          # Source maps for debugging
│   ├── index.d.ts            # TypeScript type definitions
│   └── styles.css            # Optional plugin styles
├── src/
│   ├── index.ts              # Entry point (exports CitadelWorkspacePlugin)
│   ├── components/           # React components
│   └── utils/                # Helper utilities
├── tests/
│   └── plugin.test.ts        # Plugin tests
├── README.md                 # Documentation
├── CHANGELOG.md              # Version history
└── LICENSE                   # License file
```

**citadel.manifest.json:**
```json
{
  "$schema": "https://citadel.dev/schemas/plugin-manifest.json",
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "A sample Citadel workspace plugin",
  "publisher": {
    "id": "example",
    "name": "Example Corp"
  },
  "category": "ui",
  "tags": ["widget", "dashboard", "example"],
  "license": "MIT",
  "citadelVersion": ">=1.0.0",
  "capabilities": [
    { "type": "ui:components", "scope": { "component_names": ["MyWidget"] } },
    { "type": "signals:subscribe", "scope": { "patterns": ["workspace.*"] } }
  ],
  "capabilityJustifications": {
    "ui:components": "Register the MyWidget component for use in MDX",
    "signals:subscribe": "Listen to workspace events for real-time updates"
  },
  "artifacts": {
    "frontend": {
      "bundle": "./dist/index.js",
      "types": "./dist/index.d.ts",
      "styles": "./dist/styles.css"
    }
  }
}
```

## WASM Binary (Closed Source)

WASM packages allow proprietary distribution while maintaining security through sandboxing.

```
my-plugin/
├── citadel.manifest.json     # Citadel-specific metadata & capabilities
├── plugin.wasm               # Compiled WASM binary
├── frontend/                 # Optional frontend bundle (if plugin has UI)
│   ├── bundle.js             # UI components
│   ├── bundle.js.map         # Source maps
│   └── styles.css            # Styles
├── README.md                 # Documentation
├── CHANGELOG.md              # Version history
└── LICENSE                   # License file (may be proprietary)
```

**Build process for Rust → WASM:**
```bash
# Install wasm-pack
cargo install wasm-pack

# Build the plugin
wasm-pack build --target web --release

# Output structure:
# pkg/
#   ├── plugin.wasm
#   ├── plugin.js        # JS bindings
#   └── plugin.d.ts      # TypeScript types
```

## Manifest Comparison

| Field | TypeScript | WASM | Notes |
|-------|------------|------|-------|
| `packageType` | `"typescript"` | `"wasm"` | Required |
| `artifacts.frontend.bundle` | JS file path | JS file path | Optional for backend-only |
| `artifacts.backend.bundle` | N/A | WASM file path | Required for backend plugins |
| `repository` | Often provided | Often omitted | Open source indicator |
| Source inspection | Full source available | Binary only | Trust model differs |
