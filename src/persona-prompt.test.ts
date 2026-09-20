import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { DefaultResourceLoader, SettingsManager } from "@mariozechner/pi-coding-agent";
import { buildTransportPrompt } from "./pi-session.js";
import type { PicordRuntimeConfig } from "./types.js";

/**
 * Persona delivery tests.
 *
 * Why these exist: Tachikoma's soul (pi-global-harness/persona/SOUL.md) sat in a
 * repository for months being referenced by a protocol file that ordered "read
 * SOUL.md first", while NOTHING ever loaded it. The prompt got no error and no
 * warning — the bot was simply less itself, and nobody could see it.
 *
 * The trap was in these two lines of picord:
 *
 *   appendSystemPrompt: [buildSystemPrompt(config)]   // ← discovery skipped
 *
 * `DefaultResourceLoader` only looks for APPEND_SYSTEM.md when no append was
 * supplied (`this.appendSystemPromptSource ?? discover(...)`). So picord, by
 * injecting its own block, silenced the only channel that could carry the soul.
 * These tests pin the contract: the soul must arrive, and it must arrive FIRST.
 */

const SOUL_MARKER = "Curiosidad Insaciable";
const SOUL_TEXT = `# Soul fixture\n\n## II. Rasgos\n- **${SOUL_MARKER}:** fixture content.\n`;
const TRANSPORT_MARKER = "You are pi responding through Discord.";

const tmpRoots: string[] = [];

afterAll(() => {
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
});

/** Builds a loader wired EXACTLY like the workspace loader in pi-session.ts. */
async function loadLikePicord(agentDir: string, cwd: string, useOverride: boolean) {
  const settingsManager = SettingsManager.inMemory({});
  const transport = (base: string[]) => [...base, buildTransportPrompt(testConfig)];

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noThemes: true,
    // The whole point: `appendSystemPrompt` is what the buggy version set.
    ...(useOverride
      ? { appendSystemPromptOverride: transport }
      : { appendSystemPrompt: [buildTransportPrompt(testConfig)] }),
  });
  await loader.reload();
  return loader.getAppendSystemPrompt();
}

const testConfig = {
  toolMode: "coding",
  cavemanLevel: "off",
  systemPromptAppend: "",
} as unknown as PicordRuntimeConfig;

function makeFixtureDirs() {
  const root = mkdtempSync(join(tmpdir(), "picord-persona-"));
  tmpRoots.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), SOUL_TEXT);
  return { agentDir, cwd };
}

describe("buildTransportPrompt", () => {
  it("carries no persona of its own", () => {
    const prompt = buildTransportPrompt(testConfig);

    // The exact string that used to sit here, contradicting the soul.
    expect(prompt).not.toMatch(/sassy/i);
    expect(prompt).not.toMatch(/dry confidence/i);
    expect(prompt).not.toMatch(/playful edge/i);
    // Transport concerns do belong here.
    expect(prompt).toContain(TRANSPORT_MARKER);
    expect(prompt).toContain("Guild channels represent projects/workspaces.");
  });

  it("still honours the operator knob from picord.config.json", () => {
    const prompt = buildTransportPrompt({
      ...testConfig,
      systemPromptAppend: "Keep replies concise.",
    } as PicordRuntimeConfig);
    expect(prompt).toContain("Keep replies concise.");
  });
});

describe("persona delivery to the system prompt", () => {
  it("delivers the soul when the loader keeps its own discovery (override)", async () => {
    const { agentDir, cwd } = makeFixtureDirs();
    const sections = await loadLikePicord(agentDir, cwd, true);
    const joined = sections.join("\n\n");

    expect(joined).toContain(SOUL_MARKER);
    expect(joined).toContain(TRANSPORT_MARKER);
  });

  it("puts the soul BEFORE the transport block", async () => {
    const { agentDir, cwd } = makeFixtureDirs();
    const sections = await loadLikePicord(agentDir, cwd, true);

    // The voice opens the system prompt; project instructions close it.
    expect(sections[0]).toContain(SOUL_MARKER);
    expect(sections[sections.length - 1]).toContain(TRANSPORT_MARKER);
  });

  it("is SILENTLY skipped when picord injects its own append (regression)", async () => {
    const { agentDir, cwd } = makeFixtureDirs();
    const sections = await loadLikePicord(agentDir, cwd, false);
    const joined = sections.join("\n\n");

    // This is the outage: no throw, no warning, no soul.
    expect(joined).not.toContain(SOUL_MARKER);
    expect(joined).toContain(TRANSPORT_MARKER);
  });

  it("keeps the workspace loader off the broken wiring", () => {
    // Static guard: the loader is built in pi-session.ts, so a future edit could
    // reintroduce `appendSystemPrompt` without any test noticing. Assert on the
    // source the same way the harness does.
    const source = readFileSync(
      fileURLToPath(new URL("./pi-session.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/appendSystemPromptOverride:/);
    expect(source).not.toMatch(/^\s*appendSystemPrompt:\s*\[/m);
  });
});
