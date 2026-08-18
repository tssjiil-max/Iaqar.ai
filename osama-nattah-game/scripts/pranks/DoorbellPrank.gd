extends BasePrank
class_name DoorbellPrank

func _ready() -> void:
	super._ready()
	prank_type = "doorbell"
	prompt_text = "دق الجرس"
	reaction_delay = 1.2

func trigger_prank(player: PlayerController) -> void:
	AudioManager.play_sfx("bell")
	super.trigger_prank(player)
