extends Node

var music_volume := 0.8
var sfx_volume := 1.0

var _music_player: AudioStreamPlayer
var _sfx_players: Array[AudioStreamPlayer] = []

func _ready() -> void:
	music_volume = SaveManager.data.settings.music_volume
	sfx_volume = SaveManager.data.settings.sfx_volume
	_music_player = AudioStreamPlayer.new()
	_music_player.bus = "Master"
	add_child(_music_player)

func play_music(track_name: String) -> void:
	# Placeholder: procedural tone patterns until final audio assets are added.
	_music_player.stop()
	match track_name:
		"menu":
			_music_player.stream = _make_tone(220.0, 0.15)
		"explore":
			_music_player.stream = _make_tone(330.0, 0.12)
		"chase":
			_music_player.stream = _make_tone(440.0, 0.08)
		_:
			return
	_music_player.volume_db = linear_to_db(music_volume)
	_music_player.play()

func play_sfx(sfx_name: String) -> void:
	var player := AudioStreamPlayer.new()
	player.bus = "Master"
	player.stream = _make_tone(_sfx_pitch(sfx_name), 0.05)
	player.volume_db = linear_to_db(sfx_volume)
	add_child(player)
	player.finished.connect(player.queue_free)
	player.play()

func _sfx_pitch(name: String) -> float:
	match name:
		"punch": return 180.0
		"kick": return 140.0
		"jump": return 520.0
		"collect": return 760.0
		"bell": return 620.0
		"headbutt": return 260.0
		"rescue": return 500.0
		"super_ready": return 880.0
		"super_activate": return 990.0
		"win": return 700.0
		"lose": return 120.0
		_: return 400.0

func _make_tone(freq: float, duration: float) -> AudioStreamWAV:
	var sample_rate := 22050
	var frame_count := int(sample_rate * duration)
	var data := PackedByteArray()
	data.resize(frame_count * 2)
	for i in frame_count:
		var t := float(i) / sample_rate
		var sample := sin(TAU * freq * t) * 0.25
		var value := int(clamp(sample * 32767.0, -32768.0, 32767.0))
		data[i * 2] = value & 0xFF
		data[i * 2 + 1] = (value >> 8) & 0xFF
	var stream := AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = sample_rate
	stream.stereo = false
	stream.data = data
	return stream
