import { invoke } from "@tauri-apps/api/core";
import type { AgentModel } from "../../sessions/model/models";

export const MINIMUM_GATEWAY_OPENCODE_VERSION = "1.18.35";

export type GatewayConnection = {
  endpoint: string;
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
};

export type GatewayProfile = GatewayConnection & { id: string; name: string };

export type GatewayCatalogModel = {
  id: string;
  name: string;
  isCombo: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
};

export async function listGatewayProfiles(): Promise<GatewayProfile[]> {
  const profiles = await invoke<GatewayProfile[]>("gateway_profiles");
  return Array.isArray(profiles) ? profiles : [];
}

export function testGatewayConnection(
  endpoint: string,
  key: string,
): Promise<GatewayCatalogModel[]> {
  return invoke("gateway_test", { endpoint, key });
}

export function createGatewayProfile(
  name: string,
  connection: GatewayConnection,
  key: string,
): Promise<GatewayProfile> {
  return invoke("gateway_create", { name, connection, key });
}

export function rotateGatewayKey(
  profileId: string,
  key: string,
): Promise<void> {
  return invoke("gateway_rotate_key", { profileId, key });
}

export function gatewayModel(profile: GatewayProfile): AgentModel {
  const providerId = `luxecode-${profile.id}`;
  const nativeId = `${providerId}/${profile.model}`;
  return {
    id: `opencode:${nativeId}`,
    harness: "opencode",
    name: `${profile.name} · ${profile.model}`,
    nativeId,
    provider: { id: providerId, name: `9router · ${profile.name}` },
    contextWindow: profile.contextWindow,
  };
}

export function gatewayProfileId(model: string): string | undefined {
  const nativeId = model.replace(/^opencode:/, "");
  if (nativeId.startsWith("luxecode/"))
    throw new Error(
      "Legacy POC connection; create and select a gateway connection in Settings → Providers, then start a new conversation. No direct fallback.",
    );
  if (!nativeId.startsWith("luxecode-")) return undefined;
  const match =
    /^luxecode-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/.+$/i.exec(
      nativeId,
    );
  if (!match)
    throw new Error(
      "Invalid gateway model/profile; reselect a connection in Settings → Providers. No direct fallback.",
    );
  return match[1];
}
