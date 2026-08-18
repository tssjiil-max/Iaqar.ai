@tool
extends EditorScript

func _run() -> void:
	var err := EditorInterface.install_android_build_template()
	print("INSTALL_TEMPLATE:", err)
	var preset = _find_android_preset()
	if preset == null:
		print("NO_ANDROID_PRESET")
		return
	var platform = preset.get_platform()
	var warnings: PackedStringArray = platform.get_export_option_warning_messages(preset)
	print("WARNINGS:", warnings.size())
	for w in warnings:
		print("WARN:", w)
	var path := "/workspace/osama-nattah-game/build/osama-nattah.apk"
	var code := EditorInterface.export_preset(preset, path)
	print("EXPORT_CODE:", code)

func _find_android_preset():
	for i in EditorInterface.get_export_preset_count():
		var p = EditorInterface.get_export_preset(i)
		if p and p.platform and p.platform.get_name() == "Android":
			return p
	return null
