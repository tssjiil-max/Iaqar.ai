extends Area2D

func _ready() -> void:
	add_to_group("obstacle")
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node) -> void:
	if body is PlayerController and body.is_on_floor():
		body.apply_knockback(-sign(body.velocity.x) if body.velocity.x != 0 else -1.0)
		ComboManager.register_action("near_miss")
