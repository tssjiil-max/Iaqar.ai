package com.sultan.tahdeeri;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;

public class MainActivity extends Activity {
    private static final String PREFS = "tahdeeri_weekly";
    private static final String KEY_WEEK = "week_json";
    private static final String CHATGPT_URL = "https://chatgpt.com/";
    private static final String MADRASATI_URL = "https://madrasatibeta.moe.gov.sa/login";

    // الجدول ثابت من صورة جدول الأستاذ سلطان — الصف الثاني/4.
    private static final String[][] FIXED_SCHEDULE = {
            {"الأحد", "2", "دين"},
            {"الأحد", "3", "لغتي"},
            {"الأحد", "7", "دين"},
            {"الاثنين", "1", "لغتي"},
            {"الاثنين", "7", "دين"},
            {"الثلاثاء", "1", "دين"},
            {"الثلاثاء", "4", "دين"},
            {"الثلاثاء", "5", "لغتي"},
            {"الأربعاء", "1", "لغتي"},
            {"الأربعاء", "2", "لغتي"},
            {"الخميس", "1", "لغتي"},
            {"الخميس", "4", "لغتي"}
    };

    private final ArrayList<EditText> lessonInputs = new ArrayList<>();
    private Spinner lessonSpinner;
    private TextView preview;
    private JSONArray lessons;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        buildUi();
        restoreSavedData();
    }

    @Override
    protected void onPause() {
        super.onPause();
        saveLessonNames();
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.parseColor("#F5F7FB"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(14), dp(16), dp(14), dp(30));
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        scroll.addView(root, new ScrollView.LayoutParams(-1, -2));

        LinearLayout hero = card(Color.parseColor("#0F766E"));
        hero.addView(text("تحضيري الأسبوعي", 25, Color.WHITE, true));
        hero.addView(space(5));
        hero.addView(text("جدولك محفوظ • بدون API • سريع", 14, Color.parseColor("#E6FFFB"), false));
        root.addView(hero, blockParams());

        LinearLayout timetableCard = card(Color.WHITE);
        timetableCard.addView(sectionTitle("جدولك الأسبوعي — الصف الثاني/4"));
        timetableCard.addView(hint("الجدول ثابت داخل التطبيق، ولن تحتاج إلى كتابته مرة أخرى."));
        timetableCard.addView(space(8));
        addScheduleSummary(timetableCard);
        root.addView(timetableCard, blockParams());

        LinearLayout lessonsCard = card(Color.WHITE);
        lessonsCard.addView(sectionTitle("1  دروس هذا الأسبوع"));
        lessonsCard.addView(hint("اكتب اسم الدرس فقط أمام الحصة. يحفظ التطبيق ما تكتبه تلقائيًا."));
        lessonsCard.addView(space(6));

        String currentDay = "";
        for (int i = 0; i < FIXED_SCHEDULE.length; i++) {
            String[] slot = FIXED_SCHEDULE[i];
            if (!slot[0].equals(currentDay)) {
                currentDay = slot[0];
                TextView day = text(currentDay, 16, Color.parseColor("#0F766E"), true);
                LinearLayout.LayoutParams dayParams = new LinearLayout.LayoutParams(-1, -2);
                dayParams.setMargins(0, dp(12), 0, dp(5));
                lessonsCard.addView(day, dayParams);
            }
            lessonsCard.addView(createLessonRow(i, slot), rowParams());
        }

        Button prepare = actionButton("نسخ طلب الأسبوع وفتح ChatGPT", "#0F766E");
        prepare.setOnClickListener(v -> copyPromptAndOpenChat());
        lessonsCard.addView(prepare, buttonParams());

        Button clear = actionButton("أسبوع جديد — مسح أسماء الدروس فقط", "#667085");
        clear.setOnClickListener(v -> confirmClearLessonNames());
        lessonsCard.addView(clear, buttonParams());
        root.addView(lessonsCard, blockParams());

        LinearLayout importCard = card(Color.WHITE);
        importCard.addView(sectionTitle("2  استيراد التحضير"));
        importCard.addView(hint("بعد أن أجهز لك التحضير في ChatGPT، انسخ الرد كاملًا ثم ارجع واضغط هنا."));
        Button importBtn = actionButton("استيراد الرد من الحافظة", "#155E75");
        importBtn.setOnClickListener(v -> importFromClipboard());
        importCard.addView(importBtn, buttonParams());
        root.addView(importCard, blockParams());

        LinearLayout resultCard = card(Color.WHITE);
        resultCard.addView(sectionTitle("3  التحضير المحفوظ"));
        lessonSpinner = new Spinner(this);
        lessonSpinner.setBackground(box(Color.WHITE, Color.parseColor("#D0D5DD"), 14));
        lessonSpinner.setPadding(dp(8), dp(4), dp(8), dp(4));
        lessonSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { showLesson(position); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        resultCard.addView(lessonSpinner, new LinearLayout.LayoutParams(-1, dp(58)));

        preview = text("لا يوجد تحضير محفوظ بعد.", 14, Color.parseColor("#344054"), false);
        preview.setBackground(box(Color.parseColor("#F8FAFC"), Color.parseColor("#E6EAF0"), 14));
        preview.setPadding(dp(12), dp(12), dp(12), dp(12));
        preview.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(-1, -2);
        pp.setMargins(0, dp(10), 0, 0);
        resultCard.addView(preview, pp);

        Button madrasati = actionButton("نسخ الحصة وفتح مدرستي", "#166534");
        madrasati.setOnClickListener(v -> copyLessonAndOpenMadrasati());
        resultCard.addView(madrasati, buttonParams());

        Button share = actionButton("مشاركة الحصة", "#475467");
        share.setOnClickListener(v -> shareSelectedLesson());
        resultCard.addView(share, buttonParams());
        root.addView(resultCard, blockParams());

        TextView foot = hint("لا توجد كلمة مرور ولا API ولا خادم. الجدول وأسماء الدروس والتحضير تبقى محليًا على جهازك.");
        foot.setGravity(Gravity.CENTER);
        root.addView(foot, blockParams());

        setContentView(scroll);
    }

    private void addScheduleSummary(LinearLayout parent) {
        String[] days = {"الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"};
        for (String day : days) {
            StringBuilder b = new StringBuilder();
            for (String[] slot : FIXED_SCHEDULE) {
                if (!slot[0].equals(day)) continue;
                if (b.length() > 0) b.append("   •   ");
                b.append("ح").append(slot[1]).append(" ").append(slot[2]);
            }
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(10), dp(8), dp(10), dp(8));
            row.setBackground(box(Color.parseColor("#F8FAFC"), Color.parseColor("#E4E7EC"), 12));
            row.addView(text(day, 15, Color.parseColor("#101828"), true));
            row.addView(text(b.toString(), 14, Color.parseColor("#475467"), false));
            LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(-1, -2);
            rp.setMargins(0, dp(4), 0, dp(4));
            parent.addView(row, rp);
        }
    }

    private View createLessonRow(int index, String[] slot) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(8), dp(7), dp(8), dp(7));
        row.setBackground(box(Color.parseColor("#FCFCFD"), Color.parseColor("#EAECF0"), 12));

        TextView label = text("ح" + slot[1] + "  " + slot[2], 15, Color.parseColor("#344054"), true);
        label.setGravity(Gravity.CENTER_VERTICAL | Gravity.RIGHT);
        LinearLayout.LayoutParams lpLabel = new LinearLayout.LayoutParams(dp(92), dp(48));
        row.addView(label, lpLabel);

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(15);
        input.setGravity(Gravity.CENTER_VERTICAL | Gravity.RIGHT);
        input.setHint("اسم الدرس");
        input.setBackground(box(Color.WHITE, Color.parseColor("#D0D5DD"), 12));
        input.setPadding(dp(10), 0, dp(10), 0);
        input.setTag(index);
        lessonInputs.add(input);
        LinearLayout.LayoutParams lpInput = new LinearLayout.LayoutParams(0, dp(48), 1f);
        row.addView(input, lpInput);
        return row;
    }

    private void restoreSavedData() {
        for (int i = 0; i < lessonInputs.size(); i++) {
            lessonInputs.get(i).setText(getSharedPreferences(PREFS, MODE_PRIVATE).getString("lesson_name_" + i, ""));
        }
        String savedWeek = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_WEEK, "");
        if (!savedWeek.isEmpty()) {
            try { setWeekData(new JSONObject(savedWeek)); } catch (Exception ignored) { }
        }
        if (lessons == null) refreshSpinner();
    }

    private void saveLessonNames() {
        android.content.SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        for (int i = 0; i < lessonInputs.size(); i++) {
            e.putString("lesson_name_" + i, lessonInputs.get(i).getText().toString().trim());
        }
        e.apply();
    }

    private void confirmClearLessonNames() {
        new AlertDialog.Builder(this)
                .setTitle("بدء أسبوع جديد")
                .setMessage("سيتم مسح أسماء الدروس فقط، وسيبقى جدولك الأسبوعي ثابتًا.")
                .setNegativeButton("إلغاء", null)
                .setPositiveButton("مسح", (d, w) -> {
                    for (EditText input : lessonInputs) input.setText("");
                    saveLessonNames();
                    toast("تم مسح أسماء الدروس. الجدول محفوظ كما هو.");
                })
                .show();
    }

    private void copyPromptAndOpenChat() {
        saveLessonNames();
        String schedule = buildWeeklyScheduleText();
        copyToClipboard(buildPrompt(schedule));
        toast("تم نسخ طلب الأسبوع. الصقه في ChatGPT.");
        openUrl(CHATGPT_URL);
    }

    private String buildWeeklyScheduleText() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < FIXED_SCHEDULE.length; i++) {
            String[] slot = FIXED_SCHEDULE[i];
            String lesson = lessonInputs.get(i).getText().toString().trim();
            if (lesson.isEmpty()) lesson = "غير محدد";
            b.append(slot[0]).append(" | ")
                    .append(slot[1]).append(" | ")
                    .append(slot[2]).append(" | ")
                    .append(lesson).append("\n");
        }
        return b.toString().trim();
    }

    private String buildPrompt(String schedule) {
        return "حضّر لي الأسبوع التالي للصف الثاني الابتدائي (2/4) تحضيرًا رسميًا مختصرًا ومناسبًا لعمر الطلاب، حسب جدولي الثابت أدناه فقط.\n\n" +
                "ملاحظة: كلمة (دين) في الجدول هي حصة دينية؛ التزم باسم الدرس الذي كتبه المعلم ولا تخترع درسًا آخر. إذا كان اسم الدرس (غير محدد)، أنشئ قالب تحضير عام للحصة ولا تسمِّ درسًا من عندك.\n\n" +
                "الجدول:\n" + schedule + "\n\n" +
                "لكل حصة اكتب: أهداف تعلم واضحة، تهيئة، استراتيجيات، وسائل/مصادر، تقويم، واجب، إثراء، وعلاج للمتعثرين. لا تغيّر اليوم أو رقم الحصة أو المادة أو اسم الدرس.\n\n" +
                "أعد النتيجة JSON فقط دون Markdown أو شرح، بهذا الهيكل:\n" +
                "{\"version\":2,\"week_title\":\"تحضير الأسبوع\",\"lessons\":[{" +
                "\"day\":\"الأحد\",\"period\":\"2\",\"subject\":\"دين\",\"unit\":\"\",\"lesson\":\"اسم الدرس\"," +
                "\"objectives\":[\"هدف 1\",\"هدف 2\",\"هدف 3\"],\"warmup\":\"...\"," +
                "\"strategies\":[\"...\"],\"resources\":[\"...\"],\"assessment\":\"...\"," +
                "\"homework\":\"...\",\"enrichment\":\"...\",\"remediation\":\"...\"}]}";
    }

    private void importFromClipboard() {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip() == null || cm.getPrimaryClip().getItemCount() == 0) {
            toast("الحافظة فارغة.");
            return;
        }
        CharSequence cs = cm.getPrimaryClip().getItemAt(0).coerceToText(this);
        if (cs == null) {
            toast("لم أجد نصًا في الحافظة.");
            return;
        }
        try {
            JSONObject obj = new JSONObject(extractJson(cs.toString()));
            JSONArray arr = obj.optJSONArray("lessons");
            if (arr == null || arr.length() == 0) throw new Exception("لا توجد حصص");
            setWeekData(obj);
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_WEEK, obj.toString()).apply();
            toast("تم حفظ " + arr.length() + " حصة.");
        } catch (Exception e) {
            toast("تعذر قراءة الرد. انسخ JSON كاملًا من ChatGPT.");
        }
    }

    private String extractJson(String raw) {
        String t = raw.trim();
        int s = t.indexOf('{');
        int e = t.lastIndexOf('}');
        return (s >= 0 && e > s) ? t.substring(s, e + 1) : t;
    }

    private void setWeekData(JSONObject obj) {
        lessons = obj.optJSONArray("lessons");
        refreshSpinner();
    }

    private void refreshSpinner() {
        ArrayList<String> labels = new ArrayList<>();
        if (lessons != null) {
            for (int i = 0; i < lessons.length(); i++) {
                JSONObject l = lessons.optJSONObject(i);
                if (l != null) {
                    labels.add(l.optString("day") + " — ح" + l.optString("period") + " — " + l.optString("subject") + " — " + l.optString("lesson"));
                }
            }
        }
        if (labels.isEmpty()) labels.add("لا يوجد تحضير محفوظ بعد");
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        lessonSpinner.setAdapter(adapter);
        if (lessons != null && lessons.length() > 0) showLesson(0);
    }

    private void showLesson(int position) {
        if (lessons == null || position < 0 || position >= lessons.length()) {
            preview.setText("لا يوجد تحضير محفوظ بعد.");
            return;
        }
        preview.setText(lessonText(lessons.optJSONObject(position)));
    }

    private String lessonText(JSONObject l) {
        if (l == null) return "";
        StringBuilder b = new StringBuilder();
        line(b, "اليوم", l.optString("day"));
        line(b, "الحصة", l.optString("period"));
        line(b, "المادة", l.optString("subject"));
        line(b, "الوحدة", l.optString("unit"));
        line(b, "الدرس", l.optString("lesson"));
        line(b, "الأهداف", joinArray(l.optJSONArray("objectives")));
        line(b, "التهيئة", l.optString("warmup"));
        line(b, "الاستراتيجيات", joinArray(l.optJSONArray("strategies")));
        line(b, "الوسائل", joinArray(l.optJSONArray("resources")));
        line(b, "التقويم", l.optString("assessment"));
        line(b, "الواجب", l.optString("homework"));
        line(b, "الإثراء", l.optString("enrichment"));
        line(b, "العلاج", l.optString("remediation"));
        return b.toString().trim();
    }

    private void line(StringBuilder b, String label, String value) {
        if (value != null && !value.trim().isEmpty()) b.append(label).append(": ").append(value.trim()).append("\n");
    }

    private String joinArray(JSONArray a) {
        if (a == null) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < a.length(); i++) {
            if (i > 0) b.append("، ");
            b.append(a.optString(i));
        }
        return b.toString();
    }

    private JSONObject selectedLesson() {
        if (lessons == null || lessons.length() == 0) return null;
        int i = lessonSpinner.getSelectedItemPosition();
        if (i < 0 || i >= lessons.length()) i = 0;
        return lessons.optJSONObject(i);
    }

    private void copyLessonAndOpenMadrasati() {
        JSONObject l = selectedLesson();
        if (l == null) {
            toast("استورد تحضير الأسبوع أولًا.");
            return;
        }
        copyToClipboard(lessonText(l));
        toast("تم نسخ الحصة. الصقها في مدرستي بعد فتح التحضير.");
        openUrl(MADRASATI_URL);
    }

    private void shareSelectedLesson() {
        JSONObject l = selectedLesson();
        if (l == null) {
            toast("اختر حصة أولًا.");
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, lessonText(l));
        send.putExtra(Intent.EXTRA_SUBJECT, "تحضير " + l.optString("subject") + " - " + l.optString("lesson"));
        startActivity(Intent.createChooser(send, "مشاركة التحضير"));
    }

    private void copyToClipboard(String value) {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("تحضيري", value));
    }

    private void openUrl(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            toast("تعذر فتح الرابط على الجهاز.");
        }
    }

    private void toast(String value) {
        Toast.makeText(this, value, Toast.LENGTH_SHORT).show();
    }

    private LinearLayout card(int color) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(14), dp(14), dp(14), dp(14));
        layout.setBackground(box(color, color == Color.WHITE ? Color.parseColor("#E4E7EC") : color, 18));
        return layout;
    }

    private TextView sectionTitle(String value) {
        TextView t = text(value, 18, Color.parseColor("#101828"), true);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.setMargins(0, 0, 0, dp(6));
        t.setLayoutParams(p);
        return t;
    }

    private TextView hint(String value) {
        TextView t = text(value, 13, Color.parseColor("#667085"), false);
        t.setLineSpacing(0, 1.15f);
        return t;
    }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setGravity(Gravity.RIGHT);
        t.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return t;
    }

    private Button actionButton(String label, String hex) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(15);
        b.setTextColor(Color.WHITE);
        b.setAllCaps(false);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setBackground(box(Color.parseColor(hex), Color.parseColor(hex), 14));
        return b;
    }

    private GradientDrawable box(int fill, int stroke, int radius) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(radius));
        d.setStroke(dp(1), stroke);
        return d;
    }

    private View space(int h) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(h)));
        return v;
    }

    private LinearLayout.LayoutParams blockParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.setMargins(0, 0, 0, dp(12));
        return p;
    }

    private LinearLayout.LayoutParams rowParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.setMargins(0, dp(3), 0, dp(3));
        return p;
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(54));
        p.setMargins(0, dp(10), 0, 0);
        return p;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
