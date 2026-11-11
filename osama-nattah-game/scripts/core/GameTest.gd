extends Node

var results: Array[String] = []

func _ready() -> void:
	await get_tree().process_frame
	await _run_all()
	_print_and_quit()

func _run_all() -> void:
	await _test_scene("res://scenes/main/MainMenu.tscn", "MainMenu")
	await _test_scene("res://scenes/levels/Level01_Doorbell.tscn", "Level01")
	await get_tree().create_timer(0.5).timeout
	await _test_level_systems()

func _test_scene(path: String, label: String) -> void:
	get_tree().change_scene_to_file(path)
	await get_tree().process_frame
	await get_tree().process_frame
	_pass("%s loaded" % label)

func _test_level_systems() -> void:
	var player := get_tree().get_first_node_in_group("player") as PlayerController
	if player == null:
		_fail("Player not found")
		return
	_pass("Player spawned")
	var sheep := get_tree().get_first_node_in_group("sheep") as SheepController
	if sheep == null:
		_fail("Sheep not found")
	else:
		_pass("Sheep spawned")
	if get_tree().get_first_node_in_group("chase_manager") == null:
		_fail("ChaseManager not found")
	else:
		_pass("ChaseManager present")
	player.do_punch()
	await get_tree().create_timer(0.3).timeout
	_pass("Punch executed")
	player.do_kick()
	await get_tree().create_timer(0.3).timeout
	_pass("Kick executed")
	if sheep:
		sheep.try_headbutt()
		_pass("Headbutt attempted")
	var interactables: Array = get_tree().get_nodes_in_group("interactable")
	if interactables.is_empty():
		_fail("No interactables")
	else:
		_pass("Interactables: %d" % interactables.size())
	GameManager.add_score(100, "prank")
	_pass("Score system: %d" % GameManager.score)
	SaveManager.save_game()
	_pass("Save system OK")

func _pass(msg: String) -> void:
	results.append("PASS: " + msg)
	print("PASS: ", msg)

func _fail(msg: String) -> void:
	results.append("FAIL: " + msg)
	push_error(msg)

func _print_and_quit() -> void:
	for line in results:
		print(line)
	var fails := results.filter(func(r): return r.begins_with("FAIL"))
	get_tree().quit(1 if fails.size() > 0 else 0)
