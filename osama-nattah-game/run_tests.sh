#!/usr/bin/env bash
set -euo pipefail
GODOT=/workspace/godot-engine/godot
PROJECT=/workspace/osama-nattah-game
export DISPLAY=

echo "=== Import ==="
$GODOT --headless --path "$PROJECT" --import --quit

echo "=== Main Menu ==="
$GODOT --headless --path "$PROJECT" --scene res://scenes/main/MainMenu.tscn --quit-after 2

echo "=== Level 01 ==="
$GODOT --headless --path "$PROJECT" --scene res://scenes/levels/Level01_Doorbell.tscn --quit-after 3

echo "=== Hub ==="
$GODOT --headless --path "$PROJECT" --scene res://scenes/hub/YardHub.tscn --quit-after 1

echo "ALL TESTS PASSED"
