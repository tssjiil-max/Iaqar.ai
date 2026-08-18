extends BasePrank
class_name DoorbellPrank

signal prank_sequence_finished

var _sequence_running := false

func _ready() -> void:
	super._ready()
	prank_type = "doorbell"
	prompt_text = "دق الجرس"
	reaction_delay = 2.0

func trigger_prank(player: PlayerController) -> void:
	if triggered or _sequence_running:
		return
	_sequence_running = true
	triggered = true
	prank_triggered.emit()
	player.can_move = false
	AudioManager.play_sfx("bell")
	_show_bubble(player.global_position + Vector2(0, -90), "رنّ الجرس!", 1.0)
	await get_tree().create_timer(0.8).timeout
	# نظرة مضحكة بين أسامة ونطّاح
	var sheep := get_tree().get_first_node_in_group("sheep") as SheepController
	if player.sprite and player.sprite.has_method("set_mood"):
		player.sprite.set_mood("look")
	if sheep and sheep.sprite and sheep.sprite.has_method("set_mood"):
		sheep.sprite.set_mood("idle")
	_show_bubble(player.global_position + Vector2(40, -100), "😏", 0.8)
	await get_tree().create_timer(0.9).timeout
	if sheep and sheep.sprite and sheep.sprite.has_method("set_mood"):
		sheep.sprite.set_mood("scared")
	_show_bubble(player.global_position + Vector2(-30, -110), "هههه!", 0.7)
	await get_tree().create_timer(0.6).timeout
	# اهرب!
	player.can_move = true
	if player.sprite and player.sprite.has_method("set_mood"):
		player.sprite.set_mood("scared")
	GameManager.add_score(score_reward, "prank")
	_show_bubble(player.global_position + Vector2(0, -120), "اهرب!", 1.2)
	await get_tree().create_timer(1.4).timeout
	# صاحب البيت يخرج
	_homeowner_emerges()
	_show_bubble(global_position + Vector2(0, -250), "يااا ولد!", 1.5)
	AudioManager.play_sfx("chase_start")
	await get_tree().create_timer(0.8).timeout
	_start_chase()
	_sequence_running = false
	prank_sequence_finished.emit()

func _homeowner_emerges() -> void:
	var chaser := get_tree().get_first_node_in_group("chaser") as BaseChaser
	if chaser:
		chaser.visible = true
		if chaser.sprite and chaser.sprite.has_method("set_angry"):
			chaser.sprite.set_angry(true)
		chaser.global_position = global_position + Vector2(20, -40)

func _show_bubble(at: Vector2, text: String, duration: float) -> void:
	var bubble := Label.new()
	bubble.text = text
	bubble.position = at
	bubble.z_index = 50
	bubble.add_theme_font_size_override("font_size", 26)
	bubble.add_theme_color_override("font_color", Color(1, 0.95, 0.7))
	get_parent().add_child(bubble)
	await get_tree().create_timer(duration).timeout
	if is_instance_valid(bubble):
		bubble.queue_free()

func get_prompt() -> String:
	return prompt_text if not triggered else ""
