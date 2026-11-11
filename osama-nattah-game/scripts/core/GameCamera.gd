extends Camera2D
class_name GameCamera

var shake_strength := 0.0
var target: Node2D = null
var follow_offset := Vector2(0, -80)

func shake(amount: float = 4.0) -> void:
	if not SaveManager.data.settings.camera_shake:
		return
	shake_strength = max(shake_strength, amount)

func bind_target(node: Node2D) -> void:
	target = node

func _physics_process(delta: float) -> void:
	if target and is_instance_valid(target):
		var desired := target.global_position + follow_offset
		global_position = global_position.lerp(desired, min(1.0, 8.0 * delta))
		if GameManager.chase_state:
			position.x = max(position.x, target.global_position.x - 200.0)

func _process(delta: float) -> void:
	if shake_strength > 0.0:
		offset = Vector2(randf_range(-shake_strength, shake_strength), randf_range(-shake_strength, shake_strength))
		shake_strength = move_toward(shake_strength, 0.0, 12.0 * delta)
	else:
		offset = Vector2.ZERO
