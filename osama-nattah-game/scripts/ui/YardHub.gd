extends Control

func _ready() -> void:
	AudioManager.play_music("menu")
	$Panel/CoinsLabel.text = "العملات: %d" % int(SaveManager.data.coins)

func _on_back_pressed() -> void:
	SceneManager.go_to_menu()

func _on_play_pressed() -> void:
	SceneManager.go_to_level("level_01")
