import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccessApprovalManager } from "./access-approval.js";
import { WorkspaceGuard } from "./path-policy.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "picord-path-policy-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Runs a real bash command through the WorkspaceGuard and returns the approval
 * requests that would have been shown to the owner. The bash command tokenizer
 * has been removed, so commands must never produce approval requests.
 */
async function runBashCommand(command: string): Promise<string[]> {
  const dir = createTempDir();
  const approvals = new AccessApprovalManager("owner-1", async () => undefined);
  const guard = new WorkspaceGuard(dir, undefined, approvals);
  const bash = await guard.createBashOperations({
    conversationKey: "conversation-1",
    workspaceKey: "workspace-1",
    sessionName: "session-1",
  });

  const result = await bash.exec(command, dir, { onData: () => {} });
  if (result.exitCode !== 0) {
    throw new Error(`test command exited with code ${result.exitCode}: ${command}`);
  }
  return approvals.getPendingRequests().map((request) => request.summary);
}

describe("WorkspaceGuard bash operations do not parse paths", () => {
  it("runs commands with absolute-path-looking tokens without approval", async () => {
    const summaries = await runBashCommand("echo /prod /dev/null; echo done");
    expect(summaries).toEqual([]);
  });

  it("runs commands with relative slashes without approval", async () => {
    const summaries = await runBashCommand(
      "echo apps/prod terraform/terraform-epf-engineering-platform",
    );
    expect(summaries).toEqual([]);
  });

  it("runs commands with URLs without approval", async () => {
    const summaries = await runBashCommand("echo https://example.com/health");
    expect(summaries).toEqual([]);
  });

  it("does not request approval for blocked-path-looking tokens", async () => {
    const summaries = await runBashCommand("echo .env .env.production");
    expect(summaries).toEqual([]);
  });
});
