extends Node2D

func _ready() -> void:
	var world := $World
	var prank := $PrankContainer
	var data := MedinaLevel01Builder.build(world, prank)
	MedinaLevel01Builder.build_safe_zone(world, data.safe_zone_pos)
	var player := preload("res://scenes/characters/Player.tscn").instantiate()
	player.position = Vector2(200, -40)
	world.add_child(player)
	var sheep := preload("res://scenes/characters/Sheep.tscn").instantiate()
	sheep.position = Vector2(140, -40)
	world.add_child(sheep)
	$Camera2D.position = Vector2(200, -120)
