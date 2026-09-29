/**
 * MCP-UI-01..03 (#11, docs/testing/MCP_UI_TEST_PROCESS.md): the boundary no
 * other suite exercises, real MCP result/resource -> official AppBridge ->
 * sandboxed cross-origin iframe -> production-built React View, with the real
 * VexFlow renderer, SpessaSynth engine and piano SoundFont.
 *
 * One harness (harness-server.ts, host.ts, sandbox-proxy.ts): the production MCP
 * composition on loopback (test database, local test issuer token), this page
 * as a minimal host (pinned SDK client + official AppBridge, adapted from
 * ext-apps basic-host), the sandbox proxy on its own origin with the CSP
 * built from the resource's `_meta.ui.csp`, and Playwright reading the View
 * frame's semantic DOM/ARIA state. Every score reaching the View is a real
 * tool result of the server; nothing is injected afterwards. No screenshot
 * is a pass criterion; sound is measured only as a peak level.
 *
 * Each scenario opens its own score, View and bridge and closes them in its
 * afterAll; only the server, database and sandbox origin are shared. Steps of
 * one scenario run in order (a step names the state it reaches).
 *
 * Reused, not repeated here: engraving details REN-01..03/REN-I01 (#5), the
 * engine and its sound AUDIO-01..07 plus its Chromium check (#6, #23), the
 * player's revision races UI-01..05 (#7), tool behavior MCP-CREATE/EDIT (#12,
 * #13), the protocol MCP-P01/P02 and the View parser MCP-U01 (#11).
 */
import {
  type McpUiHostContext,
  getToolUiResourceUri,
} from '@modelcontextprotocol/ext-apps/app-bridge';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createScoreOutputSchema, editScoreOutputSchema } from '@sheet-music/music-contracts';
import { RICH_WIRE_FIXTURE, RICH_WIRE_ORACLE } from '@sheet-music/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { envelopeOf, outputOf, scoreArgument } from '../support/tool-calls';
import {
  type HostedView,
  type McpHost,
  RESOURCE_MIME_TYPE,
  type UiResource,
  connectHost,
  mountView,
  readUiResource,
} from './host';
import type { McpUiHarnessInfo, ViewSnapshot } from './protocol';

const VIEW_URI = 'ui://sheet-music/score-view';
const VIEW_APP_NAME = 'sheet-music-score-view';
const TITLE = 'Rich wire fixture: ii-V-I in G';

/**
 * The written notes of RICH_WIRE_FIXTURE: RICH_WIRE_ORACLE.eventIds without
 * the two chords and the rest, plus RICH_WIRE_ORACLE.chordMemberIds.
 */
const CHORDS_AND_RESTS = ['rich-rh-c1', 'rich-rh-c2', 'rich-lh-r1'];
const WRITTEN_NOTE_IDS = [
  ...RICH_WIRE_ORACLE.eventIds.filter((id) => !CHORDS_AND_RESTS.includes(id)),
  ...RICH_WIRE_ORACLE.chordMemberIds,
].sort();
/** Chord symbols and Roman numerals of the fixture's four harmony events, as REN-I01 draws them. */
const HARMONY_LABELS = ['Gmaj7', 'Imaj7', 'Am7', 'ii7', 'D7(b9)', 'V7', 'G/B', 'I6'].sort();
const SCALE_DEGREE_LABELS = [
  ['rich-rh-n6', '4'],
  ['rich-rh-n7', '3'],
  ['rich-rh-n8', '2'],
  ['rich-rh-n9', '1'],
];
const ANNOTATION_TEXTS = [
  'Third of the chord, played with finger 3',
  'Triplet run: written triplets are not swung twice',
];

/** Peak levels of the playback-spessasynth Chromium check: sounding piano 0.009-0.05, tail < 0.001. */
const AUDIBLE = 0.005;
const SILENT = 0.0005;

const FRAME = { width: 760, height: 1000 } as const;
/**
 * #root of view/index.html is `box-sizing: border-box` with 16 px side padding
 * (8 px at 400 px and below): the notation takes the rest of the width.
 */
const ROOT_HORIZONTAL_PADDING = 2 * 16;

const HOST_CONTEXT: McpUiHostContext = {
  theme: 'light',
  platform: 'web',
  displayMode: 'inline',
  availableDisplayModes: ['inline'],
  containerDimensions: { width: 720, maxHeight: 6000 },
};

/**
 * MCP-UI-02's edit: the pickup becomes a full first bar whose two whole notes
 * have IDs revision 1 does not have, so the notes highlighted at tick 0 tell
 * which plan plays.
 */
const NEW_FIRST_BAR = {
  type: 'replace_measures',
  measureIds: ['rich-m1'],
  bars: [
    {
      id: 'rich-m1',
      kind: 'full',
      staves: [
        {
          staffId: 'rich-rh',
          voices: [
            {
              id: 'rich-rh-m1-v1',
              events: [
                {
                  id: 'mcpui-rh-n1',
                  type: 'note',
                  pitch: { step: 'D', alter: 0, octave: 5 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
        {
          staffId: 'rich-lh',
          voices: [
            {
              id: 'rich-lh-m1-v1',
              events: [
                {
                  id: 'mcpui-lh-n1',
                  type: 'note',
                  pitch: { step: 'G', alter: 0, octave: 2 },
                  duration: { value: 'whole' },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
const NEW_TICK0_NOTES = ['mcpui-lh-n1', 'mcpui-rh-n1'];
const NOTES_AFTER_EDIT = [
  ...WRITTEN_NOTE_IDS.filter((id) => id !== 'rich-rh-n1' && id !== 'rich-rh-n2'),
  ...NEW_TICK0_NOTES,
].sort();

/** MCP-UI-03's edit: a second teaching color on the pink chord member (P-03). */
const SECOND_COLOR_ON_PINK_NOTE = {
  type: 'add_annotation',
  annotation: {
    id: 'mcpui-a3',
    color: '#1e88e5',
    noteIds: [RICH_WIRE_ORACLE.coloredChordMember.id],
    text: 'Also the third',
  },
};

let harness: McpUiHarnessInfo;
let sandboxOrigin: string;

beforeAll(async () => {
  await page.viewport(1000, 1200);
  harness = await commands.mcpUi({ action: 'start', hostOrigin: window.location.origin });
  sandboxOrigin = new URL(harness.sandboxUrl).origin;
}, 120_000);

afterAll(async () => {
  await commands.mcpUi({ action: 'stop' });
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const sorted = (values: readonly string[] | undefined): string[] => [...(values ?? [])].sort();
const viewState = (): Promise<ViewSnapshot> => commands.mcpUi({ action: 'view-state' });
const click = (role: 'button' | 'checkbox' | 'link', name: string): Promise<void> =>
  commands.mcpUi({ action: 'view-click', target: { role, name } });
const peak = (view: ViewSnapshot): number =>
  view.audio.reduce((loudest, tap) => Math.max(loudest, tap.peak), 0);

/** Polls the View until `predicate` holds and returns that state; the error shows the last one. */
async function waitForView(
  description: string,
  predicate: (view: ViewSnapshot) => boolean,
  timeout = 20_000,
): Promise<ViewSnapshot> {
  const deadline = performance.now() + timeout;
  let view = await viewState();
  while (!predicate(view)) {
    if (performance.now() > deadline) {
      const { notation, ...rest } = view;
      throw new Error(
        `Timed out after ${timeout} ms waiting for ${description}. Last View state: ${JSON.stringify(
          {
            ...rest,
            highlighted: notation?.highlighted,
          },
        )}`,
      );
    }
    await sleep(40);
    view = await viewState();
  }
  return view;
}

/** Distinct non-empty highlight sets seen during `ms`, in order. */
async function sampleHighlights(ms: number): Promise<string[][]> {
  const seen: string[][] = [];
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const current = sorted((await viewState()).notation?.highlighted);
    if (current.length > 0 && current.join() !== seen.at(-1)?.join()) {
      seen.push(current);
    }
    await sleep(30);
  }
  return seen;
}

/** The identity of an artifact as it travels on the wire. */
interface ArtifactIdentity {
  readonly scoreId: string;
  readonly revision: number;
}

interface Scenario {
  readonly host: McpHost;
  readonly view: HostedView;
  readonly uiResourceUri: string;
  readonly resource: UiResource;
  readonly createResult: CallToolResult;
  readonly created: ArtifactIdentity;
}

/**
 * A host session as a real host runs one: connect, discover, call create_score
 * with the rich fixture, read the tool's ui:// resource, mount it, and relay
 * the tool input and result.
 */
async function openScenario(): Promise<Scenario> {
  const host = await connectHost(harness.mcpUrl, harness.token);
  try {
    const { tools } = await host.client.listTools();
    const createTool = tools.find((tool) => tool.name === 'create_score');
    const uiResourceUri = createTool === undefined ? undefined : getToolUiResourceUri(createTool);
    if (uiResourceUri === undefined) {
      throw new Error('create_score declares no ui:// resource: a host has nothing to render.');
    }
    const args = { score: scoreArgument(RICH_WIRE_FIXTURE) };
    const createResult = await host.callTool('create_score', args);
    const created = createScoreOutputSchema.parse(outputOf(createResult)).artifact;
    const resource = await readUiResource(host.client, uiResourceUri);
    const view = await mountView({
      client: host.client,
      resource,
      sandboxUrl: harness.sandboxUrl,
      hostContext: HOST_CONTEXT,
      ...FRAME,
    });
    await view.deliverToolCall('create_score', args, createResult);
    return { host, view, uiResourceUri, resource, createResult, created };
  } catch (error) {
    await host.close();
    throw error;
  }
}

async function closeScenario(scenario: Scenario | undefined): Promise<void> {
  await scenario?.view.dispose();
  await scenario?.host.close();
}

const waitUntilReady = (): Promise<ViewSnapshot> =>
  waitForView('the player to be ready', (view) => view.player?.status === 'Ready');

describe('MCP-UI-01 boot and real create_score result', { timeout: 60_000 }, () => {
  let scenario: Scenario | undefined;
  const current = (): Scenario => {
    if (scenario === undefined) {
      throw new Error('MCP-UI-01 setup failed');
    }
    return scenario;
  };

  beforeAll(async () => {
    scenario = await openScenario();
  }, 60_000);

  afterAll(() => closeScenario(scenario));

  it('discovers create_score and its ui:// resource: the production View with its asset origin and CSP', () => {
    const { uiResourceUri, resource } = current();
    expect(uiResourceUri).toBe(VIEW_URI);
    expect(resource.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(resource.csp).toEqual({
      connectDomains: [harness.assetOrigin],
      resourceDomains: [harness.assetOrigin],
    });
    expect(resource.html).toContain(
      `<meta name="sheet-music-asset-origin" content="${harness.assetOrigin}" />`,
    );
  });

  it('isolates the View on the sandbox origin under the CSP built from that metadata', async () => {
    // Cross-origin: the host page cannot reach into the sandbox.
    expect(current().view.frame.contentDocument).toBeNull();
    const policy = (await commands.mcpUi({ action: 'records' })).sandboxPolicies.at(-1) ?? '';
    expect(policy.split('; ')).toEqual(
      expect.arrayContaining([
        `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${harness.assetOrigin}`,
        `connect-src 'self' ${harness.assetOrigin}`,
        `font-src 'self' data: blob: ${harness.assetOrigin}`,
        "frame-src 'none'",
      ]),
    );
  });

  it('completes the handshake and shows the created score ID and revision with usable controls', async () => {
    const { view: hosted, created } = current();
    expect(created.revision).toBe(1);
    expect(hosted.events).toContainEqual({ type: 'initialized', app: VIEW_APP_NAME });
    expect(hosted.events.filter((event) => event.type === 'tool-result')).toEqual([
      {
        type: 'tool-result',
        tool: 'create_score',
        isError: false,
        scoreId: created.scoreId,
        revision: 1,
      },
    ]);

    const view = await waitUntilReady();

    expect(view).toMatchObject({
      connection: 'connected',
      mount: { scoreId: created.scoreId, revision: '1', theme: 'light' },
      notice: null,
      documentTheme: 'light',
      player: {
        label: `Score player: ${TITLE}`,
        alert: '',
        playButton: { name: 'Play', disabled: false },
        tempo: { valueText: '100% (132 BPM)', disabled: false },
        loop: { checked: false, disabled: false },
      },
    });
  });

  it('loads the embedded fonts, and the worklet and SoundFont from the declared asset origin, without uncaught errors', async () => {
    const view = await viewState();
    expect(view.loadedFonts).toEqual(expect.arrayContaining(['Bravura', 'Academico']));

    const { assetRequests, pageErrors, consoleErrors, serverLogs } = await commands.mcpUi({
      action: 'records',
    });
    expect(assetRequests).toEqual(
      expect.arrayContaining([
        {
          method: 'GET',
          path: expect.stringMatching(
            /^\/assets\/spessasynth_processor\.min-[\w-]+\.js$/,
          ) as string,
          origin: sandboxOrigin,
          status: 200,
        },
        {
          method: 'GET',
          path: '/assets/soundfonts/piano/ms-basic-grand-piano.sf3',
          origin: sandboxOrigin,
          status: 200,
        },
      ]),
    );
    expect(assetRequests.every((request) => request.status === 200)).toBe(true);
    expect(pageErrors).toEqual([]);
    // The View's document is on the sandbox origin, its worklet on the asset origin.
    const fromView = consoleErrors.filter(
      ({ url }) =>
        url.startsWith(sandboxOrigin) || url.startsWith(`${harness.assetOrigin}/assets/`),
    );
    expect(fromView).toEqual([]);
    expect(serverLogs).toEqual([]);
  });

  it('draws the labels and maps every written note to one notehead', async () => {
    const { notation, player } = await viewState();

    expect(sorted(notation?.noteIds)).toEqual(WRITTEN_NOTE_IDS);
    expect(notation?.highlighted).toEqual([]);
    expect(sorted(notation?.harmonyLabels)).toEqual(HARMONY_LABELS);
    expect([...(notation?.scaleDegreeLabels ?? [])].sort(([a], [b]) => a.localeCompare(b))).toEqual(
      SCALE_DEGREE_LABELS,
    );
    for (const text of ANNOTATION_TEXTS) {
      expect(player?.text).toContain(text);
    }
  });

  it('stays silent until a real click on Play, then plays with moving highlights, and stops on Pause', async () => {
    // No autoplay: still ready and silent a second after loading.
    await sleep(1_000);
    const before = await viewState();
    expect(before.player?.status).toBe('Ready');
    expect(before.audio.length).toBeGreaterThan(0);
    expect(peak(before)).toBeLessThan(SILENT);

    await click('button', 'Play');
    const playing = await waitForView('playback', (view) => view.player?.status === 'Playing');
    expect(playing.player?.playButton).toEqual({ name: 'Pause', disabled: false });
    expect(playing.audio.map((tap) => tap.state)).toContain('running');

    const highlights = await sampleHighlights(2_000);
    expect(highlights.length).toBeGreaterThanOrEqual(3);
    for (const noteIds of highlights) {
      expect(WRITTEN_NOTE_IDS).toEqual(expect.arrayContaining(noteIds));
    }
    await waitForView('audible output', (view) => peak(view) > AUDIBLE, 3_000);

    await click('button', 'Pause');
    const paused = await waitForView('the pause', (view) => view.player?.status === 'Paused');
    expect(paused.player?.playButton).toEqual({ name: 'Play', disabled: false });
    await waitForView('silence', (view) => peak(view) < SILENT, 3_000);
  });

  it("opens the SoundFont license through the host, the View's one app-initiated request", async () => {
    await commands.mcpUi({ action: 'view-click', target: { text: 'Sound credits' } });
    await click('link', 'License (MIT)');

    await expect
      .poll(() => current().view.events.filter((event) => event.type === 'open-link'))
      .toEqual([
        {
          type: 'open-link',
          url: `${harness.assetOrigin}/assets/soundfonts/piano/LICENSE.txt`,
        },
      ]);
  });
});

describe(
  'MCP-UI-02 a real edit reaches the playing View (P-01 wiring)',
  { timeout: 60_000 },
  () => {
    let scenario: Scenario | undefined;
    const current = (): Scenario => {
      if (scenario === undefined) {
        throw new Error('MCP-UI-02 setup failed');
      }
      return scenario;
    };

    beforeAll(async () => {
      scenario = await openScenario();
      await waitUntilReady();
    }, 60_000);

    afterAll(() => closeScenario(scenario));

    it('plays revision 1 in a loop after a real click', async () => {
      // Looping keeps revision 1 sounding until the edit arrives; P-01 stops it anyway.
      await click('checkbox', 'Loop');
      await click('button', 'Play');
      const view = await waitForView(
        'audible playback with a highlight',
        (state) =>
          state.player?.status === 'Playing' &&
          peak(state) > AUDIBLE &&
          (state.notation?.highlighted.length ?? 0) > 0,
        5_000,
      );
      expect(view.mount?.revision).toBe('1');
      expect(view.player?.loop).toEqual({ checked: true, disabled: false });
      expect(WRITTEN_NOTE_IDS).toEqual(expect.arrayContaining(sorted(view.notation?.highlighted)));
    });

    it('routes the real edit_score result (same ID, revision 2) through the bridge', async () => {
      const { host, view, created } = current();
      const result = await host.callTool('edit_score', {
        scoreId: created.scoreId,
        expectedRevision: 1,
        operations: [NEW_FIRST_BAR],
      });
      const edited = editScoreOutputSchema.parse(outputOf(result)).artifact;
      expect(edited).toMatchObject({ scoreId: created.scoreId, revision: 2 });
      expect((await viewState()).player?.status).toBe('Playing');

      await view.deliverResult('edit_score', result);

      expect(view.events.filter((event) => event.type === 'tool-result').at(-1)).toEqual({
        type: 'tool-result',
        tool: 'edit_score',
        isError: false,
        scoreId: created.scoreId,
        revision: 2,
      });
    });

    it('stops the old sound and shows revision 2 at tick 0, paused even with loop on', async () => {
      const { created } = current();
      const first = await waitForView('revision 2', (view) => view.mount?.revision === '2');
      expect(first.mount?.scoreId).toBe(created.scoreId);
      expect(first.player?.status).not.toBe('Playing');

      await waitForView('silence', (view) => peak(view) < SILENT, 3_000);
      const ready = await waitUntilReady();
      expect(ready.player?.playButton).toEqual({ name: 'Play', disabled: false });
      expect(sorted(ready.notation?.noteIds)).toEqual(NOTES_AFTER_EDIT);
      expect(ready.notation?.highlighted).toEqual([]);

      await sleep(1_000);
      const still = await viewState();
      expect(still.player?.status).toBe('Ready');
      expect(still.notation?.highlighted).toEqual([]);
      expect(peak(still)).toBeLessThan(SILENT);
    });

    it('plays the new plan from tick 0 on an explicit Play', async () => {
      await click('button', 'Play');
      const first = await waitForView(
        'the first highlighted notes',
        (view) => (view.notation?.highlighted.length ?? 0) > 0,
        5_000,
      );
      expect(sorted(first.notation?.highlighted)).toEqual(NEW_TICK0_NOTES);
      expect(first.player?.status).toBe('Playing');
      await waitForView('audible output', (view) => peak(view) > AUDIBLE, 3_000);

      await click('button', 'Pause');
      await waitForView('the pause', (view) => view.player?.status === 'Paused');
    });
  },
);

describe('MCP-UI-03 rejected edit, host context and teardown', { timeout: 60_000 }, () => {
  let scenario: Scenario | undefined;
  let rejected: CallToolResult | undefined;
  let sizeEventsAtTeardown = 0;
  const current = (): Scenario => {
    if (scenario === undefined) {
      throw new Error('MCP-UI-03 setup failed');
    }
    return scenario;
  };
  const sizeEvents = (): number =>
    current().view.events.filter((event) => event.type === 'size-changed').length;

  beforeAll(async () => {
    scenario = await openScenario();
    await waitUntilReady();
  }, 60_000);

  afterAll(() => closeScenario(scenario));

  it('gets a real SCORE_VALIDATION_FAILED for a second color on the pink note', async () => {
    const { host, created } = current();
    rejected = await host.callTool('edit_score', {
      scoreId: created.scoreId,
      expectedRevision: 1,
      operations: [SECOND_COLOR_ON_PINK_NOTE],
    });
    const envelope = envelopeOf(rejected);
    expect(envelope.code).toBe('SCORE_VALIDATION_FAILED');
    expect(envelope.details).toEqual([
      expect.objectContaining({
        code: 'ANNOTATION_COLOR_CONFLICT',
        ids: expect.arrayContaining([
          RICH_WIRE_ORACLE.coloredChordMember.id,
          'rich-a1',
          'mcpui-a3',
        ]) as string[],
      }),
    ]);
  });

  it('shows the recoverable error and keeps revision 1 playable', async () => {
    const { view: hosted, created } = current();
    if (rejected === undefined) {
      throw new Error('no rejected result');
    }
    await hosted.deliverResult('edit_score', rejected);

    const view = await waitForView('the notice', (state) => state.notice !== null);
    expect(view.notice).toMatchObject({ kind: 'rejected', code: 'SCORE_VALIDATION_FAILED' });
    expect(view.notice?.text).toMatch(
      /^The request was rejected: .+ The score shown is unchanged\./,
    );
    // The code is the notice's data (above), not part of its text.
    expect(view.notice?.text).not.toContain('SCORE_VALIDATION_FAILED');
    expect(view).toMatchObject({
      connection: 'connected',
      mount: { scoreId: created.scoreId, revision: '1' },
      player: { status: 'Ready', alert: '', playButton: { name: 'Play', disabled: false } },
    });
    expect(sorted(view.notation?.noteIds)).toEqual(WRITTEN_NOTE_IDS);

    await click('button', 'Play');
    await waitForView('playback', (state) => state.player?.status === 'Playing');
    await click('button', 'Pause');
    await waitForView('the pause', (state) => state.player?.status === 'Paused');
  });

  it('applies the theme and container width the host sends', async () => {
    const { view: hosted } = current();
    const before = sizeEvents();
    const width = 420;

    hosted.setHostContext({
      ...hosted.hostContext(),
      theme: 'dark',
      containerDimensions: { width, maxHeight: 6000 },
    });

    const view = await waitForView(
      'the dark theme at the new width',
      (state) =>
        state.documentTheme === 'dark' &&
        state.mount?.theme === 'dark' &&
        state.notation?.width === width - (state.rootPaddingX ?? Number.NaN),
    );
    expect(view.rootWidth).toBe(width);
    // 420 px is above the narrow breakpoint: the full padding applies.
    expect(view.rootPaddingX).toBe(ROOT_HORIZONTAL_PADDING);
    // The narrower layout is taller: the View reports its new size.
    await expect.poll(sizeEvents).toBeGreaterThan(before);
  });

  it('on teardown releases the player and closes its audio before answering, then ignores the host', async () => {
    const { view: hosted, createResult } = current();
    // Control: while connected, a resized frame is reported.
    hosted.frame.style.width = '700px';
    await expect
      .poll(() =>
        hosted.events.some((event) => event.type === 'size-changed' && event.width === 700),
      )
      .toBe(true);
    const open = await viewState();
    expect(open.audio.map((tap) => tap.state)).not.toContain('closed');
    expect(open.teardownAnswer).toBeNull();

    await hosted.teardown();

    const closed = await viewState();
    // Read by the sandbox proxy while it relayed the answer, before the host got it.
    expect(closed.teardownAnswer).toEqual({
      mounted: false,
      player: false,
      audioStates: open.audio.map(() => 'closed'),
    });
    expect(closed).toMatchObject({ connection: 'closed', mount: null, player: null, notice: null });
    expect(closed.audio.length).toBeGreaterThan(0);
    expect(closed.audio.every((tap) => tap.state === 'closed')).toBe(true);

    sizeEventsAtTeardown = sizeEvents();
    hosted.setHostContext({ ...hosted.hostContext(), theme: 'light' });
    await hosted.deliverResult('create_score', createResult);
    hosted.frame.style.width = `${FRAME.width}px`;
    await sleep(750);

    const after = await viewState();
    expect(after).toMatchObject({ connection: 'closed', mount: null, documentTheme: 'dark' });
    expect(sizeEvents()).toBe(sizeEventsAtTeardown);
  });

  it('closing the bridge disconnects it and removes the View frame', async () => {
    const { view: hosted, createResult } = current();

    await hosted.dispose();

    expect(hosted.events.at(-1)).toEqual({ type: 'closed' });
    await expect(hosted.bridge.sendToolResult(createResult)).rejects.toThrow();
    expect(hosted.frame.isConnected).toBe(false);
    expect((await viewState()).present).toBe(false);
    expect(sizeEvents()).toBe(sizeEventsAtTeardown);
  });
});
