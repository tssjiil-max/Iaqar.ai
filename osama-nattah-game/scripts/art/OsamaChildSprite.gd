extends Node2D
class_name OsamaChildSprite

## أسامة — طفل سعودي 7–8 سنوات، كرتوني، ليس بطل خارق.

var mood := "idle" # idle, run, look, scared

func set_mood(new_mood: String) -> void:
	mood = new_mood
	queue_redraw()

func set_colors(_body: Color, _accent: Color = Color.TRANSPARENT) -> void:
	queue_redraw()

func _draw() -> void:
	# طفل صغير — الرأس أكبر من الجسم (نسب طفولية)
	var skin := Color(0.96, 0.82, 0.68)
	var hair := Color(0.12, 0.1, 0.08)
	var thobe := Color(0.95, 0.95, 0.93)
	var ghutra := Color(0.9, 0.9, 0.9)
	var agal := Color(0.15, 0.15, 0.15)
	var sandal := Color(0.55, 0.38, 0.22)

	# صندل
	draw_rect(Rect2(-10, 2, 8, 5), sandal)
	draw_rect(Rect2(2, 2, 8, 5), sandal)
	# ثوب قصير (طفل)
	draw_rect(Rect2(-13, -22, 26, 26), thobe)
	draw_line(Vector2(-13, -22), Vector2(13, -22), Color(0.85, 0.85, 0.82), 1.0)
	# يدين صغيرتين
	draw_circle(Vector2(-14, -14), 4, skin)
	draw_circle(Vector2(14, -14), 4, skin)
	# رأس طفولي كبير
	draw_circle(Vector2(0, -34), 15, skin)
	# شعر أسود ناعم تحت الغترة
	draw_arc(Vector2(0, -36), 14, PI * 0.15, PI * 0.85, 12, hair, 3.0)
	# عينان كبيرتان
	var eye_y := -36.0
	if mood == "scared":
		draw_circle(Vector2(-6, eye_y), 4, Color.WHITE)
		draw_circle(Vector2(6, eye_y), 4, Color.WHITE)
		draw_circle(Vector2(-6, eye_y), 2, Color(0.15, 0.35, 0.65))
		draw_circle(Vector2(6, eye_y), 2, Color(0.15, 0.35, 0.65))
	elif mood == "look":
		draw_circle(Vector2(-4, eye_y), 3.5, Color.WHITE)
		draw_circle(Vector2(8, eye_y), 3.5, Color.WHITE)
		draw_circle(Vector2(-3, eye_y), 1.8, Color(0.15, 0.35, 0.65))
		draw_circle(Vector2(9, eye_y), 1.8, Color(0.15, 0.35, 0.65))
	else:
		draw_circle(Vector2(-5, eye_y), 3.5, Color.WHITE)
		draw_circle(Vector2(5, eye_y), 3.5, Color.WHITE)
		draw_circle(Vector2(-5, eye_y), 1.8, Color(0.15, 0.35, 0.65))
		draw_circle(Vector2(5, eye_y), 1.8, Color(0.15, 0.35, 0.65))
	# فم صغير
	if mood == "scared":
		draw_arc(Vector2(0, -28), 4, 0, PI, 8, Color(0.7, 0.35, 0.35), 1.5)
	else:
		draw_arc(Vector2(0, -29), 3, PI * 0.1, PI * 0.9, 6, Color(0.75, 0.45, 0.4), 1.2)
	# غترة وعقال
	draw_rect(Rect2(-16, -50, 32, 14), ghutra)
	draw_rect(Rect2(-16, -50, 32, 4), Color(0.82, 0.2, 0.2, 0.35)) # شماغ أحمر خفيف
	draw_arc(Vector2(0, -44), 16, PI, TAU, 16, agal, 2.5)
