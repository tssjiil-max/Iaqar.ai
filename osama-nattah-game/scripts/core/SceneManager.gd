extends Node

const LEVELS := {
	"level_01": "res://scenes/levels/Level01_Doorbell.tscn",
	"level_02": "res://scenes/levels/Level02_Light.tscn",
	"hub": "res://scenes/hub/YardHub.tscn"
}

func go_to_menu() -> void:
	get_tree().change_scene_to_file("res://scenes/main/MainMenu.tscn")

func go_to_level(level_id: String) -> void:
	if not LEVELS.has(level_id):
		push_error("Unknown level: %s" % level_id)
		return
	GameManager.current_level = level_id
	GameManager.reset_level_state()
	get_tree().change_scene_to_file(LEVELS[level_id])

func reload_current() -> void:
	go_to_level(GameManager.current_level)

func go_to_hub() -> void:
	get_tree().change_scene_to_file(LEVELS.hub)
