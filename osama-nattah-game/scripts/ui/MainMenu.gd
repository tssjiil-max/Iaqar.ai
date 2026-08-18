extends Control

func _ready() -> void:
	AudioManager.play_music("menu")

func _on_play_pressed() -> void:
	SceneManager.go_to_level("level_01")

func _on_levels_pressed() -> void:
	$Panel/LevelsPanel.visible = true

func _on_hub_pressed() -> void:
	SceneManager.go_to_hub()

func _on_settings_pressed() -> void:
	$Panel/SettingsPanel.visible = true

func _on_close_panels() -> void:
	$Panel/LevelsPanel.visible = false
	$Panel/SettingsPanel.visible = false

func _on_level1_pressed() -> void:
	SceneManager.go_to_level("level_01")

func _on_music_slider_changed(value: float) -> void:
	SaveManager.data.settings.music_volume = value
	AudioManager.music_volume = value
	SaveManager.save_game()

func _on_sfx_slider_changed(value: float) -> void:
	SaveManager.data.settings.sfx_volume = value
	AudioManager.sfx_volume = value
	SaveManager.save_game()
