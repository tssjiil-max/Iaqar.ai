#!/usr/bin/env bash
set -euo pipefail

PROJECT=/workspace/osama-nattah-game
GODOT=/workspace/godot-engine/godot
ANDROID_SDK=/workspace/android-sdk
JAVA_HOME=/workspace/jdk17
APKTOOL=/tmp/apktool.jar
KEYSTORE=/home/ubuntu/.local/share/godot/keystores/debug.keystore
PACKAGE_NAME="com.osamanattah.game"
APP_NAME="أسامة ونطّاح"

export ANDROID_HOME="$ANDROID_SDK" JAVA_HOME="$JAVA_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_SDK/build-tools/34.0.0:$PATH"

WORKDIR=/tmp/osama_apk_build
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR/assets" "$PROJECT/build"

echo "==> Exporting game pack..."
"$GODOT" --headless --path "$PROJECT" --export-pack "Android" "$PROJECT/build/android.zip"
unzip -qo "$PROJECT/build/android.zip" -d "$WORKDIR/assets"

echo "==> Decompiling Android template..."
java -jar "$APKTOOL" d -f -s \
  ~/.local/share/godot/export_templates/4.3.stable/android_debug.apk \
  -o "$WORKDIR/decompiled"

MANIFEST="$WORKDIR/decompiled/AndroidManifest.xml"
sed -i "s/package=\"com.godot.game\"/package=\"$PACKAGE_NAME\"/" "$MANIFEST"
sed -i "s/com.godot.game.fileprovider/$PACKAGE_NAME.fileprovider/g" "$MANIFEST"
sed -i "s/com.godot.game.androidx-startup/$PACKAGE_NAME.androidx-startup/g" "$MANIFEST"

find "$WORKDIR/decompiled/res" \( -name 'godot_project_name_string.xml' -o -name 'strings.xml' \) -print0 | while IFS= read -r -d '' file; do
  sed -i "s|>godot-project-name[^<]*<|>$APP_NAME<|g" "$file"
done

rm -rf "$WORKDIR/decompiled/lib/x86" "$WORKDIR/decompiled/lib/x86_64"

echo "==> Injecting game assets..."
mkdir -p "$WORKDIR/decompiled/assets"
cp -r "$WORKDIR/assets/"* "$WORKDIR/decompiled/assets/"

echo "==> Rebuilding APK..."
java -jar "$APKTOOL" b "$WORKDIR/decompiled" -o "$WORKDIR/unsigned.apk"

zipalign -f 4 "$WORKDIR/unsigned.apk" "$WORKDIR/aligned.apk"
apksigner sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias androiddebugkey \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "$PROJECT/build/osama-nattah.apk" \
  "$WORKDIR/aligned.apk"

apksigner verify --verbose "$PROJECT/build/osama-nattah.apk"
/workspace/android-sdk/build-tools/34.0.0/aapt dump badging "$PROJECT/build/osama-nattah.apk" | grep -E "package:|application-label"
ls -lh "$PROJECT/build/osama-nattah.apk"
