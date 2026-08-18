extends Node2D
class_name NattahWhiteSheepSprite

## نطّاح — خروف أبيض صغير لطيف.

var mood := "idle" # idle, eat, scared, run

func set_color(_color: Color) -> void:
	queue_redraw()

func set_mood(new_mood: String) -> void:
	mood = new_mood
	queue_redraw()

func _draw() -> void:
	var wool := Color(0.98, 0.98, 1.0)
	var wool_shadow := Color(0.88, 0.88, 0.92)
	var nose := Color(0.95, 0.7, 0.75)
	var eye := Color(0.15, 0.15, 0.2)

	if mood == "eat":
		# رأس منخفض يأكل
		draw_circle(Vector2(0, -6), 12, wool)
		draw_circle(Vector2(-8, -4), 7, wool_shadow)
		draw_circle(Vector2(8, -4), 7, wool_shadow)
		draw_circle(Vector2(6, -2), 2, nose)
		return

	# جسم أبيض صغير
	draw_circle(Vector2(0, -10), 13, wool)
	draw_circle(Vector2(-10, -8), 8, wool)
	draw_circle(Vector2(10, -8), 8, wool)
	draw_circle(Vector2(0, -2), 10, wool_shadow)
	# رأس
	draw_circle(Vector2(0, -20), 9, wool)
	# أذنان
	draw_ellipse(Vector2(-8, -24), 4, 6, wool)
	draw_ellipse(Vector2(8, -24), 4, 6, wool)
	# عيون
	if mood == "scared":
		draw_circle(Vector2(-4, -21), 3, Color.WHITE)
		draw_circle(Vector2(4, -21), 3, Color.WHITE)
		draw_circle(Vector2(-4, -21), 1.5, eye)
		draw_circle(Vector2(4, -21), 1.5, eye)
	else:
		draw_circle(Vector2(-3, -21), 2.5, eye)
		draw_circle(Vector2(3, -21), 2.5, eye)
	draw_circle(Vector2(0, -17), 2, nose)
	# ساقان قصيرتان
	draw_rect(Rect2(-6, 0, 4, 6), wool_shadow)
	draw_rect(Rect2(2, 0, 4, 6), wool_shadow)

func draw_ellipse(center: Vector2, rx: float, ry: float, col: Color) -> void:
	var pts := PackedVector2Array()
	for i in range(16):
		var a := TAU * float(i) / 16.0
		pts.append(center + Vector2(cos(a) * rx, sin(a) * ry))
	draw_colored_polygon(pts, col)
