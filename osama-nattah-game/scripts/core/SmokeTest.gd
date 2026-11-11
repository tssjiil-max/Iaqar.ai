extends SceneTree

func _initialize() -> void:
	var err := change_scene_to_file("res://scenes/levels/Level01_Doorbell.tscn")
	if err != OK:
		push_error("Failed to load level: %s" % error_string(err))
		quit(1)
		return
	call_deferred("_run_test")

func _run_test() -> void:
	await create_timer(2.5).timeout
	quit(0)
