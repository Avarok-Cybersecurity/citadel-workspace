# Plugin Marketplace

## Marketplace Metadata Schema

Every plugin submitted to the marketplace must include comprehensive metadata for discovery, categorization, and security review.

```typescript
interface MarketplaceMetadata {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════
  id: string;                     // Unique ID (e.g., "com.company.plugin-name")
  name: string;                   // Human-readable display name
  version: string;                // SemVer version (e.g., "2.1.0")

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLISHER INFO
  // ═══════════════════════════════════════════════════════════════════════════
  publisher: {
    id: string;                   // Publisher unique ID
    name: string;                 // Publisher display name
    verified: boolean;            // Has passed verification process
    website?: string;             // Publisher website URL
    support_email?: string;       // Support contact
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // DESCRIPTION
  // ═══════════════════════════════════════════════════════════════════════════
  description: string;            // Short description (max 200 chars)
  longDescription?: string;       // Full description (Markdown supported)
  changelog?: string;             // Version changelog (Markdown)

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIZATION
  // ═══════════════════════════════════════════════════════════════════════════
  category: PluginCategory;       // Primary category
  tags: string[];                 // Searchable tags (max 10)
  license: string;                // SPDX license identifier (e.g., "MIT", "proprietary")

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSETS
  // ═══════════════════════════════════════════════════════════════════════════
  icon: string;                   // URL to icon (256x256 PNG)
  banner?: string;                // URL to banner image (1200x400)
  screenshots?: string[];         // URLs to screenshots (max 5)
  documentation?: string;         // URL to documentation
  repository?: string;            // URL to source code (for open source)

  // ═══════════════════════════════════════════════════════════════════════════
  // PACKAGE TYPE & ARTIFACTS
  // ═══════════════════════════════════════════════════════════════════════════
  packageType: "typescript" | "wasm";

  artifacts: {
    frontend?: {
      bundle: string;             // URL to JS bundle
      types?: string;             // URL to .d.ts type definitions
      styles?: string;            // URL to CSS bundle
      integrity?: string;         // SRI hash for bundle verification
    };
    backend?: {
      bundle: string;             // URL to WASM binary
      runtime: "wasm";
      integrity?: string;         // SRI hash for WASM verification
    };
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // REQUIREMENTS & CAPABILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  capabilities: ScopedCapability[];
  capabilityJustifications?: Record<string, string>;  // Why each capability is needed
  dependencies?: PluginDependency[];
  citadelVersion: string;         // Minimum Citadel version required

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKETPLACE STATS (populated by marketplace, not plugin author)
  // ═══════════════════════════════════════════════════════════════════════════
  stats?: {
    downloads: number;
    weeklyDownloads: number;
    rating: number;               // 1-5 stars
    reviewCount: number;
    firstPublished: string;       // ISO date
    lastUpdated: string;          // ISO date
  };
}

type PluginCategory =
  | "ide"               // Code editors, compilers, debuggers
  | "infrastructure"    // Server monitoring, DevOps tools
  | "workflow"          // Automation, bots, schedulers
  | "integration"       // Third-party service connectors
  | "ui"                // Themes, widgets, dashboards
  | "communication"     // Chat enhancements, notifications
  | "project"           // Project management, kanban, sprints
  | "security"          // Auth, audit, compliance
  | "analytics"         // Metrics, reporting, visualization
  | "other";            // Miscellaneous

interface PluginDependency {
  pluginId: string;               // Required plugin ID
  version: string;                // SemVer range (e.g., "^2.0.0")
  optional?: boolean;             // If true, enhances functionality but not required
}
```

## Marketplace Categories

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PLUGIN MARKETPLACE CATEGORIES                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  IDE                         │  Code editors, syntax highlighting, compilers,│
│                              │  debuggers, language servers, formatters      │
│                                                                             │
│  Infrastructure              │  Server monitoring, SSH connectors, metrics,  │
│                              │  alerts, on-call management, dashboards       │
│                                                                             │
│  Workflow                    │  Automation bots, scheduled tasks, approval   │
│                              │  flows, incident routing, notifications       │
│                                                                             │
│  Integration                 │  GitHub, GitLab, Jira, Slack, AWS, GCP,       │
│                              │  database connectors, API bridges             │
│                                                                             │
│  UI                          │  Themes, custom widgets, dashboard panels,    │
│                              │  MDX components, layout extensions            │
│                                                                             │
│  Communication               │  Chat enhancements, message formatting,       │
│                              │  translation, voice/video extensions          │
│                                                                             │
│  Project                     │  Kanban boards, sprint planning, time         │
│                              │  tracking, resource allocation, reports       │
│                                                                             │
│  Security                    │  SSO integrations, audit logging, compliance, │
│                              │  encryption, access control extensions        │
│                                                                             │
│  Analytics                   │  Custom metrics, data visualization,          │
│                              │  reporting, BI integrations, exports          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
