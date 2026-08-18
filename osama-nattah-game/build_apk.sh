#!/usr/bin/env bash
set -euo pipefail
PROJECT=/workspace/osama-nattah-game
GODOT=/workspace/godot-engine/godot
ANDROID_SDK=/workspace/android-sdk
JAVA_HOME=/workspace/jdk17
export ANDROID_HOME="$ANDROID_SDK" JAVA_HOME="$JAVA_HOME" PATH="$JAVA_HOME/bin:$ANDROID_SDK/build-tools/34.0.0:$PATH"
WORKDIR=/tmp/osama_apk_build
rm -rf "$WORKDIR" && mkdir -p "$WORKDIR/apk" "$PROJECT/build"
"$GODOT" --headless --path "$PROJECT" --export-pack "Android" "$PROJECT/build/android.zip"
unzip -qo "$PROJECT/build/android.zip" -d "$WORKDIR/assets"
cp ~/.local/share/godot/export_templates/4.3.stable/android_debug.apk "$WORKDIR/base.apk"
cd "$WORKDIR/apk" && unzip -qo "$WORKDIR/base.apk"
mkdir -p assets && cp -r "$WORKDIR/assets/"* assets/
zip -qr "$WORKDIR/unsigned.apk" .
zipalign -f 4 "$WORKDIR/unsigned.apk" "$WORKDIR/aligned.apk"
apksigner sign --ks /home/ubuntu/.local/share/godot/keystores/debug.keystore --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --out "$PROJECT/build/osama-nattah.apk" "$WORKDIR/aligned.apk"
apksigner verify "$PROJECT/build/osama-nattah.apk"
ls -lh "$PROJECT/build/osama-nattah.apk"
