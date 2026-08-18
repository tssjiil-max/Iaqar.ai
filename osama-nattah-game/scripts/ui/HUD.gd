extends CanvasLayer

@onready var score_label: Label = $Root/TopBar/ScoreLabel
@onready var combo_label: Label = $Root/TopBar/ComboLabel
@onready var super_bar: ProgressBar = $Root/TopBar/SuperBar
@onready var friendship_bar: ProgressBar = $Root/TopBar/FriendshipBar
@onready var chase_label: Label = $Root/ChaseLabel
@onready var rescue_label: Label = $Root/RescueLabel
@onready var interact_label: Label = $Root/InteractLabel
@onready var touch_controls: Control = $Root/TouchControls

func _ready() -> void:
	GameManager.score_changed.connect(_on_score_changed)
	GameManager.super_changed.connect(_on_super_changed)
	GameManager.friendship_changed.connect(_on_friendship_changed)
	GameManager.chase_started.connect(func(): chase_label.visible = true)
	GameManager.chase_ended.connect(func(_won): chase_label.visible = false)
	GameManager.rescue_prompt.connect(_on_rescue_prompt)
	ComboManager.combo_changed.connect(_on_combo_changed)
	_on_score_changed(GameManager.score)
	_on_super_changed(GameManager.super_meter)
	_on_friendship_changed(GameManager.friendship_meter)
	chase_label.visible = false
	rescue_label.visible = false
	interact_label.visible = false

func bind_level(level: Node) -> void:
	if touch_controls and touch_controls.has_method("bind_level"):
		touch_controls.bind_level(level)

func _process(_delta: float) -> void:
	_update_interact_prompt()
	_update_chase_distance()

func _update_chase_distance() -> void:
	if not GameManager.chase_state:
		return
	var player := get_tree().get_first_node_in_group("player")
	var chaser := get_tree().get_first_node_in_group("chaser")
	if player and chaser:
		var dist: float = player.global_position.distance_to(chaser.global_position)
		update_chase_distance(dist)

func _update_interact_prompt() -> void:
	var player := get_tree().get_first_node_in_group("player")
	if player == null:
		interact_label.visible = false
		return
	var show := false
	for node in get_tree().get_nodes_in_group("interactable"):
		if node.global_position.distance_to(player.global_position) <= 90.0 and node.has_method("get_prompt"):
			var text: String = node.get_prompt()
			if text != "":
				interact_label.text = text
				show = true
				break
	interact_label.visible = show

func _on_score_changed(value: int) -> void:
	score_label.text = "النقاط: %d" % value

func _on_combo_changed(value: int) -> void:
	combo_label.text = "x%d" % max(1, value)

func _on_super_changed(value: float) -> void:
	super_bar.value = value
	if value >= GameManager.SUPER_MAX:
		super_bar.tooltip_text = "قوة أسامة جاهزة!"

func _on_friendship_changed(value: float) -> void:
	friendship_bar.value = value

func _on_rescue_prompt(show: bool) -> void:
	rescue_label.visible = show
	if show:
		rescue_label.text = "نطّاح! الحقني!"

func update_chase_distance(dist: float) -> void:
	if GameManager.chase_state:
		chase_label.text = "المطارد: %.0f م" % (dist / 100.0)
		chase_label.visible = true
	else:
		chase_label.visible = false
