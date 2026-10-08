import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { execChild, hasHeadlessChildBackend } from "../../../integrations/harness/core/child";
import { discoverOpenCodeModels } from "../../../integrations/harness/providers/opencode/opencodeCatalog";
import {
  gatewayModel,
  gatewayProfileId,
  listGatewayProfiles,
  type GatewayProfile,
} from "./gatewayProfiles";
import {
  resetHarnessModelOverlays,
  resolveModel,
  setHarnessModels,
} from "../../sessions/model/models";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../integrations/harness/core/child", () => ({
  execChild: vi.fn(),
  hasHeadlessChildBackend: vi.fn(),
  resolveOpenCodeBinary: async () => ({ path: "/fake/opencode" }),
}));

const profile: GatewayProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Coding",
  endpoint: "http://localhost:20128/v1",
  model: "my/combo",
  contextWindow: 128000,
  maxOutputTokens: 16000,
};

describe("OpenCode catalog discovery", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(hasHeadlessChildBackend).mockReset().mockReturnValue(false);
    vi.mocked(execChild)
      .mockReset()
      .mockResolvedValue("")
      .mockResolvedValueOnce("1.18.35")
      .mockResolvedValueOnce('openai/direct\n{"id":"direct","name":"Direct"}');
  });

  it("discovers headless CLI models without a Tauri window", async () => {
    vi.mocked(hasHeadlessChildBackend).mockReturnValue(true);
    vi.mocked(invoke).mockRejectedValue(new Error("Tauri unavailable"));
    expect((await discoverOpenCodeModels("/repo")).map((model) => model.id))
      .toEqual(["opencode:openai/direct"]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([false, true])("loads saved desktop gateway models when CLI discovery fails: %s", async (cliFails) => {
    vi.mocked(invoke).mockResolvedValue([profile]);
    if (cliFails) {
      vi.mocked(execChild)
        .mockReset()
        .mockResolvedValueOnce("1.18.35")
        .mockRejectedValueOnce(new Error("CLI unavailable"))
        .mockResolvedValue("");
    }
    expect(await discoverOpenCodeModels("/repo")).toEqual(
      cliFails
        ? [gatewayModel(profile)]
        : [expect.objectContaining({ id: "opencode:openai/direct" }), gatewayModel(profile)],
    );
    expect(invoke).toHaveBeenCalledWith("gateway_profiles");
  });

  it("does not fall back to direct models when desktop profile IPC fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Profile IPC failed"));
    await expect(discoverOpenCodeModels("/repo")).rejects.toThrow("Profile IPC failed");
    expect(execChild).toHaveBeenCalledTimes(1);
  });
});

describe("gateway profile routing", () => {
  it("keeps combo and immutable profile reference in the normal OpenCode model ID", () => {
    const model = gatewayModel(profile);
    expect(model.id).toBe(`opencode:luxecode-${profile.id}/my/combo`);
    expect(model.contextWindow).toBe(128000);
    expect(gatewayProfileId(model.id)).toBe(profile.id);
    expect(gatewayProfileId(model.nativeId!)).toBe(profile.id);
    expect(gatewayProfileId("opencode:openai/gpt-6.1-sol")).toBeUndefined();
    expect(() => gatewayProfileId("opencode:luxecode-../../bad/combo")).toThrow(
      "No direct fallback",
    );
  });

  it("never restores a missing gateway model as a direct model", () => {
    const model = gatewayModel(profile);
    setHarnessModels("opencode", [
      { id: "opencode:openai/direct", harness: "opencode", name: "Direct" },
    ]);
    try {
      expect(resolveModel("opencode", model.id).id).toBe(model.id);
    } finally {
      resetHarnessModelOverlays();
    }
  });

  it.each(["opencode:luxecode/PER", "luxecode/PER"])(
    "retains legacy POC route %s and requires migration instead of direct fallback",
    (savedId) => {
      setHarnessModels("opencode", [
        { id: "opencode:openai/direct", harness: "opencode", name: "Direct" },
      ]);
      try {
        const model = resolveModel("opencode", savedId);
        expect(model.id).toBe("opencode:luxecode/PER");
        expect(() => gatewayProfileId(model.id)).toThrow("Legacy POC");
        expect(() => gatewayProfileId("luxecode/PER")).toThrow(
          "No direct fallback",
        );
      } finally {
        resetHarnessModelOverlays();
      }
    },
  );

  it("never fuzzy-matches a missing gateway profile to another route", () => {
    const model = gatewayModel(profile);
    setHarnessModels("opencode", [
      { id: "opencode:luxecode", harness: "opencode", name: "Other route" },
    ]);
    try {
      expect(resolveModel("opencode", model.id).id).toBe(model.id);
    } finally {
      resetHarnessModelOverlays();
    }
  });

  it("loads only non-secret native profile metadata", async () => {
    vi.mocked(invoke).mockResolvedValue([profile]);
    expect(await listGatewayProfiles()).toEqual([profile]);
    expect(invoke).toHaveBeenCalledWith("gateway_profiles");
    expect(JSON.stringify(profile)).not.toContain("apiKey");
  });
});
