extends Node2D

func _draw() -> void:
	draw_circle(Vector2(0, 0), 8, Color(0.85, 0.55, 0.25))
	draw_circle(Vector2(-6, -4), 3, Color(0.85, 0.55, 0.25))
	draw_circle(Vector2(6, -4), 3, Color(0.85, 0.55, 0.25))
	draw_line(Vector2(-4, 2), Vector2(-2, 5), Color(0.7, 0.4, 0.2), 1.5)
	draw_line(Vector2(4, 2), Vector2(2, 5), Color(0.7, 0.4, 0.2), 1.5)
	draw_circle(Vector2(-2, -2), 1.2, Color(0.1, 0.1, 0.1))
	draw_circle(Vector2(2, -2), 1.2, Color(0.1, 0.1, 0.1))
