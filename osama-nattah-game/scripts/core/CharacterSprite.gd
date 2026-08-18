extends Node2D
class_name CharacterSprite

var body_color := Color(0.96, 0.78, 0.55)
var accent_color := Color(0.2, 0.45, 0.75)

func set_colors(body: Color, accent: Color = Color.TRANSPARENT) -> void:
	body_color = body
	if accent != Color.TRANSPARENT:
		accent_color = accent
	queue_redraw()

func _draw() -> void:
	# Simple stylized boy silhouette for Osama.
	draw_rect(Rect2(-18, -54, 36, 22), accent_color) # head wrap
	draw_circle(Vector2(0, -42), 14, body_color) # face
	draw_rect(Rect2(-16, -28, 32, 28), Color(0.85, 0.25, 0.2)) # shirt
	draw_rect(Rect2(-14, 0, 12, 18), Color(0.35, 0.3, 0.55)) # left leg
	draw_rect(Rect2(2, 0, 12, 18), Color(0.35, 0.3, 0.55)) # right leg
