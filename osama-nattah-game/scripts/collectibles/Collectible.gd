extends Area2D

@export var value := 10
@export var collectible_type := "coin"

func _ready() -> void:
	add_to_group("collectible")
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node) -> void:
	if body is PlayerController:
		GameManager.add_score(value, "collect")
		AudioManager.play_sfx("collect")
		queue_free()
