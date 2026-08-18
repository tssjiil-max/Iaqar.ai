extends CharacterBody2D
class_name BaseChaser

@export var speed := 360.0
@export var acceleration := 1400.0
@export var catch_distance := 42.0
@export var stumble_duration := 0.8
@export var quote: String = "يا ولد!"

@onready var label: Label = $QuoteLabel
@onready var sprite: ColorRect = $Sprite

var target: PlayerController = null
var active := false
var stumble_timer := 0.0

func _ready() -> void:
	add_to_group("chaser")

func activate(player: PlayerController) -> void:
	target = player
	active = true
	visible = true
	if label:
		label.text = quote
	AudioManager.play_sfx("chase_start")

func deactivate() -> void:
	active = false
	visible = false
	target = null

func on_headbutted(_sheep: SheepController) -> void:
	stumble_timer = stumble_duration

func on_kicked(_player: PlayerController, power: float) -> void:
	stumble_timer = stumble_duration * power

func _physics_process(delta: float) -> void:
	if not active or target == null:
		return
	if stumble_timer > 0.0:
		stumble_timer -= delta
		velocity.x = move_toward(velocity.x, 0.0, acceleration * delta)
	else:
		var dir: float = sign(target.global_position.x - global_position.x)
		var chase_speed: float = speed * GameManager.get_chaser_speed_multiplier()
		velocity.x = move_toward(velocity.x, dir * chase_speed, acceleration * delta)
	velocity.y += 1800.0 * delta
	move_and_slide()
