extends Control

func _ready() -> void:
	GameManager.set_state(GameManager.GameState.MENU)

func _on_back_pressed() -> void:
	SceneManager.go_to_menu()
