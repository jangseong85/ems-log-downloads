const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withOptionalCamera(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const manifest = configWithManifest.modResults.manifest;
    manifest["uses-feature"] = manifest["uses-feature"] || [];
    const alreadyDeclared = manifest["uses-feature"].some(
      (feature) => feature.$?.["android:name"] === "android.hardware.camera",
    );

    if (!alreadyDeclared) {
      manifest["uses-feature"].push({
        $: {
          "android:name": "android.hardware.camera",
          "android:required": "false",
        },
      });
    }

    return configWithManifest;
  });
};
