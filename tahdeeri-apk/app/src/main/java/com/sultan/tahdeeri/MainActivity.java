package com.sultan.tahdeeri;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
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
    private static final String KEY_SCHEDULE = "schedule";
    private static final String KEY_WEEK = "week_json";
    private static final String CHATGPT_URL = "https://chatgpt.com/";
    private static final String MADRASATI_URL = "https://madrasatibeta.moe.gov.sa/login";

    private EditText scheduleInput;
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
        hero.addView(text("بدون API • سريع • يحفظ على جهازك", 14, Color.parseColor("#E6FFFB"), false));
        root.addView(hero, blockParams());

        LinearLayout step1 = card(Color.WHITE);
        step1.addView(sectionTitle("1  حصص الأسبوع"));
        step1.addView(hint("كل حصة في سطر: اليوم | رقم الحصة | المادة | اسم الدرس"));
        scheduleInput = new EditText(this);
        scheduleInput.setTextSize(16);
        scheduleInput.setGravity(Gravity.TOP | Gravity.RIGHT);
        scheduleInput.setMinLines(6);
        scheduleInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        scheduleInput.setHint("الأحد | 1 | لغتي | اسم الدرس\nالأحد | 3 | القرآن الكريم | اسم الدرس\nالاثنين | 2 | الدراسات الإسلامية | اسم الدرس");
        scheduleInput.setBackground(box(Color.WHITE, Color.parseColor("#D0D5DD"), 14));
        scheduleInput.setPadding(dp(12), dp(12), dp(12), dp(12));
        step1.addView(scheduleInput, new LinearLayout.LayoutParams(-1, dp(180)));

        Button prepare = actionButton("نسخ الطلب وفتح ChatGPT", "#0F766E");
        prepare.setOnClickListener(v -> copyPromptAndOpenChat());
        step1.addView(prepare, buttonParams());
        root.addView(step1, blockParams());

        LinearLayout step2 = card(Color.WHITE);
        step2.addView(sectionTitle("2  استيراد التحضير"));
        step2.addView(hint("انسخ رد ChatGPT كاملًا، ثم ارجع واضغط هنا."));
        Button importBtn = actionButton("استيراد الرد من الحافظة", "#155E75");
        importBtn.setOnClickListener(v -> importFromClipboard());
        step2.addView(importBtn, buttonParams());
        root.addView(step2, blockParams());

        LinearLayout step3 = card(Color.WHITE);
        step3.addView(sectionTitle("3  الحصة المطلوبة"));
        lessonSpinner = new Spinner(this);
        lessonSpinner.setBackground(box(Color.WHITE, Color.parseColor("#D0D5DD"), 14));
        lessonSpinner.setPadding(dp(8), dp(4), dp(8), dp(4));
        lessonSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { showLesson(position); }
            @Override public void onNothingSelected(AdapterView<?> parent) { }
        });
        step3.addView(lessonSpinner, new LinearLayout.LayoutParams(-1, dp(58)));

        preview = text("لا يوجد تحضير محفوظ بعد.", 14, Color.parseColor("#344054"), false);
        preview.setBackground(box(Color.parseColor("#F8FAFC"), Color.parseColor("#E6EAF0"), 14));
        preview.setPadding(dp(12), dp(12), dp(12), dp(12));
        preview.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams pp = new LinearLayout.LayoutParams(-1, -2);
        pp.setMargins(0, dp(10), 0, 0);
        step3.addView(preview, pp);

        Button madrasati = actionButton("نسخ الحصة وفتح مدرستي", "#166534");
        madrasati.setOnClickListener(v -> copyLessonAndOpenMadrasati());
        step3.addView(madrasati, buttonParams());

        Button share = actionButton("مشاركة الحصة", "#475467");
        share.setOnClickListener(v -> shareSelectedLesson());
        step3.addView(share, buttonParams());
        root.addView(step3, blockParams());

        TextView foot = hint("لا توجد كلمة مرور ولا API ولا خادم. البيانات تبقى محليًا على جهازك. راجع التحضير قبل حفظه في مدرستي.");
        foot.setGravity(Gravity.CENTER);
        root.addView(foot, blockParams());

        setContentView(scroll);
    }

    private void restoreSavedData() {
        scheduleInput.setText(getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SCHEDULE, ""));
        String savedWeek = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_WEEK, "");
        if (!savedWeek.isEmpty()) {
            try { setWeekData(new JSONObject(savedWeek)); } catch (Exception ignored) { }
        }
        if (lessons == null) refreshSpinner();
    }

    private void copyPromptAndOpenChat() {
        String schedule = scheduleInput.getText().toString().trim();
        if (schedule.isEmpty()) { toast("اكتب حصص الأسبوع أولًا."); return; }
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SCHEDULE, schedule).apply();
        copyToClipboard(buildPrompt(schedule));
        toast("تم نسخ طلب الأسبوع. الصقه في ChatGPT.");
        openUrl(CHATGPT_URL);
    }

    private String buildPrompt(String schedule) {
        return "حضّر لي الأسبوع التالي تحضيرًا رسميًا مختصرًا ومناسبًا للمرحلة، حسب الحصص المكتوبة فقط.\\n\\n" +
                "الحصص:\\n" + schedule + "\\n\\n" +
                "لكل حصة اكتب: أهداف تعلم واضحة، تهيئة، استراتيجيات، وسائل/مصادر، تقويم، واجب، إثراء، علاج للمتعثرين. لا تغيّر أسماء الدروس.\\n\\n" +
                "أعد النتيجة JSON فقط دون Markdown أو شرح، بهذا الهيكل:\\n" +
                "{\\\"version\\\":1,\\\"week_title\\\":\\\"تحضير الأسبوع\\\",\\\"lessons\\\":[{" +
                "\\\"day\\\":\\\"الأحد\\\",\\\"period\\\":\\\"1\\\",\\\"subject\\\":\\\"لغتي\\\",\\\"unit\\\":\\\"\\\",\\\"lesson\\\":\\\"اسم الدرس\\\"," +
                "\\\"objectives\\\":[\\\"هدف 1\\\",\\\"هدف 2\\\",\\\"هدف 3\\\"],\\\"warmup\\\":\\\"...\\\"," +
                "\\\"strategies\\\":[\\\"...\\\"],\\\"resources\\\":[\\\"...\\\"],\\\"assessment\\\":\\\"...\\\"," +
                "\\\"homework\\\":\\\"...\\\",\\\"enrichment\\\":\\\"...\\\",\\\"remediation\\\":\\\"...\\\"}]}";
    }

    private void importFromClipboard() {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip() == null || cm.getPrimaryClip().getItemCount() == 0) { toast("الحافظة فارغة."); return; }
        CharSequence cs = cm.getPrimaryClip().getItemAt(0).coerceToText(this);
        if (cs == null) { toast("لم أجد نصًا في الحافظة."); return; }
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
                if (l != null) labels.add(l.optString("day") + " — ح" + l.optString("period") + " — " + l.optString("subject") + " — " + l.optString("lesson"));
            }
        }
        if (labels.isEmpty()) labels.add("لا يوجد تحضير محفوظ بعد");
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        lessonSpinner.setAdapter(adapter);
        if (lessons != null && lessons.length() > 0) showLesson(0);
    }

    private void showLesson(int position) {
        if (lessons == null || position < 0 || position >= lessons.length()) { preview.setText("لا يوجد تحضير محفوظ بعد."); return; }
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
        if (value != null && !value.trim().isEmpty()) b.append(label).append(": ").append(value.trim()).append("\\n");
    }

    private String joinArray(JSONArray a) {
        if (a == null) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < a.length(); i++) { if (i > 0) b.append("، "); b.append(a.optString(i)); }
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
        if (l == null) { toast("استورد تحضير الأسبوع أولًا."); return; }
        copyToClipboard(lessonText(l));
        toast("تم نسخ الحصة. الصقها في مدرستي بعد فتح التحضير.");
        openUrl(MADRASATI_URL);
    }

    private void shareSelectedLesson() {
        JSONObject l = selectedLesson();
        if (l == null) { toast("اختر حصة أولًا."); return; }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, lessonText(l));
        send.putExtra(Intent.EXTRA_SUBJECT, "تحضير " + l.optString("subject") + " - " + l.optString("lesson"));
        startActivity(Intent.createChooser(send, "مشاركة التحضير"));
    }

    private void copyToClipboard(String text) {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("تحضيري", text));
    }

    private void openUrl(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (Exception e) { toast("تعذر فتح الرابط على الجهاز."); }
    }

    private LinearLayout card(int color) {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(16), dp(16), dp(16), dp(16));
        l.setBackground(box(color, color, 20));
        l.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        return l;
    }

    private LinearLayout.LayoutParams blockParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.setMargins(0, 0, 0, dp(12));
        return p;
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(52));
        p.setMargins(0, dp(10), 0, 0);
        return p;
    }

    private Button actionButton(String label, String color) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(16);
        b.setTextColor(Color.WHITE);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setAllCaps(false);
        b.setGravity(Gravity.CENTER);
        b.setBackground(box(Color.parseColor(color), Color.parseColor(color), 14));
        return b;
    }

    private TextView sectionTitle(String t) { return text(t, 18, Color.parseColor("#14213D"), true); }

    private TextView hint(String t) {
        TextView v = text(t, 13, Color.parseColor("#667085"), false);
        v.setLineSpacing(0, 1.2f);
        return v;
    }

    private TextView text(String t, int sp, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(sp);
        v.setTextColor(color);
        v.setGravity(Gravity.RIGHT);
        v.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        if (bold) v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return v;
    }

    private View space(int d) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(d)));
        return v;
    }

    private GradientDrawable box(int fill, int stroke, int radius) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(radius));
        g.setStroke(dp(1), stroke);
        return g;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
    private void toast(String msg) { Toast.makeText(this, msg, Toast.LENGTH_SHORT).show(); }
}
