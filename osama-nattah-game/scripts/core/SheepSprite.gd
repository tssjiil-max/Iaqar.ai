extends Node2D
class_name SheepSprite

var body_color := Color(0.92, 0.92, 0.92)

func set_color(color: Color) -> void:
	body_color = color
	queue_redraw()

func _draw() -> void:
	draw_circle(Vector2(0, -10), 16, body_color)
	draw_circle(Vector2(-10, -8), 8, body_color)
	draw_circle(Vector2(10, -8), 8, body_color)
	draw_circle(Vector2(-6, -18), 5, Color(0.2, 0.2, 0.2)) # eye
	draw_circle(Vector2(6, -18), 5, Color(0.2, 0.2, 0.2))
	draw_rect(Rect2(-4, -26, 8, 10), Color(0.75, 0.75, 0.75)) # ear
