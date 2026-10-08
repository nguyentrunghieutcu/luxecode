import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("LuxeCode fork identity", () => {
  it("keeps app data and installers separate from MonoCode", () => {
    const configuration = JSON.parse(source("src-tauri/tauri.conf.json"));
    expect(configuration.productName).toBe("LuxeCode");
    expect(configuration.identifier).toBe("com.luxecode.desktop");
    expect(source("src-tauri/src/macos.rs")).not.toContain(
      "com.monocode.desktop",
    );
    expect(source("host/service.ts")).toContain("com.luxecode.host");
    expect(source("host/cli.ts")).toContain(".luxecode-host");
  });

  it("uses its own host downloads and release artifacts", () => {
    expect(source("src-tauri/src/remote_ssh.rs")).toContain(
      "github.com/nguyentrunghieutcu/luxecode/releases/download",
    );
    expect(source("src-tauri/src/remote_ssh.rs")).not.toContain(
      "github.com/hardbeat920/monocode/releases",
    );
    expect(source("src/app/model/updater.ts")).toContain(
      "github.com/nguyentrunghieutcu/luxecode/releases/latest",
    );
    expect(source(".github/workflows/release.yml")).not.toContain(
      "MonoCode.app",
    );
    expect(source(".github/workflows/release.yml")).toContain("LuxeCode.app");
  });

  it("preserves storage keys and database names inside the isolated data directory", () => {
    expect(source("src-tauri/src/session_store.rs")).toContain(
      'join("monocode.db")',
    );
    expect(source("index.html")).toContain('"monocode.themeHue"');
  });

  it("uses LuxeCode on secondary windows, tray and notifications", () => {
    for (const [path, label] of [
      ["src-tauri/src/tray.rs", '"Show LuxeCode"'],
      ["src-tauri/src/notifications.rs", '.appname("LuxeCode")'],
      ["src-tauri/src/notifications.rs", '.icon("luxecode")'],
      ["src-tauri/src/quick_composer.rs", '.title("LuxeCode")'],
      ["src/app/model/releaseNotes.ts", "What's new in LuxeCode"],
      ["src/features/files/ui/FilePicker.tsx", '"Reload LuxeCode"'],
    ]) {
      expect(source(path)).toContain(label);
    }
  });

  it("ships matching PNG artwork and a complete macOS icon", () => {
    for (const [path, size] of [
      ["public/luxecode.png", 256],
      ["public/luxecode-logo.png", 1024],
      ["src-tauri/macos/AppIcon.icon/Assets/icon.png", 1024],
      ["src-tauri/icons/32x32.png", 32],
      ["src-tauri/icons/128x128.png", 128],
      ["src-tauri/icons/128x128@2x.png", 256],
    ] as const) {
      const image = readFileSync(path);
      expect(image.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(image.readUInt32BE(16)).toBe(size);
      expect(image.readUInt32BE(20)).toBe(size);
      if (path.startsWith("src-tauri/icons/")) {
        expect(image[25]).toBe(6);
      }
    }
    expect(readFileSync("public/luxecode.png")).toEqual(
      readFileSync("src-tauri/icons/128x128@2x.png"),
    );
    const icon = readFileSync("src-tauri/icons/icon.icns");
    expect(icon.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icon.readUInt32BE(4)).toBe(icon.length);
  });
});
