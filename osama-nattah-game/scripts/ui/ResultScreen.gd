extends CanvasLayer

func show_result(won: bool, best_combo: int, secrets: int, secrets_total: int) -> void:
	visible = true
	get_tree().paused = true
	$Panel/Title.text = "نجوتوا من المطاردة!" if won else "مسككم صاحب البيت!"
	$Panel/Score.text = "النقاط: %d" % GameManager.score
	$Panel/Combo.text = "أفضل كومبو: x%d" % best_combo
	$Panel/Secrets.text = "مقتنيات الحارة: %d" % int(GameManager.score / 15)
	var stars := 1
	if GameManager.score >= 500:
		stars = 2
	if GameManager.score >= 900:
		stars = 3
	$Panel/Stars.text = "⭐".repeat(stars)
	$Panel/Buttons/NextButton.visible = false
	$Panel/Buttons/HubButton.visible = false
	if won:
		SaveManager.record_level_result(GameManager.current_level, GameManager.score, stars, secrets)
		AudioManager.play_sfx("win")
	else:
		AudioManager.play_sfx("lose")

func _on_next_pressed() -> void:
	get_tree().paused = false
	SceneManager.go_to_level("level_02")

func _on_retry_pressed() -> void:
	get_tree().paused = false
	SceneManager.reload_current()

func _on_hub_pressed() -> void:
	get_tree().paused = false
	SceneManager.go_to_hub()
