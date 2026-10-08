// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerRunner } from "./ComposerRunner";
import { EXIT_MS, STAR_COUNT } from "../model/composerRunner";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps animating through transcript changes without measuring layout each frame", () => {
  const runner = mountRunner();
  try {
    for (let i = 1; i <= 5; i++) {
      runner.box.append(document.createElement("span"));
      runner.frame();
    }
    expect(runner.measure).toHaveBeenCalledOnce();
    runner.frame(40);
    expect(runner.measure).toHaveBeenCalledTimes(2);
  } finally {
    runner.unmount();
  }
});

function mountRunner(
  reduced = false,
  initiallyEnabled = true,
  initiallyHidden = false,
) {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
  let now = 1000;
  let hidden = initiallyHidden;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const box = document.createElement("div");
  const measure = vi.spyOn(box, "getBoundingClientRect").mockReturnValue({
    left: 20,
    right: 320,
    top: 400,
    bottom: 480,
    width: 300,
    height: 80,
  } as DOMRect);
  const host = document.createElement("div");
  document.body.append(box, host);
  const root = createRoot(host);
  const boxRef = { current: box };
  const onExited = vi.fn();
  const render = (busy = true, enabled = true) => {
    act(() =>
      root.render(
        createElement(ComposerRunner, {
          boxRef,
          cwd: "/work/project",
          busy,
          enabled,
          onExited,
        }),
      ),
    );
  };
  render(true, initiallyEnabled);
  const layer = document.body.lastElementChild as HTMLDivElement;
  const sprite = layer.children[1] as HTMLDivElement;
  return {
    box,
    frames,
    request,
    measure,
    onExited,
    layer,
    sprite,
    render,
    frame(elapsed = 16) {
      now += elapsed;
      const pending = [...frames.values()];
      frames.clear();
      act(() => pending.forEach((callback) => callback(now)));
    },
    advance(elapsed: number) {
      now += elapsed;
      act(() => vi.advanceTimersByTime(elapsed));
    },
    visibility(value: boolean) {
      hidden = value;
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    },
    unmount() {
      act(() => root.unmount());
      host.remove();
      box.remove();
    },
  };
}

it.each(["disabled", "hidden"] as const)(
  "pauses while %s and resumes without resetting the runner",
  (mode) => {
    const runner = mountRunner();
    try {
      runner.frame(10000);
      const x = runner.sprite.style.getPropertyValue("--runner-x");
      const coin = runner.layer.children[0].firstElementChild;
      const stars = [...runner.layer.children[2].children];
      expect(coin).not.toBeNull();
      expect(stars).toHaveLength(STAR_COUNT);
      const pause = () =>
        mode === "disabled"
          ? runner.render(true, false)
          : runner.visibility(true);
      const resume = () =>
        mode === "disabled" ? runner.render() : runner.visibility(false);
      pause();
      expect(runner.layer.style.visibility).toBe("hidden");
      expect(runner.frames.size).toBe(0);
      const measurements = runner.measure.mock.calls.length;
      const requests = runner.request.mock.calls.length;
      runner.advance(10000);
      runner.frame();
      expect(runner.measure).toHaveBeenCalledTimes(measurements);
      expect(runner.request).toHaveBeenCalledTimes(requests);
      resume();
      expect(runner.layer.style.visibility).toBe("visible");
      expect(runner.frames.size).toBe(1);
      expect(runner.sprite.style.getPropertyValue("--runner-x")).toBe(x);
      expect(runner.layer.children[0].firstElementChild).toBe(coin);
      expect([...runner.layer.children[2].children]).toEqual(stars);
      resume();
      expect(runner.frames.size).toBe(1);
      runner.frame();
      expect(runner.sprite.style.getPropertyValue("--runner-x")).not.toBe(x);
      expect(runner.frames.size).toBe(1);
      pause();
      runner.render(false, mode !== "disabled");
      expect(runner.onExited).toHaveBeenCalledOnce();
      expect(runner.frames.size).toBe(0);
      expect(runner.layer.children[0].childElementCount).toBe(0);
    } finally {
      runner.unmount();
    }
    expect(runner.frames.size).toBe(0);
    expect(runner.layer.children[0].childElementCount).toBe(0);
    expect(runner.layer.children[2].childElementCount).toBe(0);
    const requests = runner.request.mock.calls.length;
    runner.visibility(false);
    expect(runner.request).toHaveBeenCalledTimes(requests);
  },
);

it.each(["disabled", "hidden"] as const)(
  "exits when busy becomes false while initially %s",
  (mode) => {
    const runner = mountRunner(false, mode !== "disabled", mode === "hidden");
    try {
      expect(runner.frames.size).toBe(0);
      expect(runner.measure).not.toHaveBeenCalled();
      runner.render(false, mode !== "disabled");
      expect(runner.onExited).toHaveBeenCalledOnce();
      expect(runner.frames.size).toBe(0);
      runner.visibility(true);
      runner.render(false, false);
      expect(runner.onExited).toHaveBeenCalledOnce();
    } finally {
      runner.unmount();
    }
  },
);

it.each(["disabled", "hidden"] as const)(
  "finishes a pending exit when %s",
  (mode) => {
    const runner = mountRunner();
    try {
      runner.frame(10000);
      runner.render(false);
      expect(runner.onExited).not.toHaveBeenCalled();
      if (mode === "disabled") runner.render(false, false);
      else runner.visibility(true);
      expect(runner.onExited).toHaveBeenCalledOnce();
      expect(runner.frames.size).toBe(0);
      expect(runner.layer.children[0].childElementCount).toBe(0);
      runner.visibility(false);
      runner.render(false);
      expect(runner.onExited).toHaveBeenCalledOnce();
      expect(runner.frames.size).toBe(0);
    } finally {
      runner.unmount();
    }
  },
);

it("preserves the visible exit animation and stops scheduling after it finishes", () => {
  const runner = mountRunner();
  try {
    runner.render(false);
    runner.frame(EXIT_MS - 1);
    expect(runner.onExited).not.toHaveBeenCalled();
    expect(runner.frames.size).toBe(1);
    runner.frame(1);
    expect(runner.onExited).toHaveBeenCalledOnce();
    expect(runner.frames.size).toBe(0);
  } finally {
    runner.unmount();
  }
});

it("cleans up an active reduced-motion timer on unmount", () => {
  const runner = mountRunner(true);
  expect(vi.getTimerCount()).toBe(1);
  runner.unmount();
  expect(vi.getTimerCount()).toBe(0);
  runner.visibility(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(runner.request).not.toHaveBeenCalled();
});

it("uses a geometry timer instead of animation frames for reduced motion", () => {
  const runner = mountRunner(true);
  try {
    expect(runner.request).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    expect(runner.measure).toHaveBeenCalledOnce();
    runner.advance(99);
    expect(runner.measure).toHaveBeenCalledOnce();
    runner.advance(1);
    expect(runner.measure).toHaveBeenCalledTimes(2);
    runner.visibility(true);
    expect(vi.getTimerCount()).toBe(0);
    runner.advance(1000);
    expect(runner.measure).toHaveBeenCalledTimes(2);
    runner.visibility(false);
    runner.visibility(false);
    expect(vi.getTimerCount()).toBe(1);
    runner.render(true, false);
    expect(vi.getTimerCount()).toBe(0);
    runner.render();
    expect(vi.getTimerCount()).toBe(1);
    runner.render(false);
    expect(runner.onExited).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(runner.request).not.toHaveBeenCalled();
  } finally {
    runner.unmount();
  }
  expect(vi.getTimerCount()).toBe(0);
});
