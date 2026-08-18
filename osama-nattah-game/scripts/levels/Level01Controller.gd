extends Node2D

@onready var player_spawn: Marker2D = $Markers/PlayerSpawn
@onready var sheep_spawn: Marker2D = $Markers/SheepSpawn
@onready var chase_manager: ChaseManager = $ChaseManager
@onready var hud: CanvasLayer = $HUD
@onready var result_screen: CanvasLayer = $ResultScreen
@onready var world: Node2D = $World
@onready var camera: GameCamera = $Camera2D

var player_scene := preload("res://scenes/characters/Player.tscn")
var sheep_scene := preload("res://scenes/characters/Sheep.tscn")
var chaser_scene := preload("res://scenes/chasers/HomeOwnerChaser.tscn")
var doorbell_scene := preload("res://scenes/pranks/DoorbellPrank.tscn")
var safe_zone: Area2D = null
var chase_obstacles_spawned := false

func _ready() -> void:
	GameManager.set_state(GameManager.GameState.EXPLORE)
	AudioManager.play_music("explore")
	_build_environment()
	_spawn_characters()
	_setup_chase()
	GameManager.chase_started.connect(_on_chase_started)
	GameManager.chase_ended.connect(_on_chase_ended)
	if hud and hud.has_method("bind_level"):
		hud.bind_level(self)
	if result_screen:
		result_screen.visible = false

func _build_environment() -> void:
	_add_ground(Vector2(0, 0), 1200)
	_add_ground(Vector2(1500, 0), 1800)
	_add_ground(Vector2(3600, 0), 1400)
	_add_platform(Vector2(900, -120), 220)
	_add_platform(Vector2(1250, -200), 180)
	_add_platform(Vector2(2100, -140), 240)
	_add_platform(Vector2(2800, -220), 200)
	_add_breakable(Vector2(1700, -40), true)
	_add_breakable(Vector2(2400, -40), false)
	_add_collectible(Vector2(980, -160))
	_add_collectible(Vector2(1280, -240))
	_add_collectible(Vector2(2150, -180))
	_add_collectible(Vector2(3000, -40))
	_add_collectible(Vector2(4200, -40))
	_add_secret(Vector2(760, -260))
	_add_secret(Vector2(2550, -300))
	_add_secret(Vector2(3900, -120))
	var doorbell := doorbell_scene.instantiate()
	doorbell.position = Vector2(420, -40)
	world.add_child(doorbell)
	_add_house_decor(Vector2(420, 0))
	_add_safe_zone(Vector2(4700, -80))

func _add_ground(origin: Vector2, width: float) -> void:
	var body := StaticBody2D.new()
	body.position = origin
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(width, 40)
	shape.position = Vector2(width * 0.5, 20)
	shape.shape = rect
	body.add_child(shape)
	var visual := ColorRect.new()
	visual.size = Vector2(width, 40)
	visual.position = Vector2(0, 0)
	visual.color = Color(0.62, 0.5, 0.36)
	body.add_child(visual)
	var lane := ColorRect.new()
	lane.size = Vector2(width, 8)
	lane.position = Vector2(0, 10)
	lane.color = Color(0.52, 0.42, 0.3)
	body.add_child(lane)
	world.add_child(body)

func _add_platform(origin: Vector2, width: float) -> void:
	var body := StaticBody2D.new()
	body.position = origin
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(width, 24)
	shape.position = Vector2(width * 0.5, 12)
	shape.shape = rect
	body.add_child(shape)
	var visual := ColorRect.new()
	visual.size = Vector2(width, 24)
	visual.color = Color(0.7, 0.55, 0.4)
	body.add_child(visual)
	world.add_child(body)

func _add_breakable(pos: Vector2, pushable: bool) -> void:
	var box := preload("res://scenes/obstacles/BreakableBox.tscn").instantiate()
	box.position = pos
	box.pushable = pushable
	world.add_child(box)

func _add_collectible(pos: Vector2) -> void:
	var coin := preload("res://scenes/collectibles/Coin.tscn").instantiate()
	coin.position = pos
	world.add_child(coin)

func _add_house_decor(pos: Vector2) -> void:
	var wall := ColorRect.new()
	wall.size = Vector2(180, 140)
	wall.position = pos + Vector2(-90, -180)
	wall.color = Color(0.75, 0.58, 0.42)
	world.add_child(wall)

func _add_secret(pos: Vector2) -> void:
	var area := Area2D.new()
	area.position = pos
	area.collision_layer = 0
	area.collision_mask = 2
	area.add_to_group("secret")
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(48, 48)
	shape.shape = rect
	area.add_child(shape)
	var visual := ColorRect.new()
	visual.size = Vector2(48, 48)
	visual.position = Vector2(-24, -48)
	visual.color = Color(0.95, 0.85, 0.2, 0.8)
	area.add_child(visual)
	area.body_entered.connect(func(body: Node) -> void:
		if body is PlayerController:
			GameManager.secrets_found += 1
			ComboManager.register_action("secret")
			area.queue_free()
	)
	world.add_child(area)

func _add_safe_zone(pos: Vector2) -> void:
	var area := Area2D.new()
	area.position = pos
	area.collision_layer = 0
	area.collision_mask = 2
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(180, 160)
	shape.shape = rect
	area.add_child(shape)
	var flag := ColorRect.new()
	flag.size = Vector2(180, 160)
	flag.color = Color(0.2, 0.75, 0.45, 0.35)
	area.add_child(flag)
	var label := Label.new()
	label.text = "منطقة آمنة"
	label.position = Vector2(20, 60)
	area.add_child(label)
	world.add_child(area)
	safe_zone = area

func _spawn_characters() -> void:
	var player := player_scene.instantiate() as PlayerController
	player.global_position = player_spawn.global_position
	world.add_child(player)
	var sheep := sheep_scene.instantiate() as SheepController
	sheep.global_position = sheep_spawn.global_position
	world.add_child(sheep)
	player.bind_sheep(sheep)
	sheep.bind_player(player)
	if camera:
		camera.bind_target(player)

func _setup_chase() -> void:
	var chaser := chaser_scene.instantiate() as BaseChaser
	chaser.position = Vector2(500, -40)
	world.add_child(chaser)
	chase_manager.add_to_group("chase_manager")
	var player := get_tree().get_first_node_in_group("player") as PlayerController
	chase_manager.setup(player, chaser, safe_zone)

func _on_chase_started() -> void:
	if chase_obstacles_spawned:
		return
	chase_obstacles_spawned = true
	_spawn_chase_obstacles()

func _spawn_chase_obstacles() -> void:
	_add_static_obstacle(Vector2(1900, -40))
	_add_moving_obstacle(Vector2(2300, -40))
	_add_jump_obstacle(Vector2(2700, -20))
	_add_breakable(Vector2(3100, -40), true)
	_add_static_obstacle(Vector2(3500, -40))

func _add_static_obstacle(pos: Vector2) -> void:
	var body := StaticBody2D.new()
	body.position = pos
	body.set_script(load("res://scripts/obstacles/StaticObstacle.gd"))
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(50, 70)
	shape.position = Vector2(0, -35)
	shape.shape = rect
	body.add_child(shape)
	var visual := ColorRect.new()
	visual.size = Vector2(50, 70)
	visual.position = Vector2(-25, -70)
	visual.color = Color(0.55, 0.4, 0.28)
	body.add_child(visual)
	world.add_child(body)

func _add_moving_obstacle(pos: Vector2) -> void:
	var body := CharacterBody2D.new()
	body.position = pos
	body.set_script(load("res://scripts/obstacles/MovingObstacle.gd"))
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(40, 60)
	shape.position = Vector2(0, -30)
	shape.shape = rect
	body.add_child(shape)
	var visual := ColorRect.new()
	visual.size = Vector2(40, 60)
	visual.position = Vector2(-20, -60)
	visual.color = Color(0.7, 0.45, 0.25)
	body.add_child(visual)
	world.add_child(body)

func _add_jump_obstacle(pos: Vector2) -> void:
	var area := Area2D.new()
	area.position = pos
	area.set_script(load("res://scripts/obstacles/JumpObstacle.gd"))
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(120, 30)
	shape.shape = rect
	area.add_child(shape)
	var visual := ColorRect.new()
	visual.size = Vector2(120, 12)
	visual.color = Color(0.8, 0.2, 0.2, 0.7)
	area.add_child(visual)
	world.add_child(area)

func _on_chase_ended(won: bool) -> void:
	result_screen.show_result(won, ComboManager.best_combo, GameManager.secrets_found, GameManager.secrets_total)

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		get_tree().paused = not get_tree().paused
	if event.is_action_pressed("sheep_ability"):
		var sheep := get_tree().get_first_node_in_group("sheep") as SheepController
		if sheep:
			if GameManager.rescue_prompt_active:
				sheep.try_rescue()
			else:
				sheep.try_headbutt()
	if event.is_action_pressed("interact") and GameManager.super_meter >= GameManager.SUPER_MAX:
		GameManager.activate_super()
