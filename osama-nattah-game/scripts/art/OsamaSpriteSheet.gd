extends Sprite2D
class_name OsamaSpriteSheet

func set_mood(mood: String) -> void:
	match mood:
		"scared", "run":
			modulate = Color(1.05, 0.95, 0.95)
		"look":
			modulate = Color(1.0, 1.0, 0.95)
		_:
			modulate = Color.WHITE

func set_colors(_body: Color, _accent: Color = Color.TRANSPARENT) -> void:
	pass
