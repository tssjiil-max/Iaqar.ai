extends Node

const SAVE_PATH := "user://save_game.json"
const SAVE_VERSION := 1

var data := {
	"save_version": SAVE_VERSION,
	"player_progress": 1,
	"unlocked_levels": ["level_01"],
	"level_scores": {},
	"level_stars": {},
	"coins": 0,
	"secret_tokens": 0,
	"friendship_tokens": 0,
	"upgrades": {
		"osama_super_duration": 0,
		"osama_run_speed": 0,
		"osama_combo_duration": 0,
		"nattah_rescue_speed": 0,
		"nattah_headbutt_cooldown": 0,
		"nattah_follow_speed": 0
	},
	"yard_items": [],
	"settings": {
		"music_volume": 0.8,
		"sfx_volume": 1.0,
		"camera_shake": true
	},
	"high_combo": 1,
	"tutorial_state": {}
}

func _ready() -> void:
	load_game()

func load_game() -> void:
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var file := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if file == null:
		return
	var parsed = JSON.parse_string(file.get_as_text())
	if typeof(parsed) == TYPE_DICTIONARY:
		data.merge(parsed, true)

func save_game() -> void:
	data["save_version"] = SAVE_VERSION
	var file := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(data, "\t"))

func unlock_level(level_id: String) -> void:
	if level_id in data.unlocked_levels:
		return
	data.unlocked_levels.append(level_id)
	save_game()

func record_level_result(level_id: String, score_value: int, stars: int, secrets: int) -> void:
	data.level_scores[level_id] = max(int(data.level_scores.get(level_id, 0)), score_value)
	data.level_stars[level_id] = max(int(data.level_stars.get(level_id, 0)), stars)
	data.secret_tokens += secrets
	data.coins += score_value / 10
	data.high_combo = max(int(data.high_combo), ComboManager.best_combo)
	if stars >= 1:
		var next := _next_level(level_id)
		if next != "":
			unlock_level(next)
	save_game()

func _next_level(level_id: String) -> String:
	var order := ["level_01", "level_02", "level_03", "level_04", "level_05", "level_06", "level_07"]
	var idx := order.find(level_id)
	if idx < 0 or idx >= order.size() - 1:
		return ""
	return order[idx + 1]

func is_level_unlocked(level_id: String) -> bool:
	return level_id in data.unlocked_levels
