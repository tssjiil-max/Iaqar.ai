import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gate = readFileSync(new URL("../public/js/access-gate.js", import.meta.url), "utf8");
const publicIntake = readFileSync(new URL("../public/js/public-intake.js", import.meta.url), "utf8");

for (const [name, source] of [["بوابة المنصة", gate], ["رابط المكتب", publicIntake]]) {
  test(`${name}: تظهر المدن الثلاث وخيار الكتابة اليدوية`, () => {
    for (const city of ["المدينة المنورة", "جدة", "الرياض", "__other__"])
      assert.ok(source.includes(`<option value="${city}">`), city);
  });
  test(`${name}: لا تحفظ المدينة بقيمة ثابتة`, () => {
    assert.doesNotMatch(source, /city:\s*"المدينة المنورة"\s*,\s*propertyType/);
    assert.match(source, /\bconst city = /);
  });
  test(`${name}: يتغير اختيار الحي عند تغيير المدينة`, () => {
    assert.match(source, /citySelect\.value === "المدينة المنورة"/);
    assert.match(source, /districtSelect\.innerHTML/);
  });
}
