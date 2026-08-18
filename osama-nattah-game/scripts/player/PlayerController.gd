extends CharacterBody2D
class_name PlayerController

enum State {
	IDLE, WALK, RUN, JUMP, FALL, INTERACT, PUNCH, KICK, SLINGSHOT,
	HIT, CAUGHT, SUPER, WIN
}

@export var walk_speed := 260.0
@export var run_speed := 420.0
@export var chase_speed := 520.0
@export var acceleration := 2200.0
@export var deceleration := 2600.0
@export var jump_force := 620.0
@export var gravity := 1800.0
@export var coyote_time := 0.12
@export var jump_buffer := 0.14
@export var knockback_strength := 320.0

@onready var sprite: Node2D = $Sprite
@onready var punch_area: Area2D = $PunchArea
@onready var kick_area: Area2D = $KickArea
@onready var anim_player: AnimationPlayer = $AnimationPlayer

var current_state: State = State.IDLE
var facing := 1
var coyote_timer := 0.0
var jump_buffer_timer := 0.0
var state_timer := 0.0
var is_caught := false
var can_move := true
var sheep: Node = null

func _ready() -> void:
	add_to_group("player")
	punch_area.body_entered.connect(_on_punch_hit)
	kick_area.body_entered.connect(_on_kick_hit)
	punch_area.monitoring = false
	kick_area.monitoring = false

func bind_sheep(sheep_node: Node) -> void:
	sheep = sheep_node

func _physics_process(delta: float) -> void:
	if is_caught:
		velocity = Vector2.ZERO
		move_and_slide()
		return
	if not can_move and current_state not in [State.PUNCH, State.KICK, State.HIT]:
		velocity.x = move_toward(velocity.x, 0.0, deceleration * delta)
		if not is_on_floor():
			velocity.y += gravity * delta
		move_and_slide()
		return

	var input_dir := _get_input_axis()
	var on_floor := is_on_floor()
	if on_floor:
		coyote_timer = coyote_time
	else:
		coyote_timer = max(0.0, coyote_timer - delta)
	if Input.is_action_just_pressed("jump"):
		jump_buffer_timer = jump_buffer
	else:
		jump_buffer_timer = max(0.0, jump_buffer_timer - delta)

	match current_state:
		State.PUNCH, State.KICK, State.HIT, State.INTERACT:
			state_timer -= delta
			if state_timer <= 0.0:
				_set_state(State.IDLE if on_floor else State.FALL)
		_:
			_handle_movement(delta, input_dir)

	if jump_buffer_timer > 0.0 and coyote_timer > 0.0 and current_state not in [State.PUNCH, State.KICK, State.HIT, State.CAUGHT]:
		_do_jump()

	if not on_floor and current_state not in [State.JUMP, State.PUNCH, State.KICK, State.HIT]:
		_set_state(State.FALL)

	velocity.y += gravity * delta
	move_and_slide()
	_update_visuals()

func _handle_movement(delta: float, input_dir: float) -> void:
	var target_speed := _get_target_speed()
	var desired := input_dir * target_speed * GameManager.get_speed_multiplier()
	if abs(input_dir) > 0.01:
		facing = 1 if input_dir > 0 else -1
		velocity.x = move_toward(velocity.x, desired, acceleration * delta)
		_set_state(State.RUN if GameManager.chase_state else State.WALK)
	else:
		velocity.x = move_toward(velocity.x, 0.0, deceleration * delta)
		if is_on_floor():
			_set_state(State.IDLE)

func _get_target_speed() -> float:
	if GameManager.chase_state:
		return chase_speed
	if GameManager.super_active:
		return run_speed * 1.15
	return walk_speed if abs(velocity.x) < run_speed * 0.65 else run_speed

func _get_input_axis() -> float:
	var axis := Input.get_axis("move_left", "move_right")
	return axis

func _do_jump() -> void:
	velocity.y = -jump_force * (1.12 if GameManager.super_active else 1.0)
	jump_buffer_timer = 0.0
	coyote_timer = 0.0
	_set_state(State.JUMP)
	AudioManager.play_sfx("jump")
	ComboManager.register_action("perfect_jump")

func _set_state(state: State) -> void:
	if current_state == state:
		return
	current_state = state

func _update_visuals() -> void:
	sprite.scale.x = abs(sprite.scale.x) * facing
	var body_color := Color(0.96, 0.78, 0.55)
	var accent := Color(0.2, 0.45, 0.75)
	if GameManager.super_active:
		body_color = Color(1.0, 0.95, 0.55)
	elif current_state == State.PUNCH:
		body_color = Color(0.95, 0.55, 0.45)
	elif current_state == State.KICK:
		body_color = Color(0.55, 0.75, 0.95)
	if sprite.has_method("set_colors"):
		sprite.set_colors(body_color, accent)
	elif sprite.has_method("set_color"):
		sprite.set_color(body_color)

func try_interact() -> void:
	var areas := get_tree().get_nodes_in_group("interactable")
	for node in areas:
		if node.global_position.distance_to(global_position) <= 90.0 and node.has_method("interact"):
			node.interact(self)
			_set_state(State.INTERACT)
			state_timer = 0.35
			return

func do_punch() -> void:
	if current_state in [State.PUNCH, State.KICK, State.CAUGHT, State.HIT]:
		return
	_set_state(State.PUNCH)
	state_timer = 0.28 / GameManager.get_super_multiplier()
	punch_area.monitoring = true
	punch_area.position.x = 42 * facing
	AudioManager.play_sfx("punch")
	ComboManager.register_action("punch")
	_camera_shake(2.0)
	await get_tree().create_timer(0.18).timeout
	punch_area.monitoring = false

func do_kick() -> void:
	if current_state in [State.PUNCH, State.KICK, State.CAUGHT, State.HIT]:
		return
	_set_state(State.KICK)
	state_timer = 0.32 / GameManager.get_super_multiplier()
	kick_area.monitoring = true
	kick_area.position.x = 54 * facing
	AudioManager.play_sfx("kick")
	ComboManager.register_action("kick")
	_camera_shake(3.0)
	await get_tree().create_timer(0.2).timeout
	kick_area.monitoring = false

func get_caught() -> void:
	if is_caught:
		return
	is_caught = true
	_set_state(State.CAUGHT)
	GameManager.trigger_rescue_prompt()

func release_from_catch() -> void:
	is_caught = false
	_set_state(State.IDLE)
	velocity = Vector2(-knockback_strength * facing, -jump_force * 0.45)

func apply_knockback(direction: float) -> void:
	_set_state(State.HIT)
	state_timer = 0.25
	velocity = Vector2(direction * knockback_strength, -jump_force * 0.35)
	ComboManager.break_combo()

func _on_punch_hit(body: Node) -> void:
	if body == self:
		return
	if body.has_method("on_punched"):
		body.on_punched(self, 1.0 * GameManager.get_super_multiplier())

func _on_kick_hit(body: Node) -> void:
	if body == self:
		return
	if body.has_method("on_kicked"):
		body.on_kicked(self, 1.4 * GameManager.get_super_multiplier())

func _camera_shake(amount: float) -> void:
	var cam := get_viewport().get_camera_2d()
	if cam and cam.has_method("shake"):
		cam.shake(amount)

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("interact"):
		try_interact()
	if event.is_action_pressed("punch"):
		do_punch()
	if event.is_action_pressed("kick"):
		do_kick()
	if event.is_action_pressed("jump") and is_on_floor():
		pass
