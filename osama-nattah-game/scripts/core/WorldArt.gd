extends RefCounted
class_name WorldArt

static func make_rect(size: Vector2, color: Color, offset: Vector2 = Vector2.ZERO) -> WorldRect:
	var node := WorldRect.new()
	node.size = size
	node.color = color
	node.offset = offset
	return node

static func make_polygon(points: PackedVector2Array, color: Color) -> Polygon2D:
	var node := Polygon2D.new()
	node.polygon = points
	node.color = color
	return node
