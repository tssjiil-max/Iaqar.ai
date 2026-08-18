extends Resource
class_name BaseAbility

@export var ability_name: String = "ability"
@export var cooldown: float = 0.5
@export var duration: float = 0.0
@export var power: float = 1.0
@export var range_distance: float = 48.0

var owner: Node = null
var cooldown_left: float = 0.0

func setup(owner_node: Node) -> void:
	owner = owner_node

func can_use() -> bool:
	return cooldown_left <= 0.0 and owner != null

func activate() -> void:
	if not can_use():
		return
	cooldown_left = cooldown
	_on_activate()

func finish() -> void:
	_on_finish()

func tick(delta: float) -> void:
	if cooldown_left > 0.0:
		cooldown_left = max(0.0, cooldown_left - delta)

func _on_activate() -> void:
	pass

func _on_finish() -> void:
	pass
