extends CharacterBody2D

@export var move_distance := 120.0
@export var move_speed := 140.0
var origin_x := 0.0
var direction := 1.0

func _ready() -> void:
	add_to_group("obstacle")
	origin_x = position.x

func _physics_process(delta: float) -> void:
	position.x += direction * move_speed * delta
	if position.x > origin_x + move_distance:
		direction = -1.0
	elif position.x < origin_x - move_distance:
		direction = 1.0

func on_kicked(player: PlayerController, power: float) -> void:
	velocity.x = player.facing * 200.0 * power
