import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resolveCodexBinary } from "../../../integrations/harness/core/child";
import type { HarnessId } from "../../sessions/model/session";
import { runtimeProviderBinaryPath } from "./providerBinaryPaths";
import {
  announceHarnessUpdated,
  fetchLatestHarnessVersion,
  findHarnessUpdates,
  onHarnessUpdated,
} from "./harnessUpdates";

const events = vi.hoisted(() => {
  const listeners = new Map<
    string,
    Set<(event: { payload: unknown }) => void>
  >();
  return {
    emit: vi.fn(async (name: string, payload: unknown) => {
      listeners.get(name)?.forEach((listener) => listener({ payload }));
    }),
    listen: vi.fn(
      async (name: string, listener: (event: { payload: unknown }) => void) => {
        const handlers = listeners.get(name) ?? new Set();
        handlers.add(listener);
        listeners.set(name, handlers);
        return () => {
          handlers.delete(listener);
        };
      },
    ),
  };
});
vi.mock("@tauri-apps/api/event", () => events);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../integrations/harness/core/child", () => ({
  resolveCodexBinary: vi.fn(),
}));
vi.mock("./providerBinaryPaths", () => ({
  runtimeProviderBinaryPath: vi.fn(() => null),
}));

const INSTALLED: Partial<Record<HarnessId, string>> = {
  claude: "2.1.284 (Claude Code)",
  codex: "codex-cli 0.159.2",
  opencode: "1.18.31",
  cursor: "2026.09.01-abc",
};

const LATEST: Partial<Record<HarnessId, string>> = {
  claude: "2.1.285",
  codex: "0.159.2",
  opencode: "1.18.33",
};

function find(harnesses: HarnessId[]) {
  return findHarnessUpdates({
    harnesses,
    installedVersion: async (id) => INSTALLED[id],
    latestVersion: async (id) => {
      const version = LATEST[id];
      if (!version) throw new Error("offline");
      return version;
    },
  });
}

describe("harness update check", () => {
  it("checks the resolved Codex binary and its runtime override before offering updates", async () => {
    const path =
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
    vi.mocked(resolveCodexBinary).mockResolvedValue({ path });
    vi.mocked(runtimeProviderBinaryPath).mockReturnValue(path);
    vi.mocked(invoke).mockRejectedValue(
      new Error("Codex is bundled with ChatGPT.app. Update that application."),
    );
    try {
      expect(
        await findHarnessUpdates({
          harnesses: ["codex"],
          installedVersion: async () => "codex-cli 0.160.0",
          latestVersion: fetchLatestHarnessVersion,
        }),
      ).toEqual([]);
      expect(invoke).toHaveBeenCalledWith("harness_latest_version", {
        provider: "codex",
        command: path,
        binaryPath: path,
      });
    } finally {
      vi.mocked(runtimeProviderBinaryPath).mockReturnValue(null);
    }
  });

  it("still offers npm release updates for standalone Codex", async () => {
    vi.mocked(resolveCodexBinary).mockResolvedValue({
      path: "/opt/homebrew/bin/codex",
    });
    vi.mocked(invoke).mockResolvedValue("0.160.1");
    expect(
      await findHarnessUpdates({
        harnesses: ["codex"],
        installedVersion: async () => "codex-cli 0.160.0",
        latestVersion: fetchLatestHarnessVersion,
      }),
    ).toEqual([{ harness: "codex", installed: "0.160.0", latest: "0.160.1" }]);
  });

  it("reports only harnesses behind the published release", async () => {
    expect(await find(["claude", "codex", "opencode"])).toEqual([
      {
        harness: "claude",
        installed: "2.1.284",
        latest: "2.1.285",
      },
      {
        harness: "opencode",
        installed: "1.18.31",
        latest: "1.18.33",
      },
    ]);
  });

  it("skips harnesses without a version feed or whose lookup fails", async () => {
    expect(await find(["cursor", "pi"])).toEqual([]);
  });

  it("offers a harness still behind again, at the newest release", async () => {
    expect(await find(["claude"])).toMatchObject([{ latest: "2.1.285" }]);

    LATEST.claude = "2.1.286";
    try {
      expect(await find(["claude"])).toMatchObject([
        { harness: "claude", installed: "2.1.284", latest: "2.1.286" },
      ]);
    } finally {
      LATEST.claude = "2.1.285";
    }
  });
});

it("delivers updates to other windows while skipping the sender and respecting cleanup", async () => {
  // A fresh module instance represents another window's separate JS runtime.
  vi.resetModules();
  const otherWindow = await import("./harnessUpdates");
  const localRefresh = vi.fn();
  const remoteRefresh = vi.fn();
  const stopLocal = await onHarnessUpdated(localRefresh);
  const stopRemote = await otherWindow.onHarnessUpdated(remoteRefresh);
  try {
    await announceHarnessUpdated("claude");
    expect(localRefresh).not.toHaveBeenCalled();
    expect(remoteRefresh).toHaveBeenCalledExactlyOnceWith("claude");

    await otherWindow.announceHarnessUpdated("codex");
    expect(localRefresh).toHaveBeenCalledExactlyOnceWith("codex");
    expect(remoteRefresh).toHaveBeenCalledTimes(1);

    stopLocal();
    await otherWindow.announceHarnessUpdated("opencode");
    expect(localRefresh).toHaveBeenCalledTimes(1);
    expect(remoteRefresh).toHaveBeenCalledTimes(1);
  } finally {
    stopLocal();
    stopRemote();
  }
});
