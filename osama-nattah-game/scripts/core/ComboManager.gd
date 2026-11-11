extends Node

var combo_count := 0
var combo_timer := 0.0
var best_combo := 1

const COMBO_TIMEOUT := 2.5

signal combo_changed(value)

func reset_combo() -> void:
	combo_count = 0
	combo_timer = 0.0
	combo_changed.emit(combo_count)

func register_action(action_name: String) -> void:
	_bump_combo(action_name, true)

func register_action_only(action_name: String) -> void:
	_bump_combo(action_name, false)

func _bump_combo(action_name: String, award_points: bool) -> void:
	combo_count += 1
	combo_timer = COMBO_TIMEOUT
	best_combo = max(best_combo, combo_count)
	combo_changed.emit(combo_count)
	if award_points:
		var points: int = _action_points(action_name)
		if points > 0:
			GameManager.score += points
			GameManager.add_super(float(points) * 0.15)
			GameManager.score_changed.emit(GameManager.score)
	if combo_count >= 2:
		GameManager.add_super(float(combo_count) * 2.0)

func _action_points(action_name: String) -> int:
	match action_name:
		"perfect_jump": return 10
		"near_miss": return 20
		"punch": return 25
		"kick": return 30
		"headbutt": return 40
		"collect": return 10
		"target_hit": return 50
		"prank": return 0
		"secret": return 0
		"friendship": return 50
		"chase_escape": return 0
		"team_ability": return 0
		"rescue": return 0
		_: return 0

func break_combo() -> void:
	if combo_count > 0:
		combo_count = 0
		combo_changed.emit(combo_count)

func _process(delta: float) -> void:
	if combo_count <= 0:
		return
	combo_timer -= delta
	if combo_timer <= 0.0:
		break_combo()
