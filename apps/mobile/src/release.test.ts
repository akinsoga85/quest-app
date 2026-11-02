import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A12: the store release settings stay as reviewed (privacy labels, permissions,
// icons). Change these on purpose, with docs/store-release.md, never by accident.

const root = join(__dirname, "..");
const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8")).expo;
const eas = JSON.parse(readFileSync(join(root, "eas.json"), "utf8"));

function png(path: string) {
  const b = readFileSync(join(root, path));
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
}

describe("store release settings", () => {
  it("never tracks, and says so in the privacy manifest", () => {
    const m = app.ios.privacyManifests;
    expect(m.NSPrivacyTracking).toBe(false);
    expect(m.NSPrivacyTrackingDomains).toEqual([]);
    for (const d of m.NSPrivacyCollectedDataTypes) {
      expect(d.NSPrivacyCollectedDataTypeTracking).toBe(false);
      expect(d.NSPrivacyCollectedDataTypePurposes).toEqual(["NSPrivacyCollectedDataTypePurposeAppFunctionality"]);
    }
    expect(JSON.stringify(app)).not.toMatch(/NSUserTrackingUsageDescription|NSLocation/);
  });

  it("blocks permissions the app doesn't need on Android", () => {
    for (const p of [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.ACCESS_MEDIA_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.RECORD_AUDIO",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "com.google.android.gms.permission.AD_ID",
    ]) {
      expect(app.android.blockedPermissions).toContain(p);
    }
    expect(app.android.allowBackup).toBe(false); // sign-in tokens don't move to another phone
  });

  it("asks for the camera and photos in plain words, never the microphone", () => {
    expect(app.ios.infoPlist.NSCameraUsageDescription).toMatch(/quest/);
    expect(app.ios.infoPlist.NSPhotoLibraryUsageDescription).toMatch(/quest/);
    const camera = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-camera")[1];
    expect([camera.microphonePermission, camera.recordAudioAndroid]).toEqual([false, false]);
  });

  it("has store-ready icons", () => {
    const icon = png(app.icon);
    expect([icon.width, icon.height, icon.alpha]).toEqual([1024, 1024, false]); // the App Store refuses transparent icons
    expect(png(app.android.adaptiveIcon.foregroundImage)).toMatchObject({ width: 1024, height: 1024 });
    const notify = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-notifications")[1];
    expect(png(notify.icon)).toMatchObject({ width: 96, height: 96, alpha: true });
  });

  it("builds numbered by EAS, and submits to internal testing first", () => {
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.ios.config.usesNonExemptEncryption).toBe(false);
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(eas.submit.production.android.track).toBe("internal");
  });
});
