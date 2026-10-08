// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { inspectHarnessBinary } from "../../../integrations/harness/core/child";
import { saveLastModelChoice } from "../../sessions/model/models";
import { GatewaySettings } from "./GatewaySettings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../../integrations/harness/core/child", () => ({
  inspectHarnessBinary: vi.fn(),
}));
vi.mock("../../../integrations/harness/core/availability", () => ({
  probeHarnessAvailability: vi.fn(),
}));
vi.mock("../../../integrations/harness/core/registry", () => ({
  refreshHarnessCatalogs: vi.fn(async () => undefined),
}));
vi.mock("../../sessions/model/models", () => ({
  saveLastModelChoice: vi.fn(),
}));

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "9router",
  endpoint: "http://127.0.0.1:20128/v1",
  model: "coding-combo",
  contextWindow: 128000,
  maxOutputTokens: 16000,
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.mocked(inspectHarnessBinary).mockResolvedValue({
    path: "/fake/opencode",
    version: "1.18.35",
  });
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "gateway_profiles") return [];
    if (command === "gateway_test")
      return [
        {
          id: "coding-combo",
          name: "Coding",
          isCombo: true,
          contextWindow: null,
          maxOutputTokens: null,
        },
      ];
    if (command === "gateway_create") return profile;
    if (command === "gateway_rotate_key") return undefined;
    throw new Error(`Unexpected command ${command}`);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => root.render(createElement(GatewaySettings)));
}
function field(label: string): HTMLInputElement | HTMLSelectElement {
  const element = [...container.querySelectorAll("label")].find((entry) =>
    entry.textContent?.startsWith(label),
  );
  return element!.querySelector("input,select")!;
}
async function input(label: string, value: string) {
  await act(async () => {
    const element = field(label);
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      element,
      value,
    );
    field(label).dispatchEvent(new Event("input", { bubbles: true }));
    field(label).dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === text,
  )!;
  await act(async () => button.click());
}

it("tests a gateway, requires verified limits, saves the combo and clears the secret from the form", async () => {
  await mount();
  await input("Gateway API key", "test-secret");
  await click("Test connection & load models/combos");
  expect(invoke).toHaveBeenCalledWith("gateway_test", {
    endpoint: profile.endpoint,
    key: "test-secret",
  });
  expect(field("Requested model/combo").value).toBe("coding-combo");
  expect(field("Verified context limit").value).toBe("");
  await input("Verified context limit", "128000");
  await input("Verified output limit", "16000");
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(invoke).toHaveBeenCalledWith("gateway_create", {
    name: "9router",
    connection: {
      endpoint: profile.endpoint,
      model: "coding-combo",
      contextWindow: 128000,
      maxOutputTokens: 16000,
    },
    key: "test-secret",
  });
  expect(field("Gateway API key").value).toBe("");
  expect(container.textContent).not.toContain("test-secret");
  expect(saveLastModelChoice).toHaveBeenCalledWith(
    "opencode",
    `opencode:luxecode-${profile.id}/coding-combo`,
  );
});

it("shows connection errors without choosing a direct model", async () => {
  await mount();
  vi.mocked(invoke).mockRejectedValueOnce(
    "Gateway authentication failed (HTTP 401); no direct fallback",
  );
  await click("Test connection & load models/combos");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "HTTP 401",
  );
  expect(saveLastModelChoice).not.toHaveBeenCalled();
});

it("restores profile metadata and replaces the native key without changing its ID or exposing it", async () => {
  vi.mocked(invoke).mockResolvedValueOnce([profile]);
  await mount();
  await input("Replacement API key", "replacement-secret");
  const form = container.querySelector("article form")!;
  await act(async () =>
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  expect(invoke).toHaveBeenCalledWith("gateway_rotate_key", {
    profileId: profile.id,
    key: "replacement-secret",
  });
  expect(field("Replacement API key").value).toBe("");
  expect(container.textContent).toContain("Restart the app or session");
  expect(container.textContent).not.toContain("replacement-secret");
});

it("keeps onboarding explicit when OpenCode is missing", async () => {
  vi.mocked(inspectHarnessBinary).mockRejectedValue(new Error("CLI not found"));
  await mount();
  expect(container.textContent).toContain("is not installed");
  await click("Test connection & load models/combos");
  const save = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === "Save & use through OpenCode",
  )!;
  expect(save.disabled).toBe(true);
  expect(saveLastModelChoice).not.toHaveBeenCalled();
});
