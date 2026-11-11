extends Node2D
class_name WorldRect

@export var size := Vector2(100, 40)
@export var color := Color.WHITE
@export var offset := Vector2.ZERO

func _ready() -> void:
	queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(offset, size), color)
