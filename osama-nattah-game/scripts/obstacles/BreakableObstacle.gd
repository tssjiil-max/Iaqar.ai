extends StaticBody2D

@export var breakable := true
@export var pushable := false
var health := 1

func _ready() -> void:
	add_to_group("breakable")
	if pushable:
		add_to_group("headbutt_target")

func on_punched(_player: PlayerController, power: float) -> void:
	_damage(power)

func on_kicked(_player: PlayerController, power: float) -> void:
	_damage(power * 1.2)
	if pushable:
		position.x += 80.0 * sign(_player.facing)

func on_headbutted(_sheep: SheepController) -> void:
	_damage(1.5)

func _damage(amount: float) -> void:
	if not breakable:
		return
	health -= int(ceil(amount))
	if health <= 0:
		GameManager.add_score(25, "target_hit")
		queue_free()
