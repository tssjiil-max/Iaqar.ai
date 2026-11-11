extends StaticBody2D

func _ready() -> void:
	add_to_group("obstacle")

func on_kicked(_player: PlayerController, _power: float) -> void:
	pass
