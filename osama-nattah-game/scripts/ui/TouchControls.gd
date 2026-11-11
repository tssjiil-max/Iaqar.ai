extends Control

var player: PlayerController = null
var sheep: SheepController = null

func bind_level(level: Node) -> void:
	player = level.get_tree().get_first_node_in_group("player")
	sheep = level.get_tree().get_first_node_in_group("sheep")

func _on_left_pressed() -> void:
	Input.action_press("move_left")

func _on_left_released() -> void:
	Input.action_release("move_left")

func _on_right_pressed() -> void:
	Input.action_press("move_right")

func _on_right_released() -> void:
	Input.action_release("move_right")

func _on_jump_pressed() -> void:
	Input.action_press("jump")
	Input.action_release("jump")

func _on_punch_pressed() -> void:
	if player:
		player.do_punch()

func _on_kick_pressed() -> void:
	if player:
		player.do_kick()

func _on_sheep_pressed() -> void:
	if GameManager.rescue_prompt_active and sheep:
		sheep.try_rescue()
	elif sheep:
		sheep.try_headbutt()

func _on_interact_pressed() -> void:
	if player:
		player.try_interact()
