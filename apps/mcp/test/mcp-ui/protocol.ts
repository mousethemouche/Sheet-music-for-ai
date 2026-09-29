/**
 * Data exchanged between the MCP-UI host page (Chromium) and the Node side of
 * the harness (harness-server.ts) through the `mcpUi` Vitest browser command
 * (registered on the `mcp-ui` project in vitest.config.ts). Plain serializable
 * types only: both sides import this file.
 */

/** Database of the MCP-UI suite (one file at a time, TEST_DATABASE_URL names the server). */
export const MCP_UI_DATABASE = 'sheet_music_test_mcpui';

/** `name` of the inner iframe the sandbox proxy writes the View into. */
export const VIEW_FRAME_NAME = 'mcp-ui-view';

/** What `mcpUiStart` gives the host page. */
export interface McpUiHarnessInfo {
  /** Canonical MCP endpoint: `http://127.0.0.1:<port>/mcp` (MCP_PUBLIC_URL of the server under test). */
  readonly mcpUrl: string;
  /** Origin of that server, which serves the View's playback assets at `/assets/`. */
  readonly assetOrigin: string;
  /** The sandbox proxy page, on its own origin; the host appends `?csp=<resource CSP JSON>`. */
  readonly sandboxUrl: string;
  /** An MCP access token of user A minted by the local test issuer. */
  readonly token: string;
}

/** A control inside the View, found the way assistive technology finds it. */
export type ViewClickTarget =
  | { readonly role: 'button' | 'checkbox' | 'switch' | 'link'; readonly name: string }
  | { readonly text: string };

/** One request the MCP server answered on its `/assets/` route. */
export interface AssetRequest {
  readonly method: string;
  readonly path: string;
  /** The `Origin` header: the View's (sandbox) origin for its CORS requests. */
  readonly origin: string | null;
  readonly status: number;
}

/** What the harness observed outside the page. */
export interface HarnessRecords {
  readonly assetRequests: readonly AssetRequest[];
  /** `Content-Security-Policy` header of every sandbox proxy page served. */
  readonly sandboxPolicies: readonly string[];
  /** Uncaught exceptions of any frame of the page. */
  readonly pageErrors: readonly string[];
  /** Console errors, with the URL of the script or document that logged them. */
  readonly consoleErrors: readonly { readonly text: string; readonly url: string }[];
  /** Warning and error log events of the MCP server (level and event name only). */
  readonly serverLogs: readonly { readonly level: string; readonly event: string }[];
}

/** Output of the audio probe the sandbox proxy puts on the View's AudioNode.prototype.connect. */
export interface AudioTap {
  /** `AudioContext.state` of the node connected to the destination. */
  readonly state: string;
  /** Peak absolute sample of that node's output over the last 2048 frames. */
  readonly peak: number;
}

/** Semantic state of the View document (MCP_VIEW.md §6 hooks), read inside its frame. */
export interface ViewSnapshot {
  /** False when the View frame does not exist (not mounted yet, or removed). */
  readonly present: boolean;
  /** `data-connection` of the View shell. */
  readonly connection: string | null;
  /** The accepted artifact (`score-mount`), or null. */
  readonly mount: {
    readonly scoreId: string | null;
    readonly revision: string | null;
    readonly theme: string | null;
  } | null;
  /** The View's recoverable notice (`view-notice`), or null. */
  readonly notice: {
    readonly kind: string | null;
    readonly code: string | null;
    readonly text: string;
  } | null;
  readonly player: {
    /** `aria-label` of the ScorePlayer section. */
    readonly label: string | null;
    /** Text of the player's `role="status"`. */
    readonly status: string;
    /** Text of the player's `role="alert"` (empty without a problem). */
    readonly alert: string;
    /** The Play/Pause button: the only `<button>` of the controls without an ARIA role. */
    readonly playButton: { readonly name: string; readonly disabled: boolean } | null;
    /** The Tempo slider's thumb (`role="slider"`): its `aria-valuetext` and `aria-disabled`. */
    readonly tempo: { readonly valueText: string | null; readonly disabled: boolean } | null;
    /** The Loop switch (`role="switch"`): `aria-checked` and the button's `disabled`. */
    readonly loop: { readonly checked: boolean; readonly disabled: boolean } | null;
    /** Rendered text of the player (hidden text excluded): annotation labels, controls. */
    readonly text: string;
    /**
     * Computed styles that exist only when the host compiled the player's
     * Tailwind classes (DESIGN_SYSTEM.md §4): an unstyled player passes every
     * role and name check above, so these catch a missing `@source`.
     */
    readonly styling: {
      /**
       * Background of the Play button (`@sheet-music/ui` Button, primary
       * token). It may be the hover color: the pointer rests where the last
       * click left it.
       */
      readonly playBackground: string | null;
      /**
       * `border-top-style` and `-width` of the Play button, such as
       * `solid 1px`: the boundary forced colors (Windows High Contrast)
       * repaints when it removes the primary fill.
       */
      readonly playBorder: string | null;
      /** Background of the controls bar: a token surface with no hover or transition. */
      readonly controlsBackground: string | null;
      /** `box-shadow` of the notation paper: its inset edge, a class only score-ui uses. */
      readonly paperEdge: string | null;
    };
  } | null;
  readonly notation: {
    /** `width` attribute of the notation SVG. */
    readonly width: number | null;
    /** Distinct `data-note-id` of the drawn noteheads, in document order. */
    readonly noteIds: readonly string[];
    /** Distinct note IDs whose notehead is highlighted by playback. */
    readonly highlighted: readonly string[];
    /** Text of every harmony label (chord symbols and Roman numerals). */
    readonly harmonyLabels: readonly string[];
    /** `[noteId, text]` of every scale-degree label. */
    readonly scaleDegreeLabels: readonly (readonly [string, string])[];
  } | null;
  /** `data-theme` of the View document. */
  readonly documentTheme: string | null;
  /**
   * The token classes (`light`, `dark`) on the View document, space
   * separated: theme.css keys its tokens and color scheme on them.
   */
  readonly documentThemeClass: string;
  /** Rendered width of the View root, in CSS px. */
  readonly rootWidth: number | null;
  /** Computed left + right padding of the View root, in CSS px (it depends on the width). */
  readonly rootPaddingX: number | null;
  /** Families of the loaded font faces of the View document. */
  readonly loadedFonts: readonly string[];
  readonly audio: readonly AudioTap[];
  readonly credits: { readonly text: string; readonly licenseHref: string | null } | null;
  /**
   * What the sandbox proxy read in the View at the moment it relayed the
   * answer to `ui/resource-teardown` (before the host received it); null
   * before any teardown answer.
   */
  readonly teardownAnswer: {
    /** A `score-mount` was still in the document. */
    readonly mounted: boolean;
    /** A ScorePlayer section was still in the document. */
    readonly player: boolean;
    /** `AudioContext.state` of every tapped node. */
    readonly audioStates: readonly string[];
  } | null;
}

/** Requests of the `mcpUi` command; harness-server.ts `handleMcpUiCommand` answers them. */
export type McpUiRequest =
  | { readonly action: 'start'; readonly hostOrigin: string }
  | { readonly action: 'stop' }
  | { readonly action: 'view-state' }
  | { readonly action: 'view-click'; readonly target: ViewClickTarget }
  | { readonly action: 'records' };

/** The command as the host page calls it (`commands.mcpUi` of vitest/browser). */
export interface McpUiCommand {
  (request: { readonly action: 'start'; readonly hostOrigin: string }): Promise<McpUiHarnessInfo>;
  (request: { readonly action: 'stop' }): Promise<void>;
  (request: { readonly action: 'view-state' }): Promise<ViewSnapshot>;
  (request: { readonly action: 'view-click'; readonly target: ViewClickTarget }): Promise<void>;
  (request: { readonly action: 'records' }): Promise<HarnessRecords>;
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    mcpUi: McpUiCommand;
  }
}
