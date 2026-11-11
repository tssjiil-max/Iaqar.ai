extends Node
class_name ChaseManager

@export var chaser_path: NodePath
@export var safe_zone_path: NodePath
@export var distance_indicator_path: NodePath

var chaser: BaseChaser = null
var safe_zone: Area2D = null
var player: PlayerController = null
var active := false
var rescue_timer := 0.0
const RESCUE_WINDOW := 3.5

func setup(p: PlayerController, chaser_node: BaseChaser = null, safe_zone_node: Area2D = null) -> void:
	player = p
	if chaser_node:
		chaser = chaser_node
	elif chaser_path != NodePath():
		chaser = get_node(chaser_path)
	if safe_zone_node:
		safe_zone = safe_zone_node
	elif safe_zone_path != NodePath():
		safe_zone = get_node(safe_zone_path)
	if safe_zone and not safe_zone.body_entered.is_connected(_on_safe_zone_entered):
		safe_zone.body_entered.connect(_on_safe_zone_entered)

func start_chase() -> void:
	if active:
		return
	active = true
	GameManager.start_chase()
	if chaser:
		chaser.activate(player)
	if player:
		player.can_move = true

func stop_chase(won: bool) -> void:
	if not active:
		return
	active = false
	if chaser:
		chaser.deactivate()
	GameManager.end_chase(won)

func _process(delta: float) -> void:
	if not active or player == null or chaser == null:
		return
	if player.is_caught and GameManager.rescue_prompt_active:
		rescue_timer -= delta
		if rescue_timer <= 0.0:
			stop_chase(false)
		return
	var dist: float = player.global_position.distance_to(chaser.global_position)
	if dist <= chaser.catch_distance and not player.is_caught:
		player.get_caught()
		if GameManager.rescue_available:
			rescue_timer = RESCUE_WINDOW
		else:
			stop_chase(false)

func _on_safe_zone_entered(body: Node) -> void:
	if body is PlayerController and active:
		stop_chase(true)
