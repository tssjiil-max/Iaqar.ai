extends Node

enum GameState { MENU, EXPLORE, CHASE, PAUSED, WIN, LOSE, CUTSCENE }

var current_level: String = "level_01"
var game_state: GameState = GameState.MENU
var score: int = 0
var chase_state: bool = false
var super_meter: float = 0.0
var friendship_meter: float = 0.0
var super_active: bool = false
var super_time_left: float = 0.0
var pause_state: bool = false
var secrets_found: int = 0
var secrets_total: int = 3
var rescue_available: bool = false
var rescue_prompt_active: bool = false
var chase_failures: int = 0

const SUPER_MAX := 100.0
const FRIENDSHIP_MAX := 100.0
const SUPER_DURATION := 8.0

signal score_changed(value)
signal super_changed(value)
signal friendship_changed(value)
signal state_changed(state)
signal chase_started
signal chase_ended(won)
signal rescue_prompt(show)

func reset_level_state() -> void:
	score = 0
	chase_state = false
	super_meter = 0.0
	friendship_meter = 0.0
	super_active = false
	super_time_left = 0.0
	secrets_found = 0
	rescue_available = true
	rescue_prompt_active = false
	ComboManager.reset_combo()
	score_changed.emit(score)
	super_changed.emit(super_meter)
	friendship_changed.emit(friendship_meter)

func set_state(state: GameState) -> void:
	game_state = state
	state_changed.emit(state)

func add_score(points: int, reason: String = "") -> void:
	score += points
	add_super(points * 0.15)
	score_changed.emit(score)
	if reason != "":
		ComboManager.register_action_only(reason)

func add_super(amount: float) -> void:
	if super_active:
		return
	super_meter = clamp(super_meter + amount, 0.0, SUPER_MAX)
	super_changed.emit(super_meter)
	if super_meter >= SUPER_MAX:
		AudioManager.play_sfx("super_ready")

func add_friendship(amount: float) -> void:
	friendship_meter = clamp(friendship_meter + amount, 0.0, FRIENDSHIP_MAX)
	friendship_changed.emit(friendship_meter)

func activate_super() -> void:
	if super_meter < SUPER_MAX or super_active:
		return
	super_active = true
	super_meter = 0.0
	super_time_left = SUPER_DURATION
	super_changed.emit(super_meter)
	AudioManager.play_sfx("super_activate")

func use_friendship_team_ability() -> bool:
	if friendship_meter < FRIENDSHIP_MAX:
		return false
	friendship_meter = 0.0
	friendship_changed.emit(friendship_meter)
	add_score(150, "team_ability")
	return true

func start_chase() -> void:
	chase_state = true
	set_state(GameState.CHASE)
	chase_started.emit()
	AudioManager.play_music("chase")

func end_chase(won: bool) -> void:
	chase_state = false
	if won:
		add_score(200, "chase_escape")
		set_state(GameState.WIN)
	else:
		chase_failures += 1
		set_state(GameState.LOSE)
	chase_ended.emit(won)
	AudioManager.play_music("explore")

func trigger_rescue_prompt() -> void:
	if not rescue_available:
		return
	rescue_prompt_active = true
	rescue_prompt.emit(true)

func complete_rescue() -> void:
	rescue_available = false
	rescue_prompt_active = false
	rescue_prompt.emit(false)
	add_score(100, "rescue")
	add_friendship(25)

func _process(delta: float) -> void:
	if super_active:
		super_time_left -= delta
		if super_time_left <= 0.0:
			super_active = false

func get_super_multiplier() -> float:
	return 1.8 if super_active else 1.0

func get_speed_multiplier() -> float:
	var mult := 1.0
	if super_active:
		mult *= 1.35
	if chase_state:
		mult *= 1.15
	return mult

func get_chaser_speed_multiplier() -> float:
	return max(0.75, 1.0 - chase_failures * 0.08)
