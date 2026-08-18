extends Sprite2D
class_name NattahSpriteSheet

func set_mood(mood: String) -> void:
	match mood:
		"eat":
			scale = Vector2(0.9, 0.9)
			modulate = Color(0.95, 0.95, 1.0)
		"scared", "run":
			modulate = Color(1.05, 1.05, 1.1)
		_:
			scale = Vector2(1, 1)
			modulate = Color.WHITE

func set_color(_color: Color) -> void:
	pass
