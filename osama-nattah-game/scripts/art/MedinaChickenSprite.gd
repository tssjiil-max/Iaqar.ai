extends Node2D

var running := false

func _ready() -> void:
	running = get_meta("state", "idle") == "run"

func _process(delta: float) -> void:
	if running:
		position.x += 80.0 * delta
		queue_redraw()

func _draw() -> void:
	draw_circle(Vector2(0, -8), 7, Color(0.95, 0.9, 0.85))
	draw_circle(Vector2(0, -14), 5, Color(0.95, 0.9, 0.85))
	draw_polygon(PackedVector2Array([Vector2(-4, -18), Vector2(-2, -22), Vector2(0, -18)]), [Color(0.9, 0.5, 0.2)])
	draw_polygon(PackedVector2Array([Vector2(4, -18), Vector2(2, -22), Vector2(0, -18)]), [Color(0.9, 0.5, 0.2)])
	draw_circle(Vector2(-2, -14), 1, Color(0.1, 0.1, 0.1))
	draw_circle(Vector2(2, -14), 1, Color(0.1, 0.1, 0.1))
	draw_line(Vector2(-3, -10), Vector2(-1, -9), Color(0.8, 0.4, 0.1), 1)
	draw_line(Vector2(3, -10), Vector2(1, -9), Color(0.8, 0.4, 0.1), 1)
