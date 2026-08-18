extends Node2D
class_name CoinSprite

func _draw() -> void:
	draw_circle(Vector2(0, -12), 12, Color(0.95, 0.78, 0.2))
	draw_circle(Vector2(-3, -15), 4, Color(1, 0.92, 0.5, 0.6))
