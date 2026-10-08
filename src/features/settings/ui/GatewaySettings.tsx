import { useEffect, useRef, useState, type FormEvent } from "react";
import { inspectHarnessBinary } from "../../../integrations/harness/core/child";
import { probeHarnessAvailability } from "../../../integrations/harness/core/availability";
import { refreshHarnessCatalogs } from "../../../integrations/harness/core/registry";
import {
  compareSemver,
  parseOpenCodeVersion,
} from "../../../integrations/harness/providers/opencode/opencodeProtocol";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { saveLastModelChoice } from "../../sessions/model/models";
import {
  createGatewayProfile,
  MINIMUM_GATEWAY_OPENCODE_VERSION,
  gatewayModel,
  listGatewayProfiles,
  rotateGatewayKey,
  testGatewayConnection,
  type GatewayCatalogModel,
  type GatewayProfile,
} from "../../providers/model/gatewayProfiles";

const inputClass =
  "h-8 w-full rounded-md border border-content/10 bg-content/[0.04] px-2 text-[12px] text-content outline-none focus:border-accent/45 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40";
const rowClass =
  "settings-row flex items-start gap-6 border-b border-content/5 px-4 py-3.5 last:border-b-0";
const controlClass =
  "settings-row-control flex min-w-0 w-80 max-w-[60%] shrink-0 items-center justify-end gap-2";

export function GatewaySettings() {
  const [profiles, setProfiles] = useState<GatewayProfile[]>([]);
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:20128/v1");
  const [name, setName] = useState("9router");
  const [catalog, setCatalog] = useState<GatewayCatalogModel[]>([]);
  const [model, setModel] = useState("");
  const [contextWindow, setContextWindow] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState("");
  const [engine, setEngine] = useState("Checking OpenCode…");
  const [engineReady, setEngineReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const key = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  async function checkEngine() {
    try {
      const inspected = await inspectHarnessBinary("opencode");
      const version = parseOpenCodeVersion(inspected.version ?? "");
      const ready =
        !!version &&
        compareSemver(version, MINIMUM_GATEWAY_OPENCODE_VERSION) >= 0;
      if (!alive.current) return;
      setEngineReady(ready);
      setEngine(
        ready
          ? `OpenCode ${version} · ${inspected.path}`
          : `OpenCode ${MINIMUM_GATEWAY_OPENCODE_VERSION}+ required for gateway isolation. Install or upgrade OpenCode, then recheck. ${inspected.error ?? ""}`,
      );
      await probeHarnessAvailability();
    } catch {
      if (!alive.current) return;
      setEngineReady(false);
      setEngine(
        `OpenCode ${MINIMUM_GATEWAY_OPENCODE_VERSION}+ is not installed. Install OpenCode, then recheck or set its CLI path below.`,
      );
    }
  }

  useEffect(() => {
    alive.current = true;
    void listGatewayProfiles()
      .then((saved) => {
        if (alive.current) setProfiles(saved);
      })
      .catch((reason: unknown) => {
        if (alive.current) setError(String(reason));
      });
    void checkEngine();
    return () => {
      alive.current = false;
      if (key.current) key.current.value = "";
    };
  }, []);

  function selectModel(id: string, models = catalog) {
    setModel(id);
    const selected = models.find((entry) => entry.id === id);
    setContextWindow(
      selected?.contextWindow ? String(selected.contextWindow) : "",
    );
    setMaxOutputTokens(
      selected?.maxOutputTokens ? String(selected.maxOutputTokens) : "",
    );
  }

  async function testConnection() {
    setBusy(true);
    setError("");
    setNotice("");
    setCatalog([]);
    try {
      const models = await testGatewayConnection(
        endpoint,
        key.current?.value ?? "",
      );
      if (!alive.current) return;
      setCatalog(models);
      selectModel(models[0]?.id ?? "", models);
      setNotice(
        "Authenticated connection verified. Select a model/combo and confirm its conservative token limits before saving.",
      );
    } catch (reason) {
      if (alive.current) setError(String(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function useProfile(profile: GatewayProfile) {
    await refreshHarnessCatalogs(["opencode"], { force: true });
    saveLastModelChoice("opencode", gatewayModel(profile).id);
    if (alive.current)
      setNotice(
        `${profile.name} · ${profile.model} selected for new OpenCode conversations. Existing sessions keep their connection.`,
      );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const context = Number(contextWindow);
    const output = Number(maxOutputTokens);
    if (
      !Number.isSafeInteger(context) ||
      !Number.isSafeInteger(output) ||
      output < 1 ||
      context < output ||
      context > 10_000_000
    ) {
      setError(
        "Enter verified positive token limits: output must not exceed context, and context must not exceed 10,000,000.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const pending = createGatewayProfile(
        name,
        { endpoint, model, contextWindow: context, maxOutputTokens: output },
        key.current?.value ?? "",
      );
      if (key.current) key.current.value = "";
      const profile = await pending;
      if (!alive.current) return;
      setProfiles((saved) => [...saved, profile]);
      setCatalog([]);
      setModel("");
      await useProfile(profile);
    } catch (reason) {
      if (alive.current) setError(String(reason));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="9router gateway">
      <div className={rowClass}>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-content">
            OpenCode engine
          </h3>
          <p
            className="mt-1 break-all text-[12px] leading-relaxed text-content/45"
            role="status"
          >
            {engine}
          </p>
        </div>
        <div className="settings-row-control flex min-w-0 max-w-[60%] shrink-0 items-center justify-end gap-2">
          <SecondaryButton disabled={busy} onClick={() => void checkEngine()}>
            Recheck OpenCode
          </SecondaryButton>
        </div>
      </div>
      {profiles.map((profile) => (
        <GatewayProfileCard
          key={profile.id}
          profile={profile}
          onUse={() => useProfile(profile)}
        />
      ))}
      <form
        onSubmit={(event) => void save(event)}
        className="border-b border-content/5"
      >
        <h3 className="border-b border-content/5 px-4 py-3.5 text-[13px] font-medium text-content">
          New gateway connection
        </h3>
        <label className={rowClass}>
          <span className="min-w-0 flex-1 text-[13px] font-medium text-content">
            Connection name
          </span>
          <span className={controlClass}>
            <input
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={100}
              disabled={busy}
            />
          </span>
        </label>
        <label className={rowClass}>
          <span className="min-w-0 flex-1 text-[13px] font-medium text-content">
            9router endpoint
          </span>
          <span className={controlClass}>
            <input
              className={inputClass}
              value={endpoint}
              onChange={(event) => {
                setEndpoint(event.target.value);
                setCatalog([]);
                setModel("");
              }}
              required
              spellCheck={false}
              disabled={busy}
            />
          </span>
        </label>
        <label className={rowClass}>
          <span className="min-w-0 flex-1 text-[13px] font-medium text-content">
            Gateway API key
          </span>
          <span className={controlClass}>
            <input
              ref={key}
              className={inputClass}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              disabled={busy}
              onChange={() => {
                setCatalog([]);
                setModel("");
              }}
            />
          </span>
        </label>
        <div className="space-y-3 px-4 py-3.5">
          <p className="text-pretty text-[12px] leading-relaxed text-content/45">
            Saved only in macOS Keychain, never in transcripts or exports. HTTP
            is allowed only on loopback; remote endpoints require HTTPS.
            Connection testing does not request model inference.
          </p>
          <SecondaryButton
            disabled={busy || !endpoint}
            onClick={() => void testConnection()}
          >
            {busy ? "Working…" : "Test connection & load models/combos"}
          </SecondaryButton>
        </div>
        {catalog.length > 0 ? (
          <>
            <label className={rowClass}>
              <span className="min-w-0 flex-1 text-[13px] font-medium text-content">
                Requested model/combo
              </span>
              <span className={controlClass}>
                <select
                  className={inputClass}
                  value={model}
                  onChange={(event) => selectModel(event.target.value)}
                  disabled={busy}
                  required
                >
                  {catalog.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.isCombo ? "Combo · " : ""}
                      {entry.id}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label className={rowClass}>
              <span className="min-w-0 flex-1 text-[13px] font-medium text-content">
                Verified context limit
              </span>
              <span className={controlClass}>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  max={10_000_000}
                  value={contextWindow}
                  onChange={(event) => setContextWindow(event.target.value)}
                  disabled={busy}
                  required
                />
              </span>
            </label>
            <label className={rowClass}>
              <span className="min-w-0 flex-1 text-[13px] font-medium text-content">
                Verified output limit
              </span>
              <span className={controlClass}>
                <input
                  className={inputClass}
                  type="number"
                  min={1}
                  value={maxOutputTokens}
                  onChange={(event) => setMaxOutputTokens(event.target.value)}
                  disabled={busy}
                  required
                />
              </span>
            </label>
            <div className="space-y-3 px-4 py-3.5">
              <p className="text-pretty text-[12px] leading-relaxed text-content/45">
                For a combo, use limits safe for every possible route. The combo
                name does not identify the actual upstream model, usage or cost.
              </p>
              <SecondaryButton
                type="submit"
                disabled={busy || !engineReady || !model}
              >
                Save & use through OpenCode
              </SecondaryButton>
            </div>
          </>
        ) : null}
      </form>
      {error ? (
        <p
          role="alert"
          className="px-4 pt-3.5 text-[12px] leading-relaxed text-red-400"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="px-4 pt-3.5 text-[12px] leading-relaxed text-content/70"
        >
          {notice}
        </p>
      ) : null}
      <p className="px-4 py-3.5 text-pretty text-[12px] leading-relaxed text-content/45">
        Saved endpoints, models and limits are immutable so sessions can restore
        the same connection. Add another connection to change them. Other
        OpenCode models remain direct; choose one for a new direct conversation.
        Profiles are local-only in this MVP.
      </p>
    </div>
  );
}

function GatewayProfileCard({
  profile,
  onUse,
}: {
  profile: GatewayProfile;
  onUse: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function rotate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const replacement = String(new FormData(form).get("key") ?? "");
    form.reset();
    setBusy(true);
    try {
      await rotateGatewayKey(profile.id, replacement);
      setStatus(
        "Key replaced in macOS Keychain. Restart the app or session to use the new key; running engines keep their current key.",
      );
    } catch (reason) {
      setStatus(String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article
      className="space-y-3 border-b border-content/5 px-4 py-3.5"
      aria-label={`Gateway connection ${profile.name}`}
    >
      <h3 className="text-[13px] font-medium text-content">
        {profile.name} · Gateway
      </h3>
      <p className="break-all text-[12px] leading-relaxed text-content/45 tabular-nums">
        {profile.endpoint} · Requested: {profile.model} · Context{" "}
        {profile.contextWindow.toLocaleString()} / output{" "}
        {profile.maxOutputTokens.toLocaleString()}
      </p>
      <SecondaryButton
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void onUse()
            .catch((reason: unknown) => setStatus(String(reason)))
            .finally(() => setBusy(false));
        }}
      >
        Use for new conversations
      </SecondaryButton>
      <form
        onSubmit={(event) => void rotate(event)}
        className="flex flex-wrap items-end gap-2"
      >
        <label className="min-w-0 flex-1 space-y-1 text-[12px] text-content/70">
          Replacement API key
          <input
            name="key"
            type="password"
            className={inputClass}
            autoComplete="new-password"
            required
            disabled={busy}
          />
        </label>
        <SecondaryButton type="submit" disabled={busy}>
          Replace key
        </SecondaryButton>
      </form>
      {status ? (
        <p role="status" className="text-[12px] text-content/70">
          {status}
        </p>
      ) : null}
    </article>
  );
}
