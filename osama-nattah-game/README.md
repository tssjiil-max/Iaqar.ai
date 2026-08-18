# أسامة ونطّاح

لعبة مغامرات ومطاردات كوميدية عربية في حارة حجازية خيالية. تلعب كأسامة (طفل مشاغب) مع رفيقه نطّاح (خروف شجاع) في مغامرات استكشاف ومقالب ومطاردات.

## المتطلبات

- **Godot 4.3** أو أحدث
- للتصدير إلى Android: Android SDK + JDK 17 + قوالب تصدير Godot

## فتح المشروع

1. افتح Godot Engine
2. اختر **Import** ثم المجلد `osama-nattah-game`
3. شغّل المشروع (F5) — ستبدأ من القائمة الرئيسية

## التشغيل من الطرفية

```bash
# استيراد المشروع
godot --path osama-nattah-game --import --quit

# تشغيل اللعبة
godot --path osama-nattah-game

# اختبارات التحميل
bash osama-nattah-game/run_tests.sh
```

## التحكم (لوحة المفاتيح — للتطوير)

| المفتاح | الوظيفة |
|---------|---------|
| A / ← | يسار |
| D / → | يمين |
| Space | قفز |
| E | تفاعل / تفعيل القوة الخارقة |
| J | لكمة 👊 |
| K | شلوتي 🦶 |
| L | نطّاح 🐑 / إنقاذ |
| Esc | إيقاف مؤقت |

## التحكم (Android — لمس)

- **يسار الشاشة:** أزرار الاتجاه ⬅️ ➡️
- **يمين الشاشة:** قفز، لكمة، شلوتي، نطّاح، تفاعل
- زر التفاعل يظهر عند الاقتراب من الأهداف

## البنية المعمارية

```
res://
├── scenes/          # المشاهد (شخصيات، مراحل، واجهة)
├── scripts/
│   ├── core/        # GameManager, SaveManager, AudioManager...
│   ├── player/      # PlayerController
│   ├── sheep/       # SheepController
│   ├── chasers/     # المطاردون + ChaseManager
│   ├── pranks/      # نظام المقالب
│   ├── obstacles/   # العقبات
│   ├── collectibles/
│   └── ui/
├── assets/
└── autoload/        # (عبر project.godot)
```

### الأنظمة الرئيسية

| النظام | الملف |
|--------|-------|
| إدارة اللعبة | `scripts/core/GameManager.gd` |
| الحفظ | `scripts/core/SaveManager.gd` |
| الصوت | `scripts/core/AudioManager.gd` |
| الكومبو | `scripts/core/ComboManager.gd` |
| المطاردة | `scripts/chasers/ChaseManager.gd` |
| المقالب | `scripts/pranks/BasePrank.gd` |

## Vertical Slice — المرحلة 1 «دق الجرس»

المرحلة الأولى قابلة للعب من البداية للنهاية وتتضمن:

- استكشاف الحارة
- مقلب جرس الباب
- مطاردة صاحب المنزل
- 5 أنواع عقبات أثناء المطاردة
- جمع عملات وأسرار
- لكمة، شلوتي، نطحة نطّاح
- نظام إنقاذ (نطّاح ينقذ أسامة)
- منطقة آمنة + شاشة فوز/خسارة
- حفظ التقدم

## إنشاء مرحلة جديدة

1. أنشئ مشهدًا في `scenes/levels/`
2. أضف `LevelController` يرث منطق `Level01Controller.gd`
3. سجّل المسار في `SceneManager.LEVELS`
4. أضف معرّف المرحلة في `SaveManager._next_level()`

## إنشاء مقلب جديد

1. أنشئ سكربتًا يرث `BasePrank.gd`
2. نفّذ `trigger_prank()` وخصّص `prompt_text`
3. أضف المشهد في `scenes/pranks/`
4. ضعه في المرحلة — عند التفعيل يستدعي `ChaseManager.start_chase()` تلقائيًا

## إنشاء مطارد جديد

1. أنشئ سكربتًا يرث `BaseChaser.gd`
2. خصّص `speed`, `quote`, `catch_distance`
3. أضف المشهد في `scenes/chasers/`
4. اربطه بـ `ChaseManager.setup()`

## إضافة قدرة جديدة

1. أنشئ سكربتًا يرث `BaseAbility.gd` في `scripts/abilities/`
2. نفّذ `can_use()`, `activate()`, `finish()`
3. اربط الزر من `TouchControls` أو `_unhandled_input` في المرحلة

## استبدال الرسومات

- **أسامة:** `scenes/characters/Player.tscn` — استبدل `ColorRect` بـ `Sprite2D` + `AnimationPlayer`
- **نطّاح:** `scenes/characters/Sheep.tscn`
- ضع الأصول في `assets/characters/`
- حافظ على أسماء العقد (`Sprite`, `AnimationPlayer`, `PunchArea`...) دون تغيير

## تصدير APK/AAB لأندرويد

1. ثبّت **Android SDK** و **JDK 17**
2. في Godot: Editor → Manage Export Templates → حمّل قوالب 4.3
3. Project → Export → Add → Android
4. عيّن مسار SDK: `/workspace/android-sdk` (أو مسارك المحلي)
5. Package name: `com.osama.nattah`
6. Orientation: Landscape
7. Export Project → APK أو AAB

```bash
godot --headless --path osama-nattah-game --export-release "Android" build/osama-nattah.apk
```

## ما يعمل حاليًا

- القائمة الرئيسية (عب، مراحل، حوش، إعدادات)
- المرحلة 1 كاملة (Vertical Slice)
- حركة أسامة + قفز + لكمة + شلوتي
- نطّاح يتبع أسامة + نطحة + إنقاذ
- مقلب الجرس + مطاردة + عقبات + عملات + أسرار
- نقاط + كومبو + Super Meter + Friendship Meter
- حفظ JSON + شاشة نتيجة
- تحكم لمس + لوحة مفاتيح

## ما تبقى (تحديثات قادمة)

- المراحل 2–7 (اللمبة، الشلوتي، نطّاح، وين نطّاح، السوق، أبو صالح)
- حركة الثنائي الكاملة
- النبّالة (Slingshot)
- رسوم وأصوات نهائية (حاليًا Placeholder)
- تطوير الحوش الكامل
- تصدير Android جاهز للمتجر

## الإصدار

- Godot: **4.3.stable**
- حالة المشروع: **Vertical Slice — المرحلة 1**
