extends Node2D
class_name HomeOwnerSprite

var angry := false

func set_angry(value: bool) -> void:
	angry = value
	queue_redraw()

func _draw() -> void:
	var skin := Color(0.88, 0.72, 0.58)
	var thobe := Color(0.92, 0.9, 0.85)
	var beard := Color(0.35, 0.28, 0.22)
	draw_rect(Rect2(-16, -8, 32, 36), thobe)
	draw_circle(Vector2(0, -28), 14, skin)
	draw_arc(Vector2(0, -22), 10, 0, PI, 10, beard, 4.0)
	if angry:
		draw_line(Vector2(-8, -32), Vector2(-4, -30), Color(0.2, 0.1, 0.1), 2.0)
		draw_line(Vector2(8, -32), Vector2(4, -30), Color(0.2, 0.1, 0.1), 2.0)
		draw_arc(Vector2(0, -24), 5, PI * 0.1, PI * 0.9, 6, Color(0.6, 0.2, 0.2), 2.0)
	else:
		draw_circle(Vector2(-5, -30), 2, Color(0.2, 0.2, 0.2))
		draw_circle(Vector2(5, -30), 2, Color(0.2, 0.2, 0.2))
