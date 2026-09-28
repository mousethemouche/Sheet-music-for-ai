/**
 * The five product tools (docs/architecture/MCP_SERVER.md §2-§5): thin
 * adapters that pass the principal and the raw arguments to the shared use
 * cases and serialize their results. No music rule lives here.
 */
import type { McpUiToolMeta } from '@modelcontextprotocol/ext-apps';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import {
  type CreateScoreOutput,
  type EditScoreOutput,
  type GetScoreOutput,
  type SaveScoreOutput,
  type ScoreArtifact,
  type SearchScoresOutput,
  type ToolName,
  TOOL_CONTRACTS,
} from '@sheet-music/music-contracts';
import {
  type Logger,
  type ServerError,
  currentRequestContext,
  runUseCase,
  toMcpToolError,
} from '@sheet-music/server-common';
import { z } from 'zod';
import type { PrincipalResolver } from './principal';
import {
  CREATE_SCORE_DESCRIPTION,
  EDIT_SCORE_DESCRIPTION,
  GET_SCORE_DESCRIPTION,
  SAVE_SCORE_DESCRIPTION,
  SEARCH_SCORES_DESCRIPTION,
} from './tool-descriptions';
import type { McpUseCases, UseCase } from './use-cases';
import { SCORE_VIEW_URI } from './view-resource';

export interface ToolDependencies {
  readonly useCases: McpUseCases;
  readonly resolvePrincipal: PrincipalResolver;
  /** Receives use-case failures and thrown errors, with the request's correlation ID. */
  readonly logger: Logger;
}

/**
 * The published input schema of a tool: exactly the music-contracts JSON
 * Schema, attached as metadata to a schema that accepts any JSON object. The
 * SDK therefore does not pre-validate the arguments; the use case parses them
 * with the same contract and reports INVALID_INPUT with structured details,
 * like every other transport (APPLICATION_LAYER.md §1, §7.1).
 */
function publishedInputSchema(contract: z.ZodType) {
  const jsonSchema = z.toJSONSchema(contract, { io: 'input', target: 'draft-7' });
  // The SDK adds the dialect itself when it lists the tool.
  delete jsonSchema.$schema;
  return z.looseObject({}).meta(jsonSchema);
}

/** Built once per tool: a server is created for every request. */
const publishedInputs = new Map<ToolName, ReturnType<typeof publishedInputSchema>>();

function publishedInput(name: ToolName): ReturnType<typeof publishedInputSchema> {
  let schema = publishedInputs.get(name);
  if (schema === undefined) {
    schema = publishedInputSchema(TOOL_CONTRACTS[name].input);
    publishedInputs.set(name, schema);
  }
  return schema;
}

/**
 * Visibility: every tool is model-only. The View calls no server tool in the
 * MVP (it renders and plays the result it receives), so the host must refuse
 * any tools/call from the iframe. save_score in particular stays a model call
 * that the host shows to the human for approval.
 */
const MODEL_ONLY: McpUiToolMeta['visibility'] = ['model'];

/** Tools whose result is a score artifact rendered by the View. */
const SHOWS_SCORE: McpUiToolMeta = { resourceUri: SCORE_VIEW_URI, visibility: MODEL_ONLY };
const NO_VIEW: McpUiToolMeta = { visibility: MODEL_ONLY };

interface ToolDefinition<Output> {
  readonly name: ToolName;
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  readonly ui: McpUiToolMeta;
  readonly useCase: (useCases: McpUseCases) => UseCase<Output>;
  readonly present: (output: Output) => CallToolResult;
}

function scoreLine(artifact: ScoreArtifact): string {
  const bars = artifact.score.staves[0]?.measures.length ?? 0;
  const staves = artifact.score.staves.length;
  const title = artifact.score.metadata.title;
  return `${title === undefined ? 'untitled' : `"${title}"`}, ${bars} bar${bars === 1 ? '' : 's'}, ${staves} ${staves === 1 ? 'staff' : 'staves'}`;
}

function lifecycleLine(artifact: ScoreArtifact): string {
  return artifact.state === 'draft'
    ? `It is an unsaved draft that expires at ${artifact.expiresAt} unless edited; it is not in the user's library.`
    : `It is saved in the user's library as "${artifact.title}".`;
}

const text = (value: string): CallToolResult['content'] => [{ type: 'text', text: value }];

const CREATE_SCORE: ToolDefinition<CreateScoreOutput> = {
  name: 'create_score',
  title: 'Create score',
  description: CREATE_SCORE_DESCRIPTION,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  ui: SHOWS_SCORE,
  useCase: (useCases) => useCases.createScore,
  present: ({ artifact }) => ({
    structuredContent: { artifact },
    content: text(
      `Created score ${artifact.scoreId} at revision ${artifact.revision} (${scoreLine(artifact)}); it is displayed to the user. ${lifecycleLine(artifact)} Edit it with edit_score (expectedRevision ${artifact.revision}); call save_score only if the user asks to save it.`,
    ),
  }),
};

const EDIT_SCORE: ToolDefinition<EditScoreOutput> = {
  name: 'edit_score',
  title: 'Edit score',
  description: EDIT_SCORE_DESCRIPTION,
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  ui: SHOWS_SCORE,
  useCase: (useCases) => useCases.editScore,
  present: ({ artifact }) => ({
    structuredContent: { artifact },
    content: text(
      `Edited score ${artifact.scoreId}: now at revision ${artifact.revision} (${scoreLine(artifact)}); the updated score is displayed to the user. ${lifecycleLine(artifact)} Use expectedRevision ${artifact.revision} for the next change; call get_score to read the full result.`,
    ),
  }),
};

const SAVE_SCORE: ToolDefinition<SaveScoreOutput> = {
  name: 'save_score',
  title: 'Save score to library',
  description: SAVE_SCORE_DESCRIPTION,
  // A replay of the same save writes nothing (outcome "already_saved").
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  ui: NO_VIEW,
  useCase: (useCases) => useCases.saveScore,
  present: ({ outcome, artifact }) => ({
    structuredContent: { outcome, artifact },
    content: text(
      outcome === 'saved'
        ? `Saved score ${artifact.scoreId} (revision ${artifact.revision}) in the user's library as "${artifact.title}"${artifact.tags.length > 0 ? ` with tags ${artifact.tags.join(', ')}` : ''}.`
        : `Score ${artifact.scoreId} was already saved with this revision, title and tags; nothing changed.`,
    ),
  }),
};

const GET_SCORE: ToolDefinition<GetScoreOutput> = {
  name: 'get_score',
  title: 'Get score',
  description: GET_SCORE_DESCRIPTION,
  annotations: { readOnlyHint: true, openWorldHint: false },
  ui: SHOWS_SCORE,
  useCase: (useCases) => useCases.getScore,
  // The model reads the score from here: MCP Apps hosts keep structuredContent for the View.
  present: ({ artifact }) => ({
    structuredContent: { artifact },
    content: text(
      `Score ${artifact.scoreId} at revision ${artifact.revision} (${scoreLine(artifact)}); it is displayed to the user. ${lifecycleLine(artifact)} Canonical ScoreSpec:\n${JSON.stringify(artifact.score)}`,
    ),
  }),
};

const SEARCH_SCORES: ToolDefinition<SearchScoresOutput> = {
  name: 'search_scores',
  title: 'Search saved scores',
  description: SEARCH_SCORES_DESCRIPTION,
  annotations: { readOnlyHint: true, openWorldHint: false },
  ui: NO_VIEW,
  useCase: (useCases) => useCases.searchScores,
  present: (output) => ({
    structuredContent: { items: output.items, page: output.page },
    content: text(
      `${output.page.total} saved score${output.page.total === 1 ? '' : 's'} match; ${output.items.length} listed from offset ${output.page.offset}:\n${JSON.stringify(output)}`,
    ),
  }),
};

/**
 * The shared tool-error contract (ERRORS_AND_SECURITY.md §1.4): one text block
 * holding the envelope JSON with the request's correlation ID, no
 * structuredContent (the SDK client would validate it against the output
 * schema). A code answered at the HTTP layer becomes INTERNAL.
 */
function toolError(error: ServerError): CallToolResult {
  const { isError, content } = toMcpToolError(error, currentRequestContext()?.correlationId);
  return { isError, content: [...content] };
}

function registerTool<Output>(
  server: McpServer,
  deps: ToolDependencies,
  tool: ToolDefinition<Output>,
): void {
  const useCase = tool.useCase(deps.useCases);
  registerAppTool(
    server,
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: publishedInput(tool.name),
      outputSchema: TOOL_CONTRACTS[tool.name].output,
      annotations: tool.annotations,
      _meta: { ui: tool.ui },
    },
    // runUseCase logs store failures and INTERNAL with their redacted cause,
    // and turns a thrown value (a bug) into a safe INTERNAL failure.
    async (args, extra): Promise<CallToolResult> => {
      const result = await runUseCase(deps.logger, tool.name, () =>
        useCase.execute(deps.resolvePrincipal(extra.authInfo), args),
      );
      return result.ok ? tool.present(result.value) : toolError(result.error);
    },
  );
}

/** Registers the five tools, in manifest order. */
export function registerScoreTools(server: McpServer, deps: ToolDependencies): void {
  registerTool(server, deps, CREATE_SCORE);
  registerTool(server, deps, EDIT_SCORE);
  registerTool(server, deps, SAVE_SCORE);
  registerTool(server, deps, GET_SCORE);
  registerTool(server, deps, SEARCH_SCORES);
}
