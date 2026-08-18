extends Node2D

@onready var player_spawn: Marker2D = $Markers/PlayerSpawn
@onready var sheep_spawn: Marker2D = $Markers/SheepSpawn
@onready var chase_manager: ChaseManager = $ChaseManager
@onready var hud: CanvasLayer = $HUD
@onready var result_screen: CanvasLayer = $ResultScreen
@onready var world: Node2D = $World
@onready var camera: GameCamera = $Camera2D
@onready var prank_container: Node2D = $PrankContainer

var player_scene := preload("res://scenes/characters/Player.tscn")
var sheep_scene := preload("res://scenes/characters/Sheep.tscn")
var chaser_scene := preload("res://scenes/chasers/HomeOwnerChaser.tscn")
var doorbell_scene := preload("res://scenes/pranks/DoorbellPrank.tscn")
var date_scene := preload("res://scenes/collectibles/DateCollectible.tscn")
var marble_scene := preload("res://scenes/collectibles/MarbleCollectible.tscn")

var safe_zone: Area2D = null
var chase_obstacles_spawned := false
var level_data: Dictionary = {}

func _ready() -> void:
	GameManager.current_level = "level_01"
	GameManager.reset_level_state()
	GameManager.set_state(GameManager.GameState.EXPLORE)
	AudioManager.play_music("explore")
	level_data = MedinaLevel01Builder.build(world, prank_container)
	_place_doorbell_prank()
	_place_collectibles()
	safe_zone = MedinaLevel01Builder.build_safe_zone(world, level_data.safe_zone_pos)
	_spawn_characters()
	_setup_chase()
	GameManager.chase_started.connect(_on_chase_started)
	GameManager.chase_ended.connect(_on_chase_ended)
	if hud and hud.has_method("bind_level"):
		hud.bind_level(self)
	if result_screen:
		result_screen.visible = false
	_show_intro()

func _show_intro() -> void:
	var title := Label.new()
	title.text = "المرحلة 1 — جرس الحارة\nالمدينة المنورة — ليلًا"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.position = Vector2(40, -280)
	title.add_theme_font_size_override("font_size", 24)
	title.add_theme_color_override("font_color", Color(1, 0.92, 0.7))
	world.add_child(title)
	var hint := Label.new()
	hint.text = "⬅️➡️ تمشى في الحارة  |  اقترب من الجرس  |  اضغط «تفاعل»"
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint.position = Vector2(20, -240)
	hint.add_theme_font_size_override("font_size", 18)
	world.add_child(hint)
	get_tree().create_timer(6.0).timeout.connect(func():
		if is_instance_valid(title): title.queue_free()
		if is_instance_valid(hint): hint.queue_free()
	)

func _place_doorbell_prank() -> void:
	var doorbell := doorbell_scene.instantiate() as DoorbellPrank
	doorbell.position = level_data.bell_house_pos + Vector2(35, -55)
	prank_container.add_child(doorbell)

func _place_collectibles() -> void:
	var spots := [
		Vector2(500, -40), Vector2(1100, -40), Vector2(1500, -100),
		Vector2(2100, -40), Vector2(2600, -160), Vector2(3000, -40),
		Vector2(3500, -120), Vector2(4000, -40), Vector2(4600, -40)
	]
	for i in spots.size():
		var item
		if i % 3 == 0:
			item = marble_scene.instantiate()
		else:
			item = date_scene.instantiate()
		item.position = spots[i]
		world.add_child(item)

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
	chaser.position = level_data.chaser_spawn_pos
	chaser.visible = false
	chaser.quote = "يااا ولد!"
	world.add_child(chaser)
	chase_manager.add_to_group("chase_manager")
	var player := get_tree().get_first_node_in_group("player") as PlayerController
	chase_manager.setup(player, chaser, safe_zone)

func _on_chase_started() -> void:
	if chase_obstacles_spawned:
		return
	chase_obstacles_spawned = true
	MedinaLevel01Builder.spawn_chase_obstacles(world)
	_schedule_sheep_comedy()

func _schedule_sheep_comedy() -> void:
	await get_tree().create_timer(4.0).timeout
	if not GameManager.chase_state:
		return
	var sheep := get_tree().get_first_node_in_group("sheep") as SheepController
	if sheep:
		sheep.distract(1.5)
		if sheep.sprite and sheep.sprite.has_method("set_mood"):
			sheep.sprite.set_mood("eat")
		_show_world_bubble(sheep.global_position + Vector2(0, -50), "نطّاااح!", 1.2)
		await get_tree().create_timer(1.8).timeout
		if sheep.sprite and sheep.sprite.has_method("set_mood"):
			sheep.sprite.set_mood("scared")

func _show_world_bubble(at: Vector2, text: String, duration: float) -> void:
	var bubble := Label.new()
	bubble.text = text
	bubble.position = at
	bubble.z_index = 50
	bubble.add_theme_font_size_override("font_size", 28)
	world.add_child(bubble)
	await get_tree().create_timer(duration).timeout
	if is_instance_valid(bubble):
		bubble.queue_free()

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
