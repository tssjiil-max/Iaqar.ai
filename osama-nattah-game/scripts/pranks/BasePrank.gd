extends Area2D
class_name BasePrank

@export var prank_type: String = "generic"
@export var score_reward: int = 100
@export var noise_level: float = 1.0
@export var reaction_delay: float = 1.0
@export var prompt_text: String = "تفاعل"

signal prank_triggered

var triggered := false

func _ready() -> void:
	add_to_group("interactable")
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node) -> void:
	if body is PlayerController:
		set_meta("player_near", true)

func interact(player: PlayerController) -> void:
	if triggered:
		return
	trigger_prank(player)

func trigger_prank(player: PlayerController) -> void:
	triggered = true
	prank_triggered.emit()
	GameManager.add_score(score_reward, "prank")
	await get_tree().create_timer(reaction_delay).timeout
	_start_chase()

func _start_chase() -> void:
	var chase := get_tree().get_first_node_in_group("chase_manager")
	if chase and chase.has_method("start_chase"):
		chase.start_chase()

func get_prompt() -> String:
	return prompt_text if not triggered else ""
