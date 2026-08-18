extends Node2D

func _draw() -> void:
	draw_circle(Vector2(0, -10), 9, Color(0.4, 0.75, 0.95, 0.85))
	draw_circle(Vector2(-3, -13), 3, Color(1, 1, 1, 0.5))
	draw_circle(Vector2(4, -8), 2, Color(1, 1, 1, 0.35))
