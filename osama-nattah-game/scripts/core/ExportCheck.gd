@tool
extends EditorScript

func _run() -> void:
	var preset := EditorInterface.get_editor_export_preset(0)
	if preset == null:
		print("NO_PRESET")
		return
	var platform = preset.get_platform()
	var errors: PackedStringArray = platform.get_export_option_warning_messages(preset)
	print("ERRORS_COUNT:", errors.size())
	for e in errors:
		print("ERR:", e)
