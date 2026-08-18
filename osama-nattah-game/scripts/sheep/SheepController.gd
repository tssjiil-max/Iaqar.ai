extends CharacterBody2D
class_name SheepController

enum State {
	IDLE, FOLLOW, RUN, JUMP, DISTRACTED, HEADBUTT, RESCUE, WAIT, LOST, REJOIN, EAT, CELEBRATE
}

@export var follow_distance := 90.0
@export var follow_speed := 250.0
@export var catchup_speed := 420.0
@export var headbutt_speed := 560.0
@export var headbutt_cooldown := 8.0
@export var rescue_speed := 500.0

@onready var sprite: Node2D = $Sprite
@onready var headbutt_area: Area2D = $HeadbuttArea

var player: PlayerController = null
var current_state: State = State.FOLLOW
var cooldown_left := 0.0
var distracted_timer := 0.0
var target: Node2D = null
var stuck_timer := 0.0
var last_pos := Vector2.ZERO

func _ready() -> void:
	add_to_group("sheep")
	headbutt_area.body_entered.connect(_on_headbutt_hit)
	headbutt_area.monitoring = false

func bind_player(p: PlayerController) -> void:
	player = p

func _physics_process(delta: float) -> void:
	if player == null:
		return
	cooldown_left = max(0.0, cooldown_left - delta)
	match current_state:
		State.FOLLOW, State.RUN, State.REJOIN:
			_follow_player(delta)
		State.HEADBUTT, State.RESCUE:
			_move_to_target(delta)
		State.DISTRACTED, State.EAT:
			distracted_timer -= delta
			if distracted_timer <= 0.0:
				current_state = State.REJOIN
		State.CELEBRATE:
			velocity = Vector2.ZERO
	velocity.y += 1800.0 * delta
	move_and_slide()
	_update_recovery(delta)
	_update_visual()

func _follow_player(delta: float) -> void:
	var offset := player.global_position - global_position
	var dist := offset.length()
	if dist > follow_distance * 2.4:
		current_state = State.RUN
	elif dist > follow_distance:
		current_state = State.FOLLOW
	else:
		current_state = State.IDLE
		velocity.x = move_toward(velocity.x, 0.0, 2000.0 * delta)
		return
	var speed := catchup_speed if current_state == State.RUN else follow_speed
	velocity.x = sign(offset.x) * speed
	if is_on_floor() and player.current_state == player.State.JUMP and dist > follow_distance * 1.5:
		velocity.y = -520.0

func _move_to_target(delta: float) -> void:
	if target == null:
		current_state = State.FOLLOW
		return
	var dir := target.global_position - global_position
	if dir.length() < 24.0:
		_finish_special_action()
		return
	var speed := rescue_speed if current_state == State.RESCUE else headbutt_speed
	velocity.x = sign(dir.x) * speed

func try_headbutt() -> bool:
	if cooldown_left > 0.0 or current_state in [State.HEADBUTT, State.RESCUE]:
		return false
	var target_node := _find_headbutt_target()
	if target_node == null:
		return false
	target = target_node
	current_state = State.HEADBUTT
	cooldown_left = headbutt_cooldown
	headbutt_area.monitoring = true
	AudioManager.play_sfx("headbutt")
	ComboManager.register_action("headbutt")
	return true

func try_rescue() -> bool:
	if not GameManager.rescue_prompt_active:
		return false
	target = player
	current_state = State.RESCUE
	AudioManager.play_sfx("rescue")
	return true

func _finish_special_action() -> void:
	headbutt_area.monitoring = false
	if current_state == State.RESCUE:
		if player:
			player.release_from_catch()
		GameManager.complete_rescue()
		current_state = State.CELEBRATE
		get_tree().create_timer(0.6).timeout.connect(func(): current_state = State.FOLLOW)
	elif current_state == State.HEADBUTT and target and target.has_method("on_headbutted"):
		target.on_headbutted(self)
	target = null
	if current_state != State.CELEBRATE:
		current_state = State.FOLLOW

func _find_headbutt_target() -> Node2D:
	var best: Node2D = null
	var best_dist := 180.0
	for node in get_tree().get_nodes_in_group("headbutt_target"):
		var dist := global_position.distance_to(node.global_position)
		if dist <= best_dist:
			best = node
			best_dist = dist
	return best

func distract(seconds: float = 1.2) -> void:
	current_state = State.DISTRACTED
	distracted_timer = seconds

func celebrate() -> void:
	current_state = State.CELEBRATE
	get_tree().create_timer(1.0).timeout.connect(func(): current_state = State.FOLLOW)

func _on_headbutt_hit(body: Node) -> void:
	if body == self or body == player:
		return
	if body.has_method("on_headbutted"):
		body.on_headbutted(self)

func _update_recovery(delta: float) -> void:
	if global_position.distance_to(last_pos) < 2.0 and current_state in [State.FOLLOW, State.RUN]:
		stuck_timer += delta
	else:
		stuck_timer = 0.0
	last_pos = global_position
	if stuck_timer > 0.8:
		global_position.y -= 8.0
		velocity.y = -300.0
		stuck_timer = 0.0

func _update_visual() -> void:
	sprite.scale.x = 1.0 if velocity.x >= 0 else -1.0
	var color := Color(0.92, 0.92, 0.92)
	if current_state == State.HEADBUTT:
		color = Color(0.95, 0.95, 0.95)
	elif current_state == State.RESCUE:
		color = Color(0.75, 1.0, 0.75)
	if sprite.has_method("set_color"):
		sprite.set_color(color)
