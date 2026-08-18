extends RefCounted
class_name MedinaLevel01Builder

static func build(world: Node2D, doorbell_parent: Node2D) -> Dictionary:
	var data := {}
	var bg := Node2D.new()
	bg.name = "Background"
	bg.z_index = -20
	world.add_child(bg)
	_build_night_sky(bg)
	_build_mountains(bg)
	_build_distant_city(bg)

	var decor := Node2D.new()
	decor.name = "Decor"
	decor.z_index = -5
	world.add_child(decor)

	_build_alley_floor(world, Vector2(0, 0), 5200)

	# حارة مدينية — بيوت شعبية على طول المسار
	_add_palm(decor, Vector2(200, 0))
	_add_palm(decor, Vector2(1100, 0))
	_add_palm(decor, Vector2(2800, 0))
	_add_palm(decor, Vector2(4100, 0))
	_add_wall_segment(decor, Vector2(50, 0), 280)
	_add_wall_segment(decor, Vector2(600, 0), 320)
	_add_house_facade(decor, Vector2(1200, 0), false)
	_add_house_facade(decor, Vector2(2000, 0), false)
	_add_parked_car(decor, Vector2(1600, 0))
	_add_cat(decor, Vector2(950, -120))
	_add_chicken(decor, Vector2(2400, 0), "idle")

	# بيت الجرس — قلب المرحلة
	var bell_house_pos := Vector2(800, 0)
	data["bell_house_pos"] = bell_house_pos
	_build_doorbell_house(decor, bell_house_pos, doorbell_parent)

	_add_wall_segment(decor, Vector2(3200, 0), 400)
	_add_house_facade(decor, Vector2(3600, 0), true)
	_add_shop_front(decor, Vector2(4400, 0))

	# منصات للقفز أثناء المطاردة
	_add_platform(world, Vector2(1900, -100), 200)
	_add_platform(world, Vector2(2500, -160), 180)
	_add_platform(world, Vector2(3100, -120), 220)
	_add_platform(world, Vector2(3800, -180), 160)

	data["safe_zone_pos"] = Vector2(4900, -80)
	data["chaser_spawn_pos"] = bell_house_pos + Vector2(40, -40)
	data["chase_start_x"] = 1000.0
	return data

static func _build_night_sky(parent: Node2D) -> void:
	var sky_top := WorldArt.make_rect(Vector2(5400, 500), MedinaPalette.SKY_TOP, Vector2(-100, -500))
	parent.add_child(sky_top)
	var sky_bot := WorldArt.make_rect(Vector2(5400, 200), MedinaPalette.SKY_BOTTOM, Vector2(-100, -200))
	parent.add_child(sky_bot)
	# قمر
	var moon := Polygon2D.new()
	moon.color = MedinaPalette.MOON
	moon.polygon = _circle_points(Vector2(4200, -360), 36, 24)
	parent.add_child(moon)
	# نجوم
	for i in range(40):
		var star := WorldArt.make_rect(Vector2(3, 3), MedinaPalette.STAR, Vector2(randf_range(0, 5000), randf_range(-450, -150)))
		parent.add_child(star)

static func _build_mountains(parent: Node2D) -> void:
	var peaks := PackedVector2Array([
		Vector2(-100, -80), Vector2(400, -220), Vector2(900, -140),
		Vector2(1400, -260), Vector2(2000, -160), Vector2(2600, -240),
		Vector2(3200, -150), Vector2(3800, -280), Vector2(4500, -170),
		Vector2(5200, -250), Vector2(5400, -100), Vector2(5400, -80), Vector2(-100, -80)
	])
	var mtn := Polygon2D.new()
	mtn.color = MedinaPalette.MOUNTAIN
	mtn.polygon = peaks
	parent.add_child(mtn)

static func _build_distant_city(parent: Node2D) -> void:
	for i in range(12):
		var h := randf_range(60, 140)
		var x := 300.0 + i * 400.0
		var b := WorldArt.make_rect(Vector2(80, h), MedinaPalette.WALL_SHADOW.darkened(0.3), Vector2(x, -h))
		parent.add_child(b)

static func _build_alley_floor(parent: Node2D, origin: Vector2, width: float) -> void:
	var body := StaticBody2D.new()
	body.position = origin
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(width, 36)
	shape.position = Vector2(width * 0.5, 18)
	shape.shape = rect
	body.add_child(shape)
	var floor_vis := WorldArt.make_rect(Vector2(width, 36), MedinaPalette.ALLEY_FLOOR)
	body.add_child(floor_vis)
	var curb := WorldArt.make_rect(Vector2(width, 6), MedinaPalette.STONE.darkened(0.15), Vector2(0, 6))
	body.add_child(curb)
	parent.add_child(body)

static func _add_platform(parent: Node2D, origin: Vector2, width: float) -> void:
	var body := StaticBody2D.new()
	body.position = origin
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(width, 20)
	shape.position = Vector2(width * 0.5, 10)
	shape.shape = rect
	body.add_child(shape)
	var top := WorldArt.make_rect(Vector2(width, 20), MedinaPalette.STONE)
	body.add_child(top)
	parent.add_child(body)

static func _add_wall_segment(parent: Node2D, pos: Vector2, width: float) -> void:
	var wall := WorldArt.make_rect(Vector2(width, 130), MedinaPalette.WALL, pos + Vector2(0, -170))
	parent.add_child(wall)
	var shadow := WorldArt.make_rect(Vector2(width, 8), MedinaPalette.WALL_SHADOW, pos + Vector2(0, -40))
	parent.add_child(shadow)

static func _add_house_facade(parent: Node2D, pos: Vector2, with_lamp: bool) -> void:
	var w := 200.0
	var wall := WorldArt.make_rect(Vector2(w, 150), MedinaPalette.WALL, pos + Vector2(-w * 0.5, -190))
	parent.add_child(wall)
	var door := WorldArt.make_rect(Vector2(50, 75), MedinaPalette.DOOR_WOOD, pos + Vector2(-25, -75))
	parent.add_child(door)
	var win := WorldArt.make_rect(Vector2(30, 30), Color(0.55, 0.7, 0.9, 0.5), pos + Vector2(40, -140))
	parent.add_child(win)
	if with_lamp:
		_add_door_lamp(parent, pos + Vector2(0, -195))

static func _build_doorbell_house(parent: Node2D, pos: Vector2, doorbell_parent: Node2D) -> void:
	var w := 220.0
	var wall := WorldArt.make_rect(Vector2(w, 160), MedinaPalette.WALL, pos + Vector2(-w * 0.5, -200))
	wall.name = "BellHouseWall"
	parent.add_child(wall)
	# باب خشبي
	var door := WorldArt.make_rect(Vector2(55, 85), MedinaPalette.DOOR_WOOD, pos + Vector2(-27, -85))
	door.name = "BellHouseDoor"
	parent.add_child(door)
	# مقبض الباب
	var handle := WorldArt.make_rect(Vector2(6, 6), Color(0.7, 0.6, 0.2), pos + Vector2(15, -45))
	parent.add_child(handle)
	# لمبة مضاءة فوق الباب
	_add_door_lamp(parent, pos + Vector2(0, -205))
	# جرس
	var bell := WorldArt.make_rect(Vector2(14, 18), Color(0.85, 0.65, 0.15), pos + Vector2(35, -55))
	bell.name = "DoorBellVisual"
	parent.add_child(bell)
	var label := Label.new()
	label.text = "بيت شعبي"
	label.position = pos + Vector2(-50, -230)
	label.add_theme_font_size_override("font_size", 16)
	parent.add_child(label)

static func _add_door_lamp(parent: Node2D, pos: Vector2) -> void:
	var arm := WorldArt.make_rect(Vector2(4, 20), MedinaPalette.LAMP_METAL, pos + Vector2(-2, -20))
	parent.add_child(arm)
	var lamp := WorldArt.make_rect(Vector2(22, 14), MedinaPalette.LAMP_GLOW, pos + Vector2(-11, -34))
	parent.add_child(lamp)
	var glow := WorldArt.make_rect(Vector2(80, 80), Color(MedinaPalette.LAMP_GLOW, 0.15), pos + Vector2(-40, -70))
	parent.add_child(glow)

static func _add_palm(parent: Node2D, pos: Vector2) -> void:
	var trunk := WorldArt.make_rect(Vector2(14, 90), MedinaPalette.PALM_TRUNK, pos + Vector2(-7, -130))
	parent.add_child(trunk)
	for i in range(5):
		var leaf := Polygon2D.new()
		leaf.color = MedinaPalette.PALM_LEAF
		var base := pos + Vector2(0, -130)
		leaf.polygon = PackedVector2Array([
			base, base + Vector2(-60 + i * 15, -50 - i * 5),
			base + Vector2(-30 + i * 20, -70)
		])
		parent.add_child(leaf)

static func _add_parked_car(parent: Node2D, pos: Vector2) -> void:
	var body := WorldArt.make_rect(Vector2(120, 40), MedinaPalette.CAR_BODY, pos + Vector2(-60, -50))
	parent.add_child(body)
	var cabin := WorldArt.make_rect(Vector2(70, 30), MedinaPalette.CAR_BODY.lightened(0.1), pos + Vector2(-35, -80))
	parent.add_child(cabin)

static func _add_cat(parent: Node2D, pos: Vector2) -> void:
	var cat := Node2D.new()
	cat.position = pos
	cat.set_script(load("res://scripts/art/MedinaCatSprite.gd"))
	parent.add_child(cat)

static func _add_chicken(parent: Node2D, pos: Vector2, state: String) -> Node2D:
	var chicken := Node2D.new()
	chicken.position = pos
	chicken.set_meta("state", state)
	chicken.set_script(load("res://scripts/art/MedinaChickenSprite.gd"))
	chicken.add_to_group("chase_decor")
	parent.add_child(chicken)
	return chicken

static func _add_shop_front(parent: Node2D, pos: Vector2) -> void:
	var shop := WorldArt.make_rect(Vector2(160, 120), MedinaPalette.WALL.darkened(0.1), pos + Vector2(-80, -160))
	parent.add_child(shop)
	var sign := Label.new()
	sign.text = "دكان الحارة"
	sign.position = pos + Vector2(-45, -175)
	sign.add_theme_font_size_override("font_size", 18)
	parent.add_child(sign)
	var awning := WorldArt.make_rect(Vector2(140, 12), Color(0.6, 0.2, 0.15), pos + Vector2(-70, -165))
	parent.add_child(awning)

static func spawn_chase_obstacles(world: Node2D) -> void:
	var positions := [
		Vector2(1300, -40), Vector2(1700, -40), Vector2(2200, -40),
		Vector2(2700, -20), Vector2(3300, -40), Vector2(3900, -40), Vector2(4500, -40)
	]
	for i in positions.size():
		match i % 5:
			0:
				_add_crate(world, positions[i])
			1:
				_add_stool(world, positions[i])
			2:
				_add_sack(world, positions[i] + Vector2(0, -10))
			3:
				_add_chicken(world, positions[i], "run")
			4:
				_add_low_rope(world, positions[i])

static func build_safe_zone(world: Node2D, pos: Vector2) -> Area2D:
	var area := Area2D.new()
	area.position = pos
	area.collision_layer = 0
	area.collision_mask = 2
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(200, 140)
	shape.shape = rect
	area.add_child(shape)
	var flag := WorldArt.make_rect(Vector2(200, 140), MedinaPalette.SAFE_ZONE)
	area.add_child(flag)
	var label := Label.new()
	label.text = "نهاية الحارة — أمن!"
	label.position = Vector2(10, 50)
	label.add_theme_font_size_override("font_size", 20)
	area.add_child(label)
	var arch := WorldArt.make_polygon(PackedVector2Array([
		Vector2(-100, 0), Vector2(100, 0), Vector2(80, -80), Vector2(-80, -80)
	]), MedinaPalette.STONE)
	area.add_child(arch)
	world.add_child(area)
	return area

static func _add_crate(parent: Node2D, pos: Vector2) -> void:
	var body := StaticBody2D.new()
	body.position = pos
	body.add_to_group("headbutt_target")
	body.set_meta("breakable", true)
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(48, 48)
	shape.position = Vector2(0, -24)
	shape.shape = rect
	body.add_child(shape)
	var vis := WorldArt.make_rect(Vector2(48, 48), Color(0.55, 0.38, 0.22), Vector2(-24, -48))
	body.add_child(vis)
	body.set_script(load("res://scripts/obstacles/StaticObstacle.gd"))
	parent.add_child(body)

static func _add_stool(parent: Node2D, pos: Vector2) -> void:
	var body := StaticBody2D.new()
	body.position = pos
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(40, 35)
	shape.position = Vector2(0, -17)
	shape.shape = rect
	body.add_child(shape)
	var seat := WorldArt.make_rect(Vector2(40, 8), Color(0.5, 0.32, 0.18), Vector2(-20, -35))
	body.add_child(seat)
	for ox in [-14, 14]:
		var leg := WorldArt.make_rect(Vector2(6, 25), Color(0.4, 0.26, 0.15), Vector2(ox - 3, -27))
		body.add_child(leg)
	parent.add_child(body)

static func _add_sack(parent: Node2D, pos: Vector2) -> void:
	var body := StaticBody2D.new()
	body.position = pos
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(50, 30)
	shape.position = Vector2(0, -15)
	shape.shape = rect
	body.add_child(shape)
	var vis := WorldArt.make_rect(Vector2(50, 30), Color(0.72, 0.62, 0.4), Vector2(-25, -30))
	body.add_child(vis)
	parent.add_child(body)

static func _add_low_rope(parent: Node2D, pos: Vector2) -> void:
	var area := Area2D.new()
	area.position = pos
	area.set_script(load("res://scripts/obstacles/JumpObstacle.gd"))
	var shape := CollisionShape2D.new()
	var rect := RectangleShape2D.new()
	rect.size = Vector2(100, 20)
	shape.shape = rect
	area.add_child(shape)
	var rope := WorldArt.make_rect(Vector2(100, 4), Color(0.6, 0.45, 0.25))
	area.add_child(rope)
	parent.add_child(area)

static func _circle_points(center: Vector2, radius: float, segments: int) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in range(segments):
		var a := TAU * float(i) / float(segments)
		pts.append(center + Vector2(cos(a), sin(a)) * radius)
	return pts
